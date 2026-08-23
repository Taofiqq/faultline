/**
 * Failure Pipeline — Multi-event transitions T1–T4.
 *
 * M6: Adds network duplication, simulated service errors, circuit breakers.
 */

import type { SimEvent } from './types';
import type { PRNG } from './prng';
import type { Scenario, Path } from '../scenario/types';
import { computeRetryDelay } from './retry-scheduler';
import { IdempotencyRegistry } from './idempotency-registry';
import {
  type CircuitBreakerState,
  createCircuitBreakerState,
  checkCircuit,
  recordOutcome,
} from './circuit-breaker';

// ─── Internal Event: Deadline Check ──────────────────────────────────────────

export interface DeadlineCheckEvent {
  type: '_DeadlineCheck';
  timestamp: number;
  sequence: number;
  pathId: string;
  operationId: number;
  attempt: number;
  deliveryIndex: number;
  circuitGeneration: number;
}

export type QueueEvent = SimEvent | DeadlineCheckEvent;

// ─── Operation State ─────────────────────────────────────────────────────────

export interface OperationAttemptState {
  operationId: number;
  pathId: string;
  attempt: number;
  deliveryIndex: number;
  idempotencyKey: string;
  sentAt: number;
  resolved: boolean;
  circuitGeneration: number;
}

export interface OperationBudget {
  maxRetries: number;
  retriesUsed: number;
}

export interface PipelineState {
  attempts: Map<string, OperationAttemptState>;
  budgets: Map<number, OperationBudget>;
  paths: Map<string, Path>;
  idempotency: IdempotencyRegistry;
  circuits: Map<string, CircuitBreakerState>; // pathId → circuit state
  nextOperationId: number;
}

function attemptKey(operationId: number, attempt: number, deliveryIndex: number): string {
  return `${operationId}:${attempt}:${deliveryIndex}`;
}

export function createPipelineState(scenario: Scenario): PipelineState {
  const paths = new Map<string, Path>();
  const circuits = new Map<string, CircuitBreakerState>();
  for (const p of scenario.paths) {
    paths.set(p.id, p);
    if (p.resilience.circuitBreaker) {
      circuits.set(p.id, createCircuitBreakerState());
    }
  }
  return {
    attempts: new Map(),
    budgets: new Map(),
    paths,
    idempotency: new IdempotencyRegistry(),
    circuits,
    nextOperationId: 1,
  };
}

// ─── Pipeline Processor Result ───────────────────────────────────────────────

export interface ProcessResult {
  enqueue: QueueEvent[];
  log: boolean;
  logAs?: SimEvent;
}

// ─── T1: RequestSent → RequestArrived ────────────────────────────────────────
// (1) Circuit check
// (2) Apply request latency
// (3) Network duplication — fork N-1 copies

