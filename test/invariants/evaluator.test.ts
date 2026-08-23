import { describe, it, expect } from 'vitest';
import { evaluateInvariants } from '../../src/invariants/evaluator';
import { simulateScenario } from '../../src/engine/simulate-scenario';
import {
  createPaymentDoubleChargeScenario,
  createPaymentIdempotentScenario,
} from '../../src/scenario/demo-loader';
import type { EventLog, SimEvent } from '../../src/engine/types';
import type { Invariant } from '../../src/scenario/types';

function makeEvent(partial: Partial<SimEvent> & { type: SimEvent['type'] }): SimEvent {
  return { timestamp: 0, sequence: 0, ...partial } as SimEvent;
}

describe('Invariant: maxSideEffectCount', () => {
  const inv: Invariant = {
    type: 'maxSideEffectCount',
    id: 'i1',
    effectName: 'charge',
    maxCount: 1,
  };

  it('passes when count ≤ threshold', () => {
    const log: EventLog = [
      makeEvent({
        type: 'SideEffect',
        sequence: 1,
        serviceId: 's',
        effectName: 'charge',
        operationId: 1,
        attempt: 0,
        deliveryIndex: 0,
      }),
    ];
    const [result] = evaluateInvariants(log, [inv]);
    expect(result!.passed).toBe(true);
    expect(result!.actual).toBe(1);
    expect(result!.evidence).toHaveLength(0);
  });

  it('fails when count > threshold', () => {
    const log: EventLog = [
      makeEvent({
        type: 'SideEffect',
        sequence: 1,
        timestamp: 0,
        serviceId: 's',
        effectName: 'charge',
        operationId: 1,
        attempt: 0,
        deliveryIndex: 0,
      }),
      makeEvent({
        type: 'SideEffect',
        sequence: 2,
        timestamp: 100,
        serviceId: 's',
        effectName: 'charge',
        operationId: 1,
        attempt: 1,
        deliveryIndex: 0,
      }),
    ];
    const [result] = evaluateInvariants(log, [inv]);
    expect(result!.passed).toBe(false);
    expect(result!.actual).toBe(2);
    expect(result!.evidence).toHaveLength(2);
    expect(result!.evidence[0]!.sequence).toBe(1);
    expect(result!.evidence[1]!.sequence).toBe(2);
  });

  it('passes on empty log', () => {
    const [result] = evaluateInvariants([], [inv]);
    expect(result!.passed).toBe(true);
    expect(result!.actual).toBe(0);
  });
});

describe('Invariant: maxRequestCount', () => {
  const inv: Invariant = { type: 'maxRequestCount', id: 'i2', pathId: 'p1', maxCount: 2 };

  it('passes when count ≤ threshold', () => {
    const log: EventLog = [
      makeEvent({
        type: 'RequestArrived',
        sequence: 1,
        pathId: 'p1',
        operationId: 1,
        idempotencyKey: 'k',
        attempt: 0,
        deliveryIndex: 0,
        deduplicated: false,
      }),
    ];
    const [result] = evaluateInvariants(log, [inv]);
    expect(result!.passed).toBe(true);
    expect(result!.actual).toBe(1);
  });

  it('fails when count > threshold', () => {
    const log: EventLog = [
      makeEvent({
        type: 'RequestArrived',
        sequence: 1,
        pathId: 'p1',
        operationId: 1,
        idempotencyKey: 'k',
        attempt: 0,
        deliveryIndex: 0,
        deduplicated: false,
      }),
      makeEvent({
        type: 'RequestArrived',
        sequence: 2,
        pathId: 'p1',
        operationId: 1,
        idempotencyKey: 'k',
        attempt: 0,
        deliveryIndex: 1,
        deduplicated: false,
      }),
      makeEvent({
        type: 'RequestArrived',
        sequence: 3,
        pathId: 'p1',
        operationId: 1,
        idempotencyKey: 'k',
        attempt: 1,
        deliveryIndex: 0,
        deduplicated: false,
      }),
    ];
    const [result] = evaluateInvariants(log, [inv]);
    expect(result!.passed).toBe(false);
    expect(result!.actual).toBe(3);
  });
});

