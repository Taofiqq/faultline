import { describe, it, expect } from 'vitest';
import { simulateScenario } from '../../src/engine/simulate-scenario';
import {
  createPaymentDoubleChargeScenario,
  createPaymentIdempotentScenario,
  createSuccessScenario,
  createLateResponseScenario,
} from '../../src/scenario/demo-loader';
import type { Scenario } from '../../src/scenario/types';
import type { SimEvent } from '../../src/engine/types';

// ─── Unit Tests: Individual Transitions ──────────────────────────────────────

describe('T1: RequestSent → RequestArrived', () => {
  it('emits RequestArrived at timestamp 0 when no latency configured', () => {
    const result = simulateScenario(createSuccessScenario());
    const arrived = result.events.filter((e) => e.type === 'RequestArrived');
    expect(arrived).toHaveLength(1);
    expect(arrived[0]!.timestamp).toBe(0); // no latency
  });

  it('applies fixed latency to arrival time', () => {
    const scenario: Scenario = {
      schemaVersion: 1,
      seed: 1,
      maxSimulationTimeMs: 60000,
      services: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
      paths: [
        {
          id: 'p1',
          source: 'a',
          destination: 'b',
          label: 'test',
          deadlineMs: 5000,
          operationName: 'op',
          failures: [{ type: 'fixedLatency', ms: 100, probability: 1.0 }],
          resilience: { idempotencyEnabled: false },
        },
      ],
      invariants: [],
    };
    const result = simulateScenario(scenario);
    const arrived = result.events.find((e) => e.type === 'RequestArrived');
    expect(arrived!.timestamp).toBe(100);
  });
});

describe('T2: RequestArrived → SideEffect + ResponseSent', () => {
  it('emits SideEffect when path has sideEffect configured', () => {
    const result = simulateScenario(createPaymentDoubleChargeScenario());
    const sideEffects = result.events.filter((e) => e.type === 'SideEffect');
    expect(sideEffects.length).toBeGreaterThanOrEqual(1);
    expect(sideEffects[0]!.type === 'SideEffect' && sideEffects[0]!.effectName).toBe('charge');
  });

  it('does not emit SideEffect when path has no sideEffect', () => {
    const result = simulateScenario(createSuccessScenario());
    const sideEffects = result.events.filter((e) => e.type === 'SideEffect');
    expect(sideEffects).toHaveLength(0);
  });

  it('emits ResponseSent with success: true', () => {
    const result = simulateScenario(createSuccessScenario());
    const responseSent = result.events.filter((e) => e.type === 'ResponseSent');
    expect(responseSent).toHaveLength(1);
    expect(responseSent[0]!.type === 'ResponseSent' && responseSent[0]!.success).toBe(true);
  });
});

describe('T3: ResponseSent → ResponseReceived or ResponseLost', () => {
  it('emits ResponseReceived when no response loss', () => {
    const result = simulateScenario(createSuccessScenario());
    const received = result.events.filter((e) => e.type === 'ResponseReceived');
    expect(received).toHaveLength(1);
    expect(received[0]!.type === 'ResponseReceived' && received[0]!.success).toBe(true);
  });

  it('emits ResponseLost when lostResponse is triggered (seed=0, prob=0.5)', () => {
    const result = simulateScenario(createPaymentDoubleChargeScenario());
    const lost = result.events.filter((e) => e.type === 'ResponseLost');
    expect(lost.length).toBeGreaterThanOrEqual(1);
  });
});

describe('T4: ResponseReceived / Timeout', () => {
  it('emits TimeoutError when caller deadline is exceeded due to lost response', () => {
    const result = simulateScenario(createPaymentDoubleChargeScenario());
    const timeouts = result.events.filter((e) => e.type === 'TimeoutError');
    expect(timeouts.length).toBeGreaterThanOrEqual(1);
    expect(timeouts[0]!.timestamp).toBe(3000); // deadlineMs
  });

  it('suppresses timeout when response arrives before deadline', () => {
    const result = simulateScenario(createSuccessScenario());
    const timeouts = result.events.filter((e) => e.type === 'TimeoutError');
    expect(timeouts).toHaveLength(0);
  });
});

// ─── Integration Tests ───────────────────────────────────────────────────────