function processRequestSent(
  event: Extract<SimEvent, { type: 'RequestSent' }>,
  state: PipelineState,
  prng: PRNG,
  nextSequence: () => number,
): ProcessResult {
  const path = state.paths.get(event.pathId);
  if (!path) return { enqueue: [], log: true };

  // (1) Circuit check
  const circuitState = state.circuits.get(event.pathId);
  const circuitConfig = path.resilience.circuitBreaker;
  let circuitGen = circuitState?.generation ?? 0;

  if (circuitState && circuitConfig) {
    const decision = checkCircuit(circuitState, circuitConfig, event.timestamp, event.sequence);
    if (decision === 'reject') {
      // Emit CircuitOpenError — immediate, non-retryable
      const errorEvent: SimEvent = {
        type: 'CircuitOpenError',
        timestamp: event.timestamp,
        sequence: nextSequence(),
        pathId: event.pathId,
        operationId: event.operationId,
      };
      return { enqueue: [errorEvent], log: true };
    }
    circuitGen = circuitState.generation;
  }

  // Track this attempt
  const key = attemptKey(event.operationId, event.attempt, event.deliveryIndex);
  state.attempts.set(key, {
    operationId: event.operationId,
    pathId: event.pathId,
    attempt: event.attempt,
    deliveryIndex: event.deliveryIndex,
    idempotencyKey: event.idempotencyKey,
    sentAt: event.timestamp,
    resolved: false,
    circuitGeneration: circuitGen,
  });

  // Initialize retry budget on first attempt
  if (event.attempt === 0 && event.deliveryIndex === 0 && path.resilience.retry) {
    state.budgets.set(event.operationId, {
      maxRetries: path.resilience.retry.maxRetries,
      retriesUsed: 0,
    });
  }

  // (2) Calculate request latency
  let requestLatency = 0;
  for (const failure of path.failures) {
    if (failure.type === 'fixedLatency') {
      if (prng.nextFloat() < failure.probability) {
        requestLatency += failure.ms;
      }
    } else if (failure.type === 'randomLatency') {
      if (prng.nextFloat() < failure.probability) {
        requestLatency += prng.nextRange(Math.round(failure.minMs), Math.round(failure.maxMs));
      }
    }
  }

  const arrivalTime = event.timestamp + requestLatency;
  const enqueue: QueueEvent[] = [];

  // (3) Network duplication — check for duplicateRequest injection
  let totalDeliveries = 1;
  for (const failure of path.failures) {
    if (failure.type === 'duplicateRequest') {
      if (prng.nextFloat() < failure.probability) {
        totalDeliveries = failure.count; // original + (count-1) copies
      }
    }
  }

  // Emit RequestArrived for original (deliveryIndex=0)
  enqueue.push({
    type: 'RequestArrived',
    timestamp: arrivalTime,
    sequence: nextSequence(),
    pathId: event.pathId,
    operationId: event.operationId,
    idempotencyKey: event.idempotencyKey,
    attempt: event.attempt,
    deliveryIndex: 0,
    deduplicated: false,
  });

  // Fork N-1 copies (deliveryIndex 1..N-1)
  for (let d = 1; d < totalDeliveries; d++) {
    // Track each delivery's attempt state
    const dupKey = attemptKey(event.operationId, event.attempt, d);
    state.attempts.set(dupKey, {
      operationId: event.operationId,
      pathId: event.pathId,
      attempt: event.attempt,
      deliveryIndex: d,
      idempotencyKey: event.idempotencyKey,
      sentAt: event.timestamp,
      resolved: false,
      circuitGeneration: circuitGen,
    });

    enqueue.push({
      type: 'RequestArrived',
      timestamp: arrivalTime,
      sequence: nextSequence(),
      pathId: event.pathId,
      operationId: event.operationId,
      idempotencyKey: event.idempotencyKey,
      attempt: event.attempt,
      deliveryIndex: d,
      deduplicated: false,
    });
  }

  // Schedule deadline check (one per attempt, not per delivery)
  if (event.deliveryIndex === 0) {
    enqueue.push({
      type: '_DeadlineCheck',
      timestamp: event.timestamp + path.deadlineMs,
      sequence: nextSequence(),
      pathId: event.pathId,
      operationId: event.operationId,
      attempt: event.attempt,
      deliveryIndex: 0,
      circuitGeneration: circuitGen,
    });
  }

  return { enqueue, log: true };
}

// ─── T2: RequestArrived → Process ────────────────────────────────────────────
// (4a) Service error check
// (4b) Idempotency check
// (4c) Process: side-effect + ResponseSent