describe('Invariant: requiredSuccessCount', () => {
  const inv: Invariant = { type: 'requiredSuccessCount', id: 'i3', pathId: 'p1', minCount: 1 };

  it('passes when enough successes exist', () => {
    const log: EventLog = [
      makeEvent({
        type: 'ResponseReceived',
        sequence: 1,
        pathId: 'p1',
        operationId: 1,
        attempt: 0,
        deliveryIndex: 0,
        success: true,
        deduplicated: false,
        late: false,
        latency: 50,
      }),
    ];
    const [result] = evaluateInvariants(log, [inv]);
    expect(result!.passed).toBe(true);
  });

  it('fails when not enough successes', () => {
    const log: EventLog = [
      makeEvent({
        type: 'ResponseReceived',
        sequence: 1,
        pathId: 'p1',
        operationId: 1,
        attempt: 0,
        deliveryIndex: 0,
        success: false,
        deduplicated: false,
        late: false,
        latency: 50,
      }),
    ];
    const [result] = evaluateInvariants(log, [inv]);
    expect(result!.passed).toBe(false);
    expect(result!.actual).toBe(0);
  });

  it('late responses do not count as successes', () => {
    const log: EventLog = [
      makeEvent({
        type: 'ResponseReceived',
        sequence: 1,
        pathId: 'p1',
        operationId: 1,
        attempt: 0,
        deliveryIndex: 0,
        success: true,
        deduplicated: false,
        late: true,
        latency: 50,
      }),
    ];
    const [result] = evaluateInvariants(log, [inv]);
    expect(result!.passed).toBe(false);
  });

  it('deduplicated responses do not count', () => {
    const log: EventLog = [
      makeEvent({
        type: 'ResponseReceived',
        sequence: 1,
        pathId: 'p1',
        operationId: 1,
        attempt: 0,
        deliveryIndex: 0,
        success: true,
        deduplicated: true,
        late: false,
        latency: 50,
      }),
    ];
    const [result] = evaluateInvariants(log, [inv]);
    expect(result!.passed).toBe(false);
  });
});

describe('Invariant: maxCompletionTime', () => {
  const inv: Invariant = { type: 'maxCompletionTime', id: 'i4', maxMs: 1000 };

  it('passes when final timestamp ≤ threshold', () => {
    const log: EventLog = [
      makeEvent({
        type: 'RequestSent',
        sequence: 1,
        timestamp: 500,
        pathId: 'p1',
        operationId: 1,
        idempotencyKey: 'k',
        attempt: 0,
        deliveryIndex: 0,
      }),
    ];
    const [result] = evaluateInvariants(log, [inv]);
    expect(result!.passed).toBe(true);
    expect(result!.actual).toBe(500);
  });

  it('fails when final timestamp > threshold', () => {
    const log: EventLog = [
      makeEvent({
        type: 'RequestSent',
        sequence: 1,
        timestamp: 1500,
        pathId: 'p1',
        operationId: 1,
        idempotencyKey: 'k',
        attempt: 0,
        deliveryIndex: 0,
      }),
    ];
    const [result] = evaluateInvariants(log, [inv]);
    expect(result!.passed).toBe(false);
    expect(result!.evidence[0]!.timestamp).toBe(1500);
  });

  it('passes on empty log', () => {
    const [result] = evaluateInvariants([], [inv]);
    expect(result!.passed).toBe(true);
  });
});

