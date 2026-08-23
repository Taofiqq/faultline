import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { evaluateInvariants } from '../../src/invariants/evaluator';
import { computeMetrics } from '../../src/metrics/compute';
import { simulateScenario } from '../../src/engine/simulate-scenario';
import type { Scenario } from '../../src/scenario/types';

function makeScenario(seed: number): Scenario {
  return {
    schemaVersion: 1,
    seed,
    maxSimulationTimeMs: 10000,
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
        deadlineMs: 1000,
        operationName: 'op',
        sideEffect: 'effect',
        failures: [{ type: 'lostResponse', probability: 0.3 }],
        resilience: {
          idempotencyEnabled: false,
          retry: { maxRetries: 2, baseDelay: 100, jitterFactor: 0 },
        },
      },
    ],
    invariants: [
      { type: 'maxSideEffectCount', id: 'i1', effectName: 'effect', maxCount: 10 },
      { type: 'noPendingRequests', id: 'i2' },
    ],
  };
}

describe('Property: invariant evaluation determinism', () => {
  it('same scenario produces identical invariant results', () => {
    fc.assert(
      fc.property(fc.nat({ max: 4294967295 }), (seed) => {
        const scenario = makeScenario(seed);
        const log1 = simulateScenario(scenario).events;
        const log2 = simulateScenario(scenario).events;
        const r1 = evaluateInvariants(log1, scenario.invariants);
        const r2 = evaluateInvariants(log2, scenario.invariants);
        expect(r1).toEqual(r2);
      }),
      { numRuns: 50 },
    );
  });
});

describe('Property: metrics determinism and non-negative', () => {
  it('same scenario produces identical metrics', () => {
    fc.assert(
      fc.property(fc.nat({ max: 4294967295 }), (seed) => {
        const scenario = makeScenario(seed);
        const log = simulateScenario(scenario).events;
        const m1 = computeMetrics(log);
        const m2 = computeMetrics(log);
        expect(m1).toEqual(m2);
      }),
      { numRuns: 50 },
    );
  });

  it('all counts are non-negative', () => {
    fc.assert(
      fc.property(fc.nat({ max: 4294967295 }), (seed) => {
        const scenario = makeScenario(seed);
        const log = simulateScenario(scenario).events;
        const m = computeMetrics(log);
        expect(m.totalRequests).toBeGreaterThanOrEqual(0);
        expect(m.totalDeliveries).toBeGreaterThanOrEqual(0);
        expect(m.retries).toBeGreaterThanOrEqual(0);
        expect(m.failuresByType.timeout).toBeGreaterThanOrEqual(0);
        expect(m.failuresByType.serviceError).toBeGreaterThanOrEqual(0);
        expect(m.failuresByType.circuitOpen).toBeGreaterThanOrEqual(0);
        expect(m.failuresByType.responseLost).toBeGreaterThanOrEqual(0);
        expect(m.duplicateDeliveries).toBeGreaterThanOrEqual(0);
        expect(m.deduplications).toBeGreaterThanOrEqual(0);
        expect(m.successfulCallerOutcomes).toBeGreaterThanOrEqual(0);
        expect(m.simulatedDuration).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 50 },
    );
  });

  it('percentiles are ordered when they exist', () => {
    fc.assert(
      fc.property(fc.nat({ max: 4294967295 }), (seed) => {
        const scenario = makeScenario(seed);
        const log = simulateScenario(scenario).events;
        const m = computeMetrics(log);
        if (m.p50Latency !== null && m.p95Latency !== null && m.p99Latency !== null) {
          expect(m.p50Latency).toBeLessThanOrEqual(m.p95Latency);
          expect(m.p95Latency).toBeLessThanOrEqual(m.p99Latency);
        }
      }),
      { numRuns: 50 },
    );
  });
});

describe('Property: valid evidence references', () => {
  it('evidence sequences exist in the event log', () => {
    fc.assert(
      fc.property(fc.nat({ max: 4294967295 }), (seed) => {
        const scenario = makeScenario(seed);
        const log = simulateScenario(scenario).events;
        const results = evaluateInvariants(log, scenario.invariants);
        const logSequences = new Set(log.map((e) => e.sequence));

        for (const r of results) {
          for (const ev of r.evidence) {
            if (ev.sequence !== 0) {
              // sequence 0 is used for generic messages
              expect(logSequences.has(ev.sequence)).toBe(true);
            }
          }
        }
      }),
      { numRuns: 50 },
    );
  });
});
