/**
 * Invariant Evaluator — evaluates 5 built-in invariant types against an EventLog.
 *
 * Counting rules:
 * - Max side-effect count: counts SideEffect events matching effectName.
 * - Max request count: counts RequestArrived events on a path (all deliveries).
 * - Required success count: counts ResponseReceived where success=true, late=false, deduplicated=false.
 * - Max completion time: checks final event timestamp.
 * - No pending requests: every RequestSent has a terminal (ResponseReceived, TimeoutError, CircuitOpenError).
 *
 * Late responses do NOT satisfy success or completion requirements.
 */

import type { SimEvent, EventLog } from '../engine/types';
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

  return { invariantId: inv.id, type: inv.type, passed, actual, threshold: inv.maxCount, evidence };
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

  return { invariantId: inv.id, type: inv.type, passed, actual, threshold: inv.maxCount, evidence };
}

function evalRequiredSuccessCount(
  log: EventLog,
  inv: Extract<Invariant, { type: 'requiredSuccessCount' }>,
): InvariantResult {
  // Count ResponseReceived where success=true, late=false, deduplicated=false
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
  const evidence: InvariantEvidence[] = passed
    ? []
    : [
        {
          sequence: 0,
          timestamp: 0,
          description: `Required ${inv.minCount} successes on path "${inv.pathId}", found ${actual}`,
        },
      ];

  return { invariantId: inv.id, type: inv.type, passed, actual, threshold: inv.minCount, evidence };
}

function evalMaxCompletionTime(
  log: EventLog,
  inv: Extract<Invariant, { type: 'maxCompletionTime' }>,
): InvariantResult {
  const lastEvent = log.length > 0 ? log[log.length - 1]! : undefined;
  const actual = lastEvent?.timestamp ?? 0;
  const passed = actual <= inv.maxMs;
  const evidence: InvariantEvidence[] = passed
    ? []
    : lastEvent
      ? [
          {
            sequence: lastEvent.sequence,
            timestamp: lastEvent.timestamp,
            description: `Simulation completed at t=${actual}ms, exceeds limit ${inv.maxMs}ms`,
          },
        ]
      : [];

  return { invariantId: inv.id, type: inv.type, passed, actual, threshold: inv.maxMs, evidence };
}

function evalNoPendingRequests(
  log: EventLog,
  inv: Extract<Invariant, { type: 'noPendingRequests' }>,
): InvariantResult {
  // Every RequestSent must have a terminal event:
  // ResponseReceived (any), TimeoutError, or CircuitOpenError
  const sent = log.filter((e) => e.type === 'RequestSent');
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

  const pending: SimEvent[] = [];
  for (const s of sent) {
    if (s.type === 'RequestSent') {
      const key = `${s.operationId}:${s.attempt}`;
      if (!terminals.has(key)) {
        pending.push(s);
      }
    }
  }

  const actual = pending.length;
  const passed = actual === 0;
  const evidence: InvariantEvidence[] = pending.map((e) => ({
    sequence: e.sequence,
    timestamp: e.timestamp,
    description: `RequestSent (op=${(e as { operationId: number }).operationId}, attempt=${(e as { attempt: number }).attempt}) has no terminal event`,
  }));

  return { invariantId: inv.id, type: inv.type, passed, actual, threshold: 0, evidence };
}
