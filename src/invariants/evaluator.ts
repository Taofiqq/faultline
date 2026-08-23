/**
 * Invariant Evaluator — evaluates 5 built-in invariant types against an EventLog.
 *
 * Evidence rules:
 * - Every evidence entry references a real event (sequence + timestamp from the log).
 * - Generic explanations go in the result `message` field, not in evidence.
 * - Empty logs may produce empty evidence arrays.
 */

import type { EventLog } from '../engine/types';
import type { Invariant } from '../scenario/types';

export interface InvariantEvidence {
  sequence: number;
  timestamp: number;
  description: string;
}

export interface InvariantResult {
  invariantId: string;
  type: Invariant['type'];
  passed: boolean;
  actual: number;
  threshold: number;
  message: string;
  evidence: InvariantEvidence[];
}

export function evaluateInvariants(log: EventLog, invariants: Invariant[]): InvariantResult[] {
  return invariants.map((inv) => evaluateOne(log, inv));
}

function evaluateOne(log: EventLog, inv: Invariant): InvariantResult {
  switch (inv.type) {
    case 'maxSideEffectCount':
      return evalMaxSideEffectCount(log, inv);
    case 'maxRequestCount':
      return evalMaxRequestCount(log, inv);
    case 'requiredSuccessCount':
      return evalRequiredSuccessCount(log, inv);
    case 'maxCompletionTime':
      return evalMaxCompletionTime(log, inv);
    case 'noPendingRequests':
      return evalNoPendingRequests(log, inv);
  }
}

function evalMaxSideEffectCount(
  log: EventLog,
  inv: Extract<Invariant, { type: 'maxSideEffectCount' }>,
): InvariantResult {
  const matching = log.filter((e) => e.type === 'SideEffect' && e.effectName === inv.effectName);
  const actual = matching.length;
  const passed = actual <= inv.maxCount;
  const evidence: InvariantEvidence[] = passed
    ? []
    : matching.map((e) => ({
        sequence: e.sequence,
        timestamp: e.timestamp,
        description: `SideEffect "${inv.effectName}" at t=${e.timestamp}`,
      }));

  return {
    invariantId: inv.id,
    type: inv.type,
    passed,
    actual,
    threshold: inv.maxCount,
    message: passed
      ? `Effect "${inv.effectName}" occurred ${actual} time(s), within limit of ${inv.maxCount}`
      : `Effect "${inv.effectName}" occurred ${actual} time(s), exceeding limit of ${inv.maxCount}`,
    evidence,
  };
}

function evalMaxRequestCount(
  log: EventLog,
  inv: Extract<Invariant, { type: 'maxRequestCount' }>,
): InvariantResult {
  const matching = log.filter((e) => e.type === 'RequestArrived' && e.pathId === inv.pathId);
  const actual = matching.length;
  const passed = actual <= inv.maxCount;
  const evidence: InvariantEvidence[] = passed
    ? []
    : matching.map((e) => ({
        sequence: e.sequence,
        timestamp: e.timestamp,
        description: `RequestArrived on path "${inv.pathId}" at t=${e.timestamp}`,
      }));

  return {
    invariantId: inv.id,
    type: inv.type,
    passed,
    actual,
    threshold: inv.maxCount,
    message: passed
      ? `Path "${inv.pathId}" received ${actual} request(s), within limit of ${inv.maxCount}`
      : `Path "${inv.pathId}" received ${actual} request(s), exceeding limit of ${inv.maxCount}`,
    evidence,
  };
}

