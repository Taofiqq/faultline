/**
 * Failure Pipeline — Multi-event transitions T1–T4.
 *
 * Full attempt/deliveryIndex correlation. All circuit transitions logged.
 * Service errors evaluated before side-effects and never cached.
 * Network duplication independent of retries.
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

// ─── Internal Event ──────────────────────────────────────────────────────────

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

// ─── State ───────────────────────────────────────────────────────────────────

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
  circuits: Map<string, CircuitBreakerState>;
  nextOperationId: number;
}

function attemptKey(opId: number, attempt: number, delivery: number): string {
  return `${opId}:${attempt}:${delivery}`;
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

// ─── Result ──────────────────────────────────────────────────────────────────

export interface ProcessResult {
  enqueue: QueueEvent[];
  log: boolean;
  logAs?: SimEvent;
}

// ─── T1: RequestSent ─────────────────────────────────────────────────────────

function processRequestSent(
  event: Extract<SimEvent, { type: 'RequestSent' }>,
  state: PipelineState,
  prng: PRNG,
  nextSeq: () => number,
): ProcessResult {
  const path = state.paths.get(event.pathId);
  if (!path) return { enqueue: [], log: true };

  const circuitState = state.circuits.get(event.pathId);
  const cbConfig = path.resilience.circuitBreaker;
  let circuitGen = circuitState?.generation ?? 0;
  const enqueue: QueueEvent[] = [];

  // Circuit check
  if (circuitState && cbConfig) {
    const prevStatus = circuitState.status;
    const decision = checkCircuit(circuitState, cbConfig, event.timestamp, event.sequence);

    // Emit open→half-open transition
    if (prevStatus === 'open' && circuitState.status === 'half-open') {
      enqueue.push({
        type: 'CircuitStateChange',
        timestamp: event.timestamp,
        sequence: nextSeq(),
        pathId: event.pathId,
        newState: 'half-open',
        generation: circuitState.generation,
      });
    }

    if (decision === 'reject') {
      enqueue.push({
        type: 'CircuitOpenError',
        timestamp: event.timestamp,
        sequence: nextSeq(),
        pathId: event.pathId,
        operationId: event.operationId,
        attempt: event.attempt,
        deliveryIndex: event.deliveryIndex,
      });
      return { enqueue, log: true };
    }
    circuitGen = circuitState.generation;
  }

  // Track attempt
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

  // Init retry budget (once per operation)
  if (event.attempt === 0 && event.deliveryIndex === 0 && path.resilience.retry) {
    state.budgets.set(event.operationId, {
      maxRetries: path.resilience.retry.maxRetries,
      retriesUsed: 0,
    });
  }

  // Request latency
  let latency = 0;
  for (const f of path.failures) {
    if (f.type === 'fixedLatency' && prng.nextFloat() < f.probability) {
      latency += f.ms;
    } else if (f.type === 'randomLatency' && prng.nextFloat() < f.probability) {
      latency += prng.nextRange(Math.round(f.minMs), Math.round(f.maxMs));
    }
  }

  // Network duplication
  let totalDeliveries = 1;
  for (const f of path.failures) {
    if (f.type === 'duplicateRequest' && prng.nextFloat() < f.probability) {
      totalDeliveries = f.count;
    }
  }

  const arrivalTime = event.timestamp + latency;

  // Original delivery
  enqueue.push({
    type: 'RequestArrived',
    timestamp: arrivalTime,
    sequence: nextSeq(),
    pathId: event.pathId,
    operationId: event.operationId,
    idempotencyKey: event.idempotencyKey,
    attempt: event.attempt,
    deliveryIndex: 0,
    deduplicated: false,
  });

  // Copies
  for (let d = 1; d < totalDeliveries; d++) {
    state.attempts.set(attemptKey(event.operationId, event.attempt, d), {
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
      sequence: nextSeq(),
      pathId: event.pathId,
      operationId: event.operationId,
      idempotencyKey: event.idempotencyKey,
      attempt: event.attempt,
      deliveryIndex: d,
      deduplicated: false,
    });
  }

  // Deadline (once per attempt)
  if (event.deliveryIndex === 0) {
    enqueue.push({
      type: '_DeadlineCheck',
      timestamp: event.timestamp + path.deadlineMs,
      sequence: nextSeq(),
      pathId: event.pathId,
      operationId: event.operationId,
      attempt: event.attempt,
      deliveryIndex: 0,
      circuitGeneration: circuitGen,
    });
  }

  return { enqueue, log: true };
}

// ─── T2: RequestArrived ──────────────────────────────────────────────────────

function processRequestArrived(
  event: Extract<SimEvent, { type: 'RequestArrived' }>,
  state: PipelineState,
  prng: PRNG,
  nextSeq: () => number,
): ProcessResult {
  const path = state.paths.get(event.pathId);
  if (!path) return { enqueue: [], log: true };
  const enqueue: QueueEvent[] = [];

  // Service error (before idempotency and side-effect)
  for (const f of path.failures) {
    if (f.type === 'serviceError' && prng.nextFloat() < f.probability) {
      enqueue.push({
        type: 'ResponseSent',
        timestamp: event.timestamp,
        sequence: nextSeq(),
        pathId: event.pathId,
        operationId: event.operationId,
        attempt: event.attempt,
        deliveryIndex: event.deliveryIndex,
        success: false,
        deduplicated: false,
      });
      return { enqueue, log: true };
    }
  }

  // Idempotency check
  if (path.resilience.idempotencyEnabled) {
    const idempKey = IdempotencyRegistry.buildKey(
      path.destination,
      path.operationName,
      event.idempotencyKey,
    );
    if (state.idempotency.lookup(idempKey)) {
      enqueue.push({
        type: 'ResponseSent',
        timestamp: event.timestamp,
        sequence: nextSeq(),
        pathId: event.pathId,
        operationId: event.operationId,
        attempt: event.attempt,
        deliveryIndex: event.deliveryIndex,
        success: true,
        deduplicated: true,
      });
      return { enqueue, log: true, logAs: { ...event, deduplicated: true } };
    }
  }

  // Side-effect
  if (path.sideEffect) {
    enqueue.push({
      type: 'SideEffect',
      timestamp: event.timestamp,
      sequence: nextSeq(),
      serviceId: path.destination,
      effectName: path.sideEffect,
      operationId: event.operationId,
      attempt: event.attempt,
      deliveryIndex: event.deliveryIndex,
    });
  }

  // Cache success
  if (path.resilience.idempotencyEnabled) {
    const idempKey = IdempotencyRegistry.buildKey(
      path.destination,
      path.operationName,
      event.idempotencyKey,
    );
    state.idempotency.store(idempKey, { success: true });
  }

  // ResponseSent
  enqueue.push({
    type: 'ResponseSent',
    timestamp: event.timestamp,
    sequence: nextSeq(),
    pathId: event.pathId,
    operationId: event.operationId,
    attempt: event.attempt,
    deliveryIndex: event.deliveryIndex,
    success: true,
    deduplicated: false,
  });

  return { enqueue, log: true };
}

// ─── T3: ResponseSent ────────────────────────────────────────────────────────

function processResponseSent(
  event: Extract<SimEvent, { type: 'ResponseSent' }>,
  state: PipelineState,
  prng: PRNG,
  nextSeq: () => number,
): ProcessResult {
  const path = state.paths.get(event.pathId);
  if (!path) return { enqueue: [], log: true };

  // Response loss
  for (const f of path.failures) {
    if (f.type === 'lostResponse' && prng.nextFloat() < f.probability) {
      return {
        enqueue: [
          {
            type: 'ResponseLost',
            timestamp: event.timestamp,
            sequence: nextSeq(),
            pathId: event.pathId,
            operationId: event.operationId,
            attempt: event.attempt,
            deliveryIndex: event.deliveryIndex,
          },
        ],
        log: true,
      };
    }
  }

  // Response latency
  let latency = 0;
  for (const f of path.failures) {
    if (f.type === 'fixedLatency' && prng.nextFloat() < f.probability) {
      latency += f.ms;
    } else if (f.type === 'randomLatency' && prng.nextFloat() < f.probability) {
      latency += prng.nextRange(Math.round(f.minMs), Math.round(f.maxMs));
    }
  }

  const key = attemptKey(event.operationId, event.attempt, event.deliveryIndex);
  const attemptState = state.attempts.get(key);
  const sentAt = attemptState?.sentAt ?? 0;
  const receiveTime = event.timestamp + latency;

  return {
    enqueue: [
      {
        type: 'ResponseReceived',
        timestamp: receiveTime,
        sequence: nextSeq(),
        pathId: event.pathId,
        operationId: event.operationId,
        attempt: event.attempt,
        deliveryIndex: event.deliveryIndex,
        success: event.success,
        deduplicated: event.deduplicated,
        late: false,
        latency: receiveTime - sentAt,
      },
    ],
    log: true,
  };
}

// ─── T4: ResponseReceived (success) ──────────────────────────────────────────

function processSuccessResponse(
  event: Extract<SimEvent, { type: 'ResponseReceived' }>,
  state: PipelineState,
  nextSeq: () => number,
): ProcessResult {
  // Resolve against the primary (deliveryIndex=0) of THIS attempt
  const primaryKey = attemptKey(event.operationId, event.attempt, 0);
  const primary = state.attempts.get(primaryKey);

  if (!primary || primary.resolved) {
    return { enqueue: [], log: true, logAs: { ...event, late: true } };
  }

  primary.resolved = true;
  const enqueue: QueueEvent[] = [];

  // Circuit breaker update
  const cs = state.circuits.get(event.pathId);
  const path = state.paths.get(event.pathId);
  if (cs && path?.resilience.circuitBreaker) {
    const r = recordOutcome(
      cs,
      path.resilience.circuitBreaker,
      primary.circuitGeneration,
      true,
      event.timestamp,
    );
    if (r.stateChanged && r.newState) {
      enqueue.push({
        type: 'CircuitStateChange',
        timestamp: event.timestamp,
        sequence: nextSeq(),
        pathId: event.pathId,
        newState: r.newState,
        generation: cs.generation,
      });
    }
  }

  return { enqueue, log: true };
}

// ─── T4: ResponseReceived (error) ────────────────────────────────────────────

function processErrorResponse(
  event: Extract<SimEvent, { type: 'ResponseReceived' }>,
  state: PipelineState,
  prng: PRNG,
  nextSeq: () => number,
): ProcessResult {
  const primaryKey = attemptKey(event.operationId, event.attempt, 0);
  const primary = state.attempts.get(primaryKey);

  if (!primary || primary.resolved) {
    return { enqueue: [], log: true, logAs: { ...event, late: true } };
  }

  primary.resolved = true;
  const enqueue: QueueEvent[] = [];

  // Circuit breaker update (failure)
  const cs = state.circuits.get(event.pathId);
  const path = state.paths.get(event.pathId);
  if (cs && path?.resilience.circuitBreaker) {
    const r = recordOutcome(
      cs,
      path.resilience.circuitBreaker,
      primary.circuitGeneration,
      false,
      event.timestamp,
    );
    if (r.stateChanged && r.newState) {
      enqueue.push({
        type: 'CircuitStateChange',
        timestamp: event.timestamp,
        sequence: nextSeq(),
        pathId: event.pathId,
        newState: r.newState,
        generation: cs.generation,
      });
    }
  }

  // Retry (service error is retryable)
  const budget = state.budgets.get(event.operationId);
  if (path?.resilience.retry && budget && budget.retriesUsed < budget.maxRetries) {
    budget.retriesUsed++;
    const nextAttempt = event.attempt + 1;
    const delay = computeRetryDelay(event.attempt, path.resilience.retry, prng);
    enqueue.push({
      type: 'RetryScheduled',
      timestamp: event.timestamp,
      sequence: nextSeq(),
      pathId: event.pathId,
      operationId: event.operationId,
      nextAttempt,
      delay,
    });
    enqueue.push({
      type: 'RequestSent',
      timestamp: event.timestamp + delay,
      sequence: nextSeq(),
      pathId: event.pathId,
      operationId: event.operationId,
      idempotencyKey: primary.idempotencyKey,
      attempt: nextAttempt,
      deliveryIndex: 0,
    });
  }

  return { enqueue, log: true };
}

// ─── DeadlineCheck → Timeout + optional Retry ────────────────────────────────

function processDeadlineCheck(
  event: DeadlineCheckEvent,
  state: PipelineState,
  prng: PRNG,
  nextSeq: () => number,
): ProcessResult {
  const key = attemptKey(event.operationId, event.attempt, event.deliveryIndex);
  const attempt = state.attempts.get(key);

  if (!attempt || attempt.resolved) return { enqueue: [], log: false };

  attempt.resolved = true;
  const enqueue: QueueEvent[] = [];

  enqueue.push({
    type: 'TimeoutError',
    timestamp: event.timestamp,
    sequence: nextSeq(),
    pathId: event.pathId,
    operationId: event.operationId,
    attempt: event.attempt,
  });

  // Circuit breaker (timeout = failure)
  const cs = state.circuits.get(event.pathId);
  const path = state.paths.get(event.pathId);
  if (cs && path?.resilience.circuitBreaker) {
    const r = recordOutcome(
      cs,
      path.resilience.circuitBreaker,
      event.circuitGeneration,
      false,
      event.timestamp,
    );
    if (r.stateChanged && r.newState) {
      enqueue.push({
        type: 'CircuitStateChange',
        timestamp: event.timestamp,
        sequence: nextSeq(),
        pathId: event.pathId,
        newState: r.newState,
        generation: cs.generation,
      });
    }
  }

  // Retry
  const budget = state.budgets.get(event.operationId);
  if (path?.resilience.retry && budget && budget.retriesUsed < budget.maxRetries) {
    budget.retriesUsed++;
    const nextAttempt = event.attempt + 1;
    const delay = computeRetryDelay(event.attempt, path.resilience.retry, prng);
    enqueue.push({
      type: 'RetryScheduled',
      timestamp: event.timestamp,
      sequence: nextSeq(),
      pathId: event.pathId,
      operationId: event.operationId,
      nextAttempt,
      delay,
    });
    enqueue.push({
      type: 'RequestSent',
      timestamp: event.timestamp + delay,
      sequence: nextSeq(),
      pathId: event.pathId,
      operationId: event.operationId,
      idempotencyKey: attempt.idempotencyKey,
      attempt: nextAttempt,
      deliveryIndex: 0,
    });
  }

  return { enqueue, log: false };
}

// ─── Dispatcher ──────────────────────────────────────────────────────────────

export function processPipelineEvent(
  event: QueueEvent,
  state: PipelineState,
  prng: PRNG,
  nextSeq: () => number,
): ProcessResult {
  switch (event.type) {
    case 'RequestSent':
      return processRequestSent(event, state, prng, nextSeq);
    case 'RequestArrived':
      return processRequestArrived(event, state, prng, nextSeq);
    case 'ResponseSent':
      return processResponseSent(event, state, prng, nextSeq);
    case 'ResponseReceived':
      return event.success
        ? processSuccessResponse(event, state, nextSeq)
        : processErrorResponse(event, state, prng, nextSeq);
    case '_DeadlineCheck':
      return processDeadlineCheck(event, state, prng, nextSeq);
    default:
      return { enqueue: [], log: true };
  }
}