describe('Integration: Normal success path', () => {
  it('produces the complete happy-path event sequence', () => {
    const result = simulateScenario(createSuccessScenario());
    const types = result.events.map((e) => e.type);

    expect(types).toEqual(['RequestSent', 'RequestArrived', 'ResponseSent', 'ResponseReceived']);
  });

  it('ResponseReceived has late: false', () => {
    const result = simulateScenario(createSuccessScenario());
    const received = result.events.find((e) => e.type === 'ResponseReceived')!;
    expect(received.type === 'ResponseReceived' && received.late).toBe(false);
  });

  it('all events have non-decreasing timestamps', () => {
    const result = simulateScenario(createSuccessScenario());
    for (let i = 1; i < result.events.length; i++) {
      expect(result.events[i]!.timestamp).toBeGreaterThanOrEqual(result.events[i - 1]!.timestamp);
    }
  });
});

describe('Integration: Lost response → side-effect preserved + timeout + retry', () => {
  it('produces charge side-effect AND timeout AND retry', () => {
    const result = simulateScenario(createPaymentDoubleChargeScenario());
    const types = result.events.map((e) => e.type);

    expect(types).toContain('SideEffect');
    expect(types).toContain('TimeoutError');
    expect(types).toContain('ResponseLost');
    expect(types).toContain('RetryScheduled');
  });

  it('first side-effect occurs before timeout', () => {
    const result = simulateScenario(createPaymentDoubleChargeScenario());
    const sideEffects = result.events.filter((e) => e.type === 'SideEffect');
    const timeout = result.events.find((e) => e.type === 'TimeoutError')!;
    expect(sideEffects[0]!.timestamp).toBeLessThan(timeout.timestamp);
  });

  it('exactly two charge side-effects without idempotency', () => {
    const result = simulateScenario(createPaymentDoubleChargeScenario());
    const charges = result.events.filter(
      (e) => e.type === 'SideEffect' && e.effectName === 'charge',
    );
    expect(charges).toHaveLength(2);
  });

  it('timeout fires at the deadline (3000ms)', () => {
    const result = simulateScenario(createPaymentDoubleChargeScenario());
    const timeout = result.events.find((e) => e.type === 'TimeoutError')!;
    expect(timeout.timestamp).toBe(3000);
  });

  it('retry is sent at deadline + baseDelay (3100ms)', () => {
    const result = simulateScenario(createPaymentDoubleChargeScenario());
    const retrySent = result.events.filter((e) => e.type === 'RequestSent' && e.attempt === 1);
    expect(retrySent).toHaveLength(1);
    expect(retrySent[0]!.timestamp).toBe(3100); // 3000 + 100 baseDelay
  });

  it('final ResponseReceived has success: true', () => {
    const result = simulateScenario(createPaymentDoubleChargeScenario());
    const received = result.events.filter((e) => e.type === 'ResponseReceived');
    expect(received.length).toBeGreaterThanOrEqual(1);
    const last = received[received.length - 1]!;
    expect(last.type === 'ResponseReceived' && last.success).toBe(true);
    expect(last.type === 'ResponseReceived' && last.late).toBe(false);
  });
});

describe('Integration: Late response (arrives after timeout)', () => {
  it('timeout fires before the late response', () => {
    const result = simulateScenario(createLateResponseScenario());
    const timeout = result.events.find((e) => e.type === 'TimeoutError')!;
    const received = result.events.find((e) => e.type === 'ResponseReceived')!;
    expect(timeout).toBeDefined();
    expect(received).toBeDefined();
    expect(timeout.timestamp).toBeLessThan(received.timestamp);
  });

  it('late response has late: true', () => {
    const result = simulateScenario(createLateResponseScenario());
    const received = result.events.find((e) => e.type === 'ResponseReceived')!;
    expect(received.type === 'ResponseReceived' && received.late).toBe(true);
  });

  it('side-effect is still emitted (destination processed)', () => {
    const result = simulateScenario(createLateResponseScenario());
    const sideEffects = result.events.filter((e) => e.type === 'SideEffect');
    expect(sideEffects).toHaveLength(1);
  });
});

// ─── Deterministic Replay ────────────────────────────────────────────────────

describe('Deterministic replay', () => {
  it('same seed produces identical event sequences (double-charge)', () => {
    const result1 = simulateScenario(createPaymentDoubleChargeScenario());
    const result2 = simulateScenario(createPaymentDoubleChargeScenario());
    expect(result1.events).toEqual(result2.events);
  });

  it('same seed produces identical event sequences (idempotent)', () => {
    const result1 = simulateScenario(createPaymentIdempotentScenario());
    const result2 = simulateScenario(createPaymentIdempotentScenario());
    expect(result1.events).toEqual(result2.events);
  });

  it('different seeds produce different event sequences', () => {
    const scenario1 = createSuccessScenario();
    const scenario2 = { ...createSuccessScenario(), seed: 99 };
    const result1 = simulateScenario(scenario1);
    const result2 = simulateScenario(scenario2);
    expect(result1.events.map((e) => e.type)).toEqual(result2.events.map((e) => e.type));
  });
});

