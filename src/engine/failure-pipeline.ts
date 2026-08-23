/**
 * Failure Pipeline — Multi-event transitions T1–T4.
 *
 * Milestone 4 (minimal slice): No retries, idempotency, network duplication,
 * service errors, or circuit breakers. Those are added in M5–M6.
 */

import type { SimEvent } from './types';
import type { PRNG } from './prng';
import type { Scenario, Path } from '../scenario/types';

// ─── Internal Event: Deadline Check ──────────────────────────────────────────
// Not part of the public event log. Used internally to schedule timeout checks.

export interface DeadlineCheckEvent {
  type: '_DeadlineCheck';
  timestamp: number;
  sequence: number;
  pathId: string;
  operationId: number;
  attempt: number;
  deliveryIndex: number;
}

/** Union of public SimEvents and internal events for the queue. */
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

export interface PipelineState {
  attempts: Map<string, OperationAttemptState>;
  paths: Map<string, Path>;
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
    paths,
    nextOperationId: 1,
  };
}

// ─── Pipeline Processor Result ───────────────────────────────────────────────

export interface ProcessResult {
  /** Events to enqueue (may include internal _DeadlineCheck) */
  enqueue: QueueEvent[];
  /** Whether the current event should be logged (false = suppress from log) */
  log: boolean;
  /** Optional replacement event to log instead of the original */
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

  // Emit side-effect if configured (successful, non-deduplicated)
  if (path.sideEffect && !event.deduplicated) {
    enqueue.push({
      type: 'SideEffect',
      timestamp: event.timestamp,
      sequence: nextSequence(),
      serviceId: path.destination,
      effectName: path.sideEffect,
      operationId: event.operationId,
    });
  }

  // Emit ResponseSent (success)
  enqueue.push({
    type: 'ResponseSent',
    timestamp: event.timestamp,
    sequence: nextSequence(),
    pathId: event.pathId,
    operationId: event.operationId,
    success: true,
    deduplicated: event.deduplicated,
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

  // Calculate response latency (apply latency injections again for response path)
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
  const key = attemptKey(event.operationId, 0, 0); // M4: always attempt 0, delivery 0
  const attemptState = state.attempts.get(key);
  const sentAt = attemptState?.sentAt ?? 0;
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
      late: false, // determined at T4
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
  const key = attemptKey(event.operationId, 0, 0); // M4: attempt 0, delivery 0
  const attemptState = state.attempts.get(key);

  if (!attemptState || attemptState.resolved) {
    // Attempt already resolved (timeout fired first) — this is a late response
    return { enqueue: [], log: true, logAs: { ...event, late: true } };
  }

  // Mark attempt as resolved
  attemptState.resolved = true;
  return { enqueue: [], log: true };
}

// ─── Internal: DeadlineCheck ─────────────────────────────────────────────────

function processDeadlineCheck(
  event: DeadlineCheckEvent,
  state: PipelineState,
  nextSequence: () => number,
): ProcessResult {
  const key = attemptKey(event.operationId, event.attempt, event.deliveryIndex);
  const attemptState = state.attempts.get(key);

  if (!attemptState || attemptState.resolved) {
    // Response already arrived — timeout is a no-op, suppress from log
    return { enqueue: [], log: false };
  }

  // Timeout fires — mark resolved and emit TimeoutError
  attemptState.resolved = true;

  const timeoutEvent: SimEvent = {
    type: 'TimeoutError',
    timestamp: event.timestamp,
    sequence: nextSequence(),
    pathId: event.pathId,
    operationId: event.operationId,
    attempt: event.attempt,
  };

  return { enqueue: [timeoutEvent], log: false };
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
      return processDeadlineCheck(event, state, nextSequence);
    default:
      return { enqueue: [], log: true };
  }
}