describe('Invariant: noPendingRequests', () => {
  const inv: Invariant = { type: 'noPendingRequests', id: 'i5' };

  it('passes when all requests have terminal events', () => {
    const log: EventLog = [
      makeEvent({
        type: 'RequestSent',
        sequence: 1,
        pathId: 'p1',
        operationId: 1,
        idempotencyKey: 'k',
        attempt: 0,
        deliveryIndex: 0,
      }),
      makeEvent({
        type: 'ResponseReceived',
        sequence: 2,
        pathId: 'p1',
        operationId: 1,
        attempt: 0,
        deliveryIndex: 0,
        success: true,
        deduplicated: false,
        late: false,
        latency: 50,
      }),
    ];
    const [result] = evaluateInvariants(log, [inv]);
    expect(result!.passed).toBe(true);
  });

  it('fails when a request has no terminal event', () => {
    const log: EventLog = [
      makeEvent({
        type: 'RequestSent',
        sequence: 1,
        pathId: 'p1',
        operationId: 1,
        idempotencyKey: 'k',
        attempt: 0,
        deliveryIndex: 0,
      }),
    ];
    const [result] = evaluateInvariants(log, [inv]);
    expect(result!.passed).toBe(false);
    expect(result!.actual).toBe(1);
  });

  it('TimeoutError counts as terminal', () => {
    const log: EventLog = [
      makeEvent({
        type: 'RequestSent',
        sequence: 1,
        pathId: 'p1',
        operationId: 1,
        idempotencyKey: 'k',
        attempt: 0,
        deliveryIndex: 0,
      }),
      makeEvent({ type: 'TimeoutError', sequence: 2, pathId: 'p1', operationId: 1, attempt: 0 }),
    ];
    const [result] = evaluateInvariants(log, [inv]);
    expect(result!.passed).toBe(true);
  });

  it('CircuitOpenError counts as terminal', () => {
    const log: EventLog = [
      makeEvent({
        type: 'RequestSent',
        sequence: 1,
        pathId: 'p1',
        operationId: 1,
        idempotencyKey: 'k',
        attempt: 0,
        deliveryIndex: 0,
      }),
      makeEvent({
        type: 'CircuitOpenError',
        sequence: 2,
        pathId: 'p1',
        operationId: 1,
        attempt: 0,
        deliveryIndex: 0,
      }),
    ];
    const [result] = evaluateInvariants(log, [inv]);
    expect(result!.passed).toBe(true);
  });
});

// ─── Payment Demo Integration ────────────────────────────────────────────────

describe('Payment demo invariants', () => {
  it('without idempotency: "charge ≤ 1" fails with exactly 2 charges as evidence', () => {
    const scenario = createPaymentDoubleChargeScenario();
    const result = simulateScenario(scenario);
    const [inv] = evaluateInvariants(result.events, scenario.invariants);
    expect(inv!.passed).toBe(false);
    expect(inv!.actual).toBe(2);
    expect(inv!.evidence).toHaveLength(2);
    expect(inv!.evidence[0]!.description).toContain('charge');
    expect(inv!.evidence[1]!.description).toContain('charge');
  });

  it('with idempotency: "charge ≤ 1" passes with exactly 1 charge', () => {
    const scenario = createPaymentIdempotentScenario();
    const result = simulateScenario(scenario);
    const [inv] = evaluateInvariants(result.events, scenario.invariants);
    expect(inv!.passed).toBe(true);
    expect(inv!.actual).toBe(1);
    expect(inv!.evidence).toHaveLength(0);
  });

  it('both are deterministic', () => {
    const s1 = createPaymentDoubleChargeScenario();
    const r1a = evaluateInvariants(simulateScenario(s1).events, s1.invariants);
    const r1b = evaluateInvariants(simulateScenario(s1).events, s1.invariants);
    expect(r1a).toEqual(r1b);

    const s2 = createPaymentIdempotentScenario();
    const r2a = evaluateInvariants(simulateScenario(s2).events, s2.invariants);
    const r2b = evaluateInvariants(simulateScenario(s2).events, s2.invariants);
    expect(r2a).toEqual(r2b);
  });
});
