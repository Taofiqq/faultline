/**
 * Failure Pipeline — Multi-event transitions T1–T4.
 *
 * M5: Adds retry scheduling and idempotency registry.
 * Not yet: network duplication, service errors, circuit breakers.
 */

import type { SimEvent } from './types';
import type { PRNG } from './prng';
import type { Scenario, Path } from '../scenario/types';
import { computeRetryDelay } from './retry-scheduler';
import { IdempotencyRegistry } from './idempotency-registry';

// ─── Internal Event: Deadline Check ──────────────────────────────────────────

export interface DeadlineCheckEvent {
  type: '_DeadlineCheck';
  timestamp: number;
  sequence: number;
  pathId: string;
  operationId: number;
  attempt: number;
  deliveryIndex: number;
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
}

/** Tracks retry budget per logical operation */
export interface OperationBudget {
  maxRetries: number;
  retriesUsed: number;
}

export interface PipelineState {
  attempts: Map<string, OperationAttemptState>;
  budgets: Map<number, OperationBudget>; // operationId → budget
  paths: Map<string, Path>;
  idempotency: IdempotencyRegistry;
  nextOperationId: number;
}

function attemptKey(operationId: number, attempt: number, deliveryIndex: number): string {
  return `${operationId}:${attempt}:${deliveryIndex}`;
}

export function createPipelineState(scenario: Scenario): PipelineState {
  const paths = new Map<string, Path>();
  for (const p of scenario.paths) {
    paths.set(p.id, p);
  }
  return {
    attempts: new Map(),
    budgets: new Map(),
    paths,
    idempotency: new IdempotencyRegistry(),
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

function processRequestSent(
  event: Extract<SimEvent, { type: 'RequestSent' }>,
  state: PipelineState,
  prng: PRNG,
  nextSequence: () => number,
): ProcessResult {
  const path = state.paths.get(event.pathId);
  if (!path) return { enqueue: [], log: true };

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
  });

  // Initialize retry budget on first attempt
  if (event.attempt === 0 && path.resilience.retry) {
    state.budgets.set(event.operationId, {
      maxRetries: path.resilience.retry.maxRetries,
      retriesUsed: 0,
    });
  }

  // Calculate request latency
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

  // Emit RequestArrived
  enqueue.push({
    type: 'RequestArrived',
    timestamp: arrivalTime,
    sequence: nextSequence(),
    pathId: event.pathId,
    operationId: event.operationId,
    idempotencyKey: event.idempotencyKey,
    attempt: event.attempt,
    deliveryIndex: event.deliveryIndex,
    deduplicated: false,
  });

  // Schedule deadline check
  enqueue.push({
    type: '_DeadlineCheck',
    timestamp: event.timestamp + path.deadlineMs,
    sequence: nextSequence(),
    pathId: event.pathId,
    operationId: event.operationId,
    attempt: event.attempt,
    deliveryIndex: event.deliveryIndex,
  });

  return { enqueue, log: true };
}

// ─── T2: RequestArrived → Process ────────────────────────────────────────────

function processRequestArrived(
  event: Extract<SimEvent, { type: 'RequestArrived' }>,
  state: PipelineState,
  _prng: PRNG,
  nextSequence: () => number,
): ProcessResult {
  const path = state.paths.get(event.pathId);
  if (!path) return { enqueue: [], log: true };

  const enqueue: QueueEvent[] = [];

  // Idempotency check
  if (path.resilience.idempotencyEnabled) {
    const idempKey = IdempotencyRegistry.buildKey(
      path.destination,
      path.operationName,
      event.idempotencyKey,
    );
    const cached = state.idempotency.lookup(idempKey);
    if (cached) {
      // Deduplicated — return cached response, no side-effect
      enqueue.push({
        type: 'ResponseSent',
        timestamp: event.timestamp,
        sequence: nextSequence(),
        pathId: event.pathId,
        operationId: event.operationId,
        success: true,
        deduplicated: true,
      });
      // Log the arrival as deduplicated
      return {
        enqueue,
        log: true,
        logAs: { ...event, deduplicated: true },
      };
    }
  }

  // Process: emit side-effect if configured
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

  // Store in idempotency registry (success-only, before response is sent)
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

  // Check for response loss
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

  // Find the attempt state to calculate total latency
  // Look for any attempt with matching operationId (use the most recent attempt)
  let sentAt = 0;
  for (const [, attempt] of state.attempts) {
    if (attempt.operationId === event.operationId && attempt.pathId === event.pathId) {
      sentAt = attempt.sentAt;
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

function processResponseReceived(
  event: Extract<SimEvent, { type: 'ResponseReceived' }>,
  state: PipelineState,
): ProcessResult {
  // Find the latest unresolved attempt for this operation
  let latestAttempt: OperationAttemptState | undefined;
  for (const [, attempt] of state.attempts) {
    if (attempt.operationId === event.operationId && attempt.pathId === event.pathId) {
      if (!latestAttempt || attempt.attempt > latestAttempt.attempt) {
        latestAttempt = attempt;
      }
    }
  }

  if (!latestAttempt || latestAttempt.resolved) {
    // All attempts resolved — this is a late response
    return { enqueue: [], log: true, logAs: { ...event, late: true } };
  }

  // Mark attempt as resolved
  latestAttempt.resolved = true;
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

  // Check retry budget
  const path = state.paths.get(event.pathId);
  const budget = state.budgets.get(event.operationId);
  if (path?.resilience.retry && budget && budget.retriesUsed < budget.maxRetries) {
    budget.retriesUsed++;
    const nextAttempt = event.attempt + 1;
    const delay = computeRetryDelay(event.attempt, path.resilience.retry, prng);

    // Emit RetryScheduled
    const retryScheduled: SimEvent = {
      type: 'RetryScheduled',
      timestamp: event.timestamp,
      sequence: nextSequence(),
      pathId: event.pathId,
      operationId: event.operationId,
      nextAttempt,
      delay,
    };
    enqueue.push(retryScheduled);

    // Schedule new RequestSent for the retry
    const retryEvent: SimEvent = {
      type: 'RequestSent',
      timestamp: event.timestamp + delay,
      sequence: nextSequence(),
      pathId: event.pathId,
      operationId: event.operationId,
      idempotencyKey: attemptState.idempotencyKey,
      attempt: nextAttempt,
      deliveryIndex: 0,
    };
    enqueue.push(retryEvent);
  }

  return { enqueue, log: false };
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
      return processResponseReceived(event, state);
    case '_DeadlineCheck':
      return processDeadlineCheck(event, state, prng, nextSequence);
    default:
      return { enqueue: [], log: true };
  }
}