function processRequestArrived(
  event: Extract<SimEvent, { type: 'RequestArrived' }>,
  state: PipelineState,
  prng: PRNG,
  nextSequence: () => number,
): ProcessResult {
  const path = state.paths.get(event.pathId);
  if (!path) return { enqueue: [], log: true };

  const enqueue: QueueEvent[] = [];

  // (4a) Service error check — before idempotency and side-effect
  for (const failure of path.failures) {
    if (failure.type === 'serviceError') {
      if (prng.nextFloat() < failure.probability) {
        // Service error — no side-effect, not cached, retryable
        enqueue.push({
          type: 'ResponseSent',
          timestamp: event.timestamp,
          sequence: nextSequence(),
          pathId: event.pathId,
          operationId: event.operationId,
          success: false,
          deduplicated: false,
        });
        return { enqueue, log: true };
      }
    }
  }

  // (4b) Idempotency check
  if (path.resilience.idempotencyEnabled) {
    const idempKey = IdempotencyRegistry.buildKey(
      path.destination,
      path.operationName,
      event.idempotencyKey,
    );
    const cached = state.idempotency.lookup(idempKey);
    if (cached) {
      enqueue.push({
        type: 'ResponseSent',
        timestamp: event.timestamp,
        sequence: nextSequence(),
        pathId: event.pathId,
        operationId: event.operationId,
        success: true,
        deduplicated: true,
      });
      return { enqueue, log: true, logAs: { ...event, deduplicated: true } };
    }
  }

  // (4c) Process: emit side-effect if configured
  if (path.sideEffect) {
    enqueue.push({
      type: 'SideEffect',
      timestamp: event.timestamp,
      sequence: nextSequence(),
      serviceId: path.destination,
      effectName: path.sideEffect,
      operationId: event.operationId,
    });
  }

  // Store in idempotency registry (success-only)
  if (path.resilience.idempotencyEnabled) {
    const idempKey = IdempotencyRegistry.buildKey(
      path.destination,
      path.operationName,
      event.idempotencyKey,
    );
    state.idempotency.store(idempKey, { success: true });
  }

  // Emit ResponseSent (success)
  enqueue.push({
    type: 'ResponseSent',
    timestamp: event.timestamp,
    sequence: nextSequence(),
    pathId: event.pathId,
    operationId: event.operationId,
    success: true,
    deduplicated: false,
  });

  return { enqueue, log: true };
}

// ─── T3: ResponseSent → ResponseReceived ─────────────────────────────────────

function processResponseSent(
  event: Extract<SimEvent, { type: 'ResponseSent' }>,
  state: PipelineState,
  prng: PRNG,
  nextSequence: () => number,
): ProcessResult {
  const path = state.paths.get(event.pathId);
  if (!path) return { enqueue: [], log: true };

  // Check for response loss (only for successful responses or all?)
  // Per spec: loss applies to any response on the path
  for (const failure of path.failures) {
    if (failure.type === 'lostResponse') {
      if (prng.nextFloat() < failure.probability) {
        const enqueue: QueueEvent[] = [
          {
            type: 'ResponseLost',
            timestamp: event.timestamp,
            sequence: nextSequence(),
            pathId: event.pathId,
            operationId: event.operationId,
          },
        ];
        return { enqueue, log: true };
      }
    }
  }

  // Calculate response latency
  let responseLatency = 0;
  for (const failure of path.failures) {
    if (failure.type === 'fixedLatency') {
      if (prng.nextFloat() < failure.probability) {
        responseLatency += failure.ms;
      }
    } else if (failure.type === 'randomLatency') {
      if (prng.nextFloat() < failure.probability) {
        responseLatency += prng.nextRange(Math.round(failure.minMs), Math.round(failure.maxMs));
      }
    }
  }

  // Find the relevant attempt state for latency calculation
  let sentAt = 0;
  for (const [, attempt] of state.attempts) {
    if (attempt.operationId === event.operationId && attempt.pathId === event.pathId) {
      sentAt = attempt.sentAt;
      break; // Use the first matching (all share the same sentAt within an attempt)
    }
  }

  const receiveTime = event.timestamp + responseLatency;
  const totalLatency = receiveTime - sentAt;

  const enqueue: QueueEvent[] = [
    {
      type: 'ResponseReceived',
      timestamp: receiveTime,
      sequence: nextSequence(),
      pathId: event.pathId,
      operationId: event.operationId,
      success: event.success,
      deduplicated: event.deduplicated,
      late: false,
      latency: totalLatency,
    },
  ];

  return { enqueue, log: true };
}