function evalRequiredSuccessCount(
  log: EventLog,
  inv: Extract<Invariant, { type: 'requiredSuccessCount' }>,
): InvariantResult {
  const matching = log.filter(
    (e) =>
      e.type === 'ResponseReceived' &&
      e.pathId === inv.pathId &&
      e.success === true &&
      e.late === false &&
      e.deduplicated === false,
  );
  const actual = matching.length;
  const passed = actual >= inv.minCount;

  // For failures, reference terminal events that were NOT successes
  // (timeouts, service errors, circuit-open errors) on this path
  const evidence: InvariantEvidence[] = [];
  if (!passed) {
    for (const e of log) {
      if (e.type === 'TimeoutError' && e.pathId === inv.pathId) {
        evidence.push({
          sequence: e.sequence,
          timestamp: e.timestamp,
          description: `TimeoutError on path "${inv.pathId}" at t=${e.timestamp}`,
        });
      } else if (
        e.type === 'ResponseReceived' &&
        e.pathId === inv.pathId &&
        !e.success &&
        !e.late
      ) {
        evidence.push({
          sequence: e.sequence,
          timestamp: e.timestamp,
          description: `Service error response on path "${inv.pathId}" at t=${e.timestamp}`,
        });
      } else if (e.type === 'CircuitOpenError' && e.pathId === inv.pathId) {
        evidence.push({
          sequence: e.sequence,
          timestamp: e.timestamp,
          description: `CircuitOpenError on path "${inv.pathId}" at t=${e.timestamp}`,
        });
      }
    }
  }

  return {
    invariantId: inv.id,
    type: inv.type,
    passed,
    actual,
    threshold: inv.minCount,
    message: passed
      ? `Path "${inv.pathId}" completed ${actual} success(es), meeting requirement of ${inv.minCount}`
      : `Path "${inv.pathId}" completed ${actual} success(es), below requirement of ${inv.minCount}`,
    evidence,
  };
}

function evalMaxCompletionTime(
  log: EventLog,
  inv: Extract<Invariant, { type: 'maxCompletionTime' }>,
): InvariantResult {
  const lastEvent = log.length > 0 ? log[log.length - 1]! : undefined;
  const actual = lastEvent?.timestamp ?? 0;
  const passed = actual <= inv.maxMs;
  const evidence: InvariantEvidence[] =
    !passed && lastEvent
      ? [
          {
            sequence: lastEvent.sequence,
            timestamp: lastEvent.timestamp,
            description: `Final event at t=${actual}ms exceeds limit of ${inv.maxMs}ms`,
          },
        ]
      : [];

  return {
    invariantId: inv.id,
    type: inv.type,
    passed,
    actual,
    threshold: inv.maxMs,
    message: passed
      ? `Simulation completed at t=${actual}ms, within limit of ${inv.maxMs}ms`
      : `Simulation completed at t=${actual}ms, exceeding limit of ${inv.maxMs}ms`,
    evidence,
  };
}

function evalNoPendingRequests(
  log: EventLog,
  inv: Extract<Invariant, { type: 'noPendingRequests' }>,
): InvariantResult {
  const terminals = new Set<string>();

  for (const e of log) {
    if (e.type === 'ResponseReceived') {
      terminals.add(`${e.operationId}:${e.attempt}`);
    } else if (e.type === 'TimeoutError') {
      terminals.add(`${e.operationId}:${e.attempt}`);
    } else if (e.type === 'CircuitOpenError') {
      terminals.add(`${e.operationId}:${e.attempt}`);
    }
  }

  const evidence: InvariantEvidence[] = [];
  for (const e of log) {
    if (e.type === 'RequestSent') {
      const key = `${e.operationId}:${e.attempt}`;
      if (!terminals.has(key)) {
        evidence.push({
          sequence: e.sequence,
          timestamp: e.timestamp,
          description: `RequestSent (op=${e.operationId}, attempt=${e.attempt}) has no terminal event`,
        });
      }
    }
  }

  const actual = evidence.length;
  const passed = actual === 0;

  return {
    invariantId: inv.id,
    type: inv.type,
    passed,
    actual,
    threshold: 0,
    message: passed
      ? 'All requests have terminal events'
      : `${actual} request(s) have no terminal event`,
    evidence,
  };
}