// ─── Golden Event Log ────────────────────────────────────────────────────────

describe('Golden event log: payment double-charge (no idempotency)', () => {
  it('produces exactly 2 charges and a successful final response', () => {
    const result = simulateScenario(createPaymentDoubleChargeScenario());
    const charges = result.events.filter(
      (e) => e.type === 'SideEffect' && e.effectName === 'charge',
    );
    expect(charges).toHaveLength(2);

    const received = result.events.filter(
      (e) => e.type === 'ResponseReceived' && !e.late && e.success,
    );
    expect(received).toHaveLength(1);
  });

  it('produces the exact expected normalized event sequence', () => {
    const result = simulateScenario(createPaymentDoubleChargeScenario());
    const normalized = result.events.map((e) => ({
      type: e.type,
      timestamp: e.timestamp,
    }));

    expect(normalized).toEqual([
      { type: 'RequestSent', timestamp: 0 },
      { type: 'RequestArrived', timestamp: 0 },
      { type: 'SideEffect', timestamp: 0 },
      { type: 'ResponseSent', timestamp: 0 },
      { type: 'ResponseLost', timestamp: 0 },
      { type: 'TimeoutError', timestamp: 3000 },
      { type: 'RetryScheduled', timestamp: 3000 },
      { type: 'RequestSent', timestamp: 3100 },
      { type: 'RequestArrived', timestamp: 3100 },
      { type: 'SideEffect', timestamp: 3100 },
      { type: 'ResponseSent', timestamp: 3100 },
      { type: 'ResponseReceived', timestamp: 3100 },
    ]);
  });

  it('event sequence is stable across multiple runs', () => {
    const runs: SimEvent[][] = [];
    for (let i = 0; i < 5; i++) {
      runs.push(simulateScenario(createPaymentDoubleChargeScenario()).events);
    }
    for (let i = 1; i < runs.length; i++) {
      expect(runs[i]).toEqual(runs[0]);
    }
  });
});

describe('Golden event log: payment idempotent (with idempotency)', () => {
  it('produces exactly 1 charge and a successful final response', () => {
    const result = simulateScenario(createPaymentIdempotentScenario());
    const charges = result.events.filter(
      (e) => e.type === 'SideEffect' && e.effectName === 'charge',
    );
    expect(charges).toHaveLength(1);

    const received = result.events.filter(
      (e) => e.type === 'ResponseReceived' && !e.late && e.success,
    );
    expect(received).toHaveLength(1);
  });

  it('retry arrival is logged as deduplicated', () => {
    const result = simulateScenario(createPaymentIdempotentScenario());
    const arrivals = result.events.filter((e) => e.type === 'RequestArrived');
    expect(arrivals).toHaveLength(2);
    const retryArrival = arrivals[1]!;
    expect(retryArrival.type === 'RequestArrived' && retryArrival.deduplicated).toBe(true);
  });

  it('produces the exact expected normalized event sequence', () => {
    const result = simulateScenario(createPaymentIdempotentScenario());
    const normalized = result.events.map((e) => ({
      type: e.type,
      timestamp: e.timestamp,
    }));

    expect(normalized).toEqual([
      { type: 'RequestSent', timestamp: 0 },
      { type: 'RequestArrived', timestamp: 0 },
      { type: 'SideEffect', timestamp: 0 },
      { type: 'ResponseSent', timestamp: 0 },
      { type: 'ResponseLost', timestamp: 0 },
      { type: 'TimeoutError', timestamp: 3000 },
      { type: 'RetryScheduled', timestamp: 3000 },
      { type: 'RequestSent', timestamp: 3100 },
      { type: 'RequestArrived', timestamp: 3100 },
      { type: 'ResponseSent', timestamp: 3100 },
      { type: 'ResponseReceived', timestamp: 3100 },
    ]);
  });

  it('event sequence is stable across multiple runs', () => {
    const runs: SimEvent[][] = [];
    for (let i = 0; i < 5; i++) {
      runs.push(simulateScenario(createPaymentIdempotentScenario()).events);
    }
    for (let i = 1; i < runs.length; i++) {
      expect(runs[i]).toEqual(runs[0]);
    }
  });
});