// ─── T4: ResponseReceived ────────────────────────────────────────────────────
// Circuit state is updated once per caller-visible attempt outcome (not per delivery).

function processResponseReceived(
  event: Extract<SimEvent, { type: 'ResponseReceived' }>,
  state: PipelineState,
): ProcessResult {
  // Find the primary attempt state (deliveryIndex=0 for this attempt level)
  let primaryAttempt: OperationAttemptState | undefined;
  for (const [, attempt] of state.attempts) {
    if (
      attempt.operationId === event.operationId &&
      attempt.pathId === event.pathId &&
      attempt.deliveryIndex === 0
    ) {
      if (!primaryAttempt || attempt.attempt > primaryAttempt.attempt) {
        primaryAttempt = attempt;
      }
    }
  }

  if (!primaryAttempt || primaryAttempt.resolved) {
    // Already resolved — late response
    return { enqueue: [], log: true, logAs: { ...event, late: true } };
  }

  // Mark the primary attempt as resolved
  primaryAttempt.resolved = true;

  // Update circuit breaker state (once per caller-visible outcome)
  const circuitState = state.circuits.get(event.pathId);
  const path = state.paths.get(event.pathId);
  if (circuitState && path?.resilience.circuitBreaker) {
    recordOutcome(
      circuitState,
      path.resilience.circuitBreaker,
      primaryAttempt.circuitGeneration,
      event.success,
      event.timestamp,
    );
  }

  return { enqueue: [], log: true };
}

// ─── Internal: DeadlineCheck → TimeoutError + optional Retry ─────────────────

function processDeadlineCheck(
  event: DeadlineCheckEvent,
  state: PipelineState,
  prng: PRNG,
  nextSequence: () => number,
): ProcessResult {
  const key = attemptKey(event.operationId, event.attempt, event.deliveryIndex);
  const attemptState = state.attempts.get(key);

  if (!attemptState || attemptState.resolved) {
    return { enqueue: [], log: false };
  }

  // Timeout fires
  attemptState.resolved = true;

  const enqueue: QueueEvent[] = [];

  // Emit TimeoutError
  const timeoutEvent: SimEvent = {
    type: 'TimeoutError',
    timestamp: event.timestamp,
    sequence: nextSequence(),
    pathId: event.pathId,
    operationId: event.operationId,
    attempt: event.attempt,
  };
  enqueue.push(timeoutEvent);

  // Update circuit breaker (timeout = failure)
  const circuitState = state.circuits.get(event.pathId);
  const path = state.paths.get(event.pathId);
  if (circuitState && path?.resilience.circuitBreaker) {
    const result = recordOutcome(
      circuitState,
      path.resilience.circuitBreaker,
      event.circuitGeneration,
      false,
      event.timestamp,
    );
    if (result.stateChanged && result.newState) {
      enqueue.push({
        type: 'CircuitStateChange',
        timestamp: event.timestamp,
        sequence: nextSequence(),
        pathId: event.pathId,
        newState: result.newState,
        generation: circuitState.generation,
      });
    }
  }

  // Check retry budget (timeout is retryable)
  const budget = state.budgets.get(event.operationId);
  if (path?.resilience.retry && budget && budget.retriesUsed < budget.maxRetries) {
    budget.retriesUsed++;
    const nextAttempt = event.attempt + 1;
    const delay = computeRetryDelay(event.attempt, path.resilience.retry, prng);

    enqueue.push({
      type: 'RetryScheduled',
      timestamp: event.timestamp,
      sequence: nextSequence(),
      pathId: event.pathId,
      operationId: event.operationId,
      nextAttempt,
      delay,
    });

    enqueue.push({
      type: 'RequestSent',
      timestamp: event.timestamp + delay,
      sequence: nextSequence(),
      pathId: event.pathId,
      operationId: event.operationId,
      idempotencyKey: attemptState.idempotencyKey,
      attempt: nextAttempt,
      deliveryIndex: 0,
    });
  }

  return { enqueue, log: false };
}

// ─── T4 (service error received): update circuit + schedule retry ─────────────

function processServiceErrorReceived(
  event: Extract<SimEvent, { type: 'ResponseReceived' }>,
  state: PipelineState,
  prng: PRNG,
  nextSequence: () => number,
): ProcessResult {
  // Find the primary attempt
  let primaryAttempt: OperationAttemptState | undefined;
  for (const [, attempt] of state.attempts) {
    if (
      attempt.operationId === event.operationId &&
      attempt.pathId === event.pathId &&
      attempt.deliveryIndex === 0
    ) {
      if (!primaryAttempt || attempt.attempt > primaryAttempt.attempt) {
        primaryAttempt = attempt;
      }
    }
  }

  if (!primaryAttempt || primaryAttempt.resolved) {
    return { enqueue: [], log: true, logAs: { ...event, late: true } };
  }

  primaryAttempt.resolved = true;
  const enqueue: QueueEvent[] = [];

  // Update circuit breaker (service error = failure)
  const circuitState = state.circuits.get(event.pathId);
  const path = state.paths.get(event.pathId);
  if (circuitState && path?.resilience.circuitBreaker) {
    const result = recordOutcome(
      circuitState,
      path.resilience.circuitBreaker,
      primaryAttempt.circuitGeneration,
      false,
      event.timestamp,
    );
    if (result.stateChanged && result.newState) {
      enqueue.push({
        type: 'CircuitStateChange',
        timestamp: event.timestamp,
        sequence: nextSequence(),
        pathId: event.pathId,
        newState: result.newState,
        generation: circuitState.generation,
      });
    }
  }

  // Service error is retryable
  const budget = state.budgets.get(event.operationId);
  if (path?.resilience.retry && budget && budget.retriesUsed < budget.maxRetries) {
    budget.retriesUsed++;
    const nextAttempt = primaryAttempt.attempt + 1;
    const delay = computeRetryDelay(primaryAttempt.attempt, path.resilience.retry, prng);

    enqueue.push({
      type: 'RetryScheduled',
      timestamp: event.timestamp,
      sequence: nextSequence(),
      pathId: event.pathId,
      operationId: event.operationId,
      nextAttempt,
      delay,
    });

    enqueue.push({
      type: 'RequestSent',
      timestamp: event.timestamp + delay,
      sequence: nextSequence(),
      pathId: event.pathId,
      operationId: event.operationId,
      idempotencyKey: primaryAttempt.idempotencyKey,
      attempt: nextAttempt,
      deliveryIndex: 0,
    });
  }

  return { enqueue, log: true };
}

// ─── Main Dispatcher ─────────────────────────────────────────────────────────

export function processPipelineEvent(
  event: QueueEvent,
  state: PipelineState,
  prng: PRNG,
  nextSequence: () => number,
): ProcessResult {
  switch (event.type) {
    case 'RequestSent':
      return processRequestSent(event, state, prng, nextSequence);
    case 'RequestArrived':
      return processRequestArrived(event, state, prng, nextSequence);
    case 'ResponseSent':
      return processResponseSent(event, state, prng, nextSequence);
    case 'ResponseReceived':
      // Route based on success/failure
      if (!event.success) {
        return processServiceErrorReceived(event, state, prng, nextSequence);
      }
      return processResponseReceived(event, state);
    case '_DeadlineCheck':
      return processDeadlineCheck(event, state, prng, nextSequence);
    default:
      return { enqueue: [], log: true };
  }
}
