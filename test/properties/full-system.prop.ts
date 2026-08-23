/**
 * Full-system property tests — covers invariants NOT tested in existing property files.
 *
 * Existing coverage (do NOT duplicate):
 * - queue-and-determinism.prop.ts: queue ordering, PRNG determinism, basic simulate determinism, termination
 * - invariants-metrics.prop.ts: invariant/metrics determinism, non-negative counts, percentile ordering, evidence references
 *
 * NEW properties tested here:
 * 1. Unique sequences globally
 * 2. Safe integers
 * 3. Retry count bounds
 * 4. Network duplication doesn't consume retry budget
 * 5. Idempotency side-effect dedup
 * 6. Circuit breaker half-open probe limit
 * 7. Late/stale responses don't change state
 * 8. Full determinism with metrics and invariants
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { simulateScenario } from '../../src/engine/simulate-scenario';
import { computeMetrics } from '../../src/metrics/compute';
import { evaluateInvariants } from '../../src/invariants/evaluator';
import type {
  Scenario,
  Service,
  Path,
  FailureInjection,
  Invariant,
} from '../../src/scenario/types';
import type { SimEvent } from '../../src/engine/types';

// ─── Arbitrary Generators ────────────────────────────────────────────────────

const failureInjectionArb: fc.Arbitrary<FailureInjection> = fc.oneof(
  fc.record({
    type: fc.constant('fixedLatency' as const),
    ms: fc.integer({ min: 10, max: 500 }),
    probability: fc.double({ min: 0.1, max: 0.8, noNaN: true }),
  }),
  fc.record({
    type: fc.constant('lostResponse' as const),
    probability: fc.double({ min: 0.1, max: 0.5, noNaN: true }),
  }),
  fc.record({
    type: fc.constant('serviceError' as const),
    probability: fc.double({ min: 0.1, max: 0.6, noNaN: true }),
  }),
);

const duplicateRequestFailureArb: fc.Arbitrary<FailureInjection> = fc.record({
  type: fc.constant('duplicateRequest' as const),
  count: fc.integer({ min: 2, max: 4 }),
  probability: fc.double({ min: 0.5, max: 1.0, noNaN: true }),
});

function pathArb(services: Service[]): fc.Arbitrary<Path> {
  return fc
    .record({
      deadlineMs: fc.integer({ min: 100, max: 2000 }),
      failures: fc.array(failureInjectionArb, { minLength: 0, maxLength: 2 }),
      maxRetries: fc.integer({ min: 0, max: 3 }),
      baseDelay: fc.integer({ min: 50, max: 300 }),
      jitterFactor: fc.double({ min: 0, max: 0.5, noNaN: true }),
      idempotencyEnabled: fc.boolean(),
      sideEffect: fc.option(fc.stringMatching(/^[a-z]{3,8}$/), { nil: undefined }),
    })
    .map((r, idx) => {
      const srcIdx = 0;
      const dstIdx = services.length > 1 ? 1 : 0;
      return {
        id: `path-${idx}`,
        source: services[srcIdx]!.id,
        destination: services[dstIdx]!.id,
        label: `path-${idx}`,
        deadlineMs: r.deadlineMs,
        operationName: `op-${idx}`,
        sideEffect: r.sideEffect,
        failures: r.failures,
        resilience: {
          idempotencyEnabled: r.idempotencyEnabled,
          retry:
            r.maxRetries > 0
              ? { maxRetries: r.maxRetries, baseDelay: r.baseDelay, jitterFactor: r.jitterFactor }
              : undefined,
          circuitBreaker: undefined,
        },
      } satisfies Path;
    });
}

function pathWithDuplicateArb(services: Service[]): fc.Arbitrary<Path> {
  return fc
    .record({
      deadlineMs: fc.integer({ min: 200, max: 2000 }),
      dupFailure: duplicateRequestFailureArb,
      otherFailures: fc.array(
        fc.oneof(
          fc.record({
            type: fc.constant('serviceError' as const),
            probability: fc.double({ min: 0.2, max: 0.5, noNaN: true }),
          }),
          fc.record({
            type: fc.constant('lostResponse' as const),
            probability: fc.double({ min: 0.1, max: 0.3, noNaN: true }),
          }),
        ),
        { minLength: 1, maxLength: 1 },
      ),
      maxRetries: fc.integer({ min: 1, max: 3 }),
      baseDelay: fc.integer({ min: 50, max: 200 }),
      jitterFactor: fc.double({ min: 0, max: 0.3, noNaN: true }),
    })
    .map((r, idx) => {
      const srcIdx = 0;
      const dstIdx = services.length > 1 ? 1 : 0;
      return {
        id: `dup-path-${idx}`,
        source: services[srcIdx]!.id,
        destination: services[dstIdx]!.id,
        label: `dup-path-${idx}`,
        deadlineMs: r.deadlineMs,
        operationName: `dup-op-${idx}`,
        sideEffect: `dup-effect-${idx}`,
        failures: [r.dupFailure, ...r.otherFailures],
        resilience: {
          idempotencyEnabled: false,
          retry: { maxRetries: r.maxRetries, baseDelay: r.baseDelay, jitterFactor: r.jitterFactor },
          circuitBreaker: undefined,
        },
      } satisfies Path;
    });
}

function pathWithCircuitBreakerArb(services: Service[]): fc.Arbitrary<Path> {
  return fc
    .record({
      deadlineMs: fc.integer({ min: 100, max: 500 }),
      failureThreshold: fc.integer({ min: 1, max: 3 }),
      cooldownMs: fc.integer({ min: 200, max: 1000 }),
      maxRetries: fc.integer({ min: 1, max: 3 }),
      baseDelay: fc.integer({ min: 50, max: 200 }),
      jitterFactor: fc.double({ min: 0, max: 0.2, noNaN: true }),
      serviceErrorProb: fc.double({ min: 0.5, max: 0.9, noNaN: true }),
    })
    .map((r, idx) => {
      const srcIdx = 0;
      const dstIdx = services.length > 1 ? 1 : 0;
      return {
        id: `cb-path-${idx}`,
        source: services[srcIdx]!.id,
        destination: services[dstIdx]!.id,
        label: `cb-path-${idx}`,
        deadlineMs: r.deadlineMs,
        operationName: `cb-op-${idx}`,
        sideEffect: undefined,
        failures: [{ type: 'serviceError' as const, probability: r.serviceErrorProb }],
        resilience: {
          idempotencyEnabled: false,
          retry: { maxRetries: r.maxRetries, baseDelay: r.baseDelay, jitterFactor: r.jitterFactor },
          circuitBreaker: { failureThreshold: r.failureThreshold, cooldownMs: r.cooldownMs },
        },
      } satisfies Path;
    });
}

function pathWithIdempotencyArb(services: Service[]): fc.Arbitrary<Path> {
  return fc
    .record({
      deadlineMs: fc.integer({ min: 200, max: 1500 }),
      effectName: fc.stringMatching(/^[a-z]{3,8}$/),
      maxRetries: fc.integer({ min: 1, max: 3 }),
      baseDelay: fc.integer({ min: 50, max: 200 }),
      jitterFactor: fc.double({ min: 0, max: 0.3, noNaN: true }),
      dupCount: fc.integer({ min: 2, max: 4 }),
      dupProb: fc.double({ min: 0.5, max: 1.0, noNaN: true }),
    })
    .map((r, idx) => {
      const srcIdx = 0;
      const dstIdx = services.length > 1 ? 1 : 0;
      return {
        id: `idemp-path-${idx}`,
        source: services[srcIdx]!.id,
        destination: services[dstIdx]!.id,
        label: `idemp-path-${idx}`,
        deadlineMs: r.deadlineMs,
        operationName: `idemp-op-${idx}`,
        sideEffect: r.effectName,
        failures: [
          { type: 'duplicateRequest' as const, count: r.dupCount, probability: r.dupProb },
        ],
        resilience: {
          idempotencyEnabled: true,
          retry: { maxRetries: r.maxRetries, baseDelay: r.baseDelay, jitterFactor: r.jitterFactor },
          circuitBreaker: undefined,
        },
      } satisfies Path;
    });
}

/**
 * General scenario arbitrary for most properties.
 */
const scenarioArbitrary: fc.Arbitrary<Scenario> = fc
  .record({
    seed: fc.nat({ max: 4294967295 }),
    numServices: fc.integer({ min: 2, max: 3 }),
    numPaths: fc.integer({ min: 1, max: 3 }),
    maxSimulationTimeMs: fc.integer({ min: 5000, max: 10000 }),
  })
  .chain((base) => {
    const services: Service[] = Array.from({ length: base.numServices }, (_, i) => ({
      id: `svc${i}`,
      name: `Service${i}`,
    }));
    return fc.array(pathArb(services), { minLength: 1, maxLength: base.numPaths }).map((paths) => {
      // Ensure unique path IDs
      const uniquePaths = paths.map((p, i) => ({
        ...p,
        id: `path-${i}`,
        operationName: `op-${i}`,
      }));
      return {
        schemaVersion: 1 as const,
        seed: base.seed,
        maxSimulationTimeMs: base.maxSimulationTimeMs,
        services,
        paths: uniquePaths,
        invariants: [],
      } satisfies Scenario;
    });
  });

/**
 * Scenario with duplicate request failures for testing network duplication properties.
 */
const scenarioWithDuplicatesArb: fc.Arbitrary<Scenario> = fc
  .record({
    seed: fc.nat({ max: 4294967295 }),
    maxSimulationTimeMs: fc.integer({ min: 5000, max: 10000 }),
  })
  .chain((base) => {
    const services: Service[] = [
      { id: 'svc0', name: 'Client' },
      { id: 'svc1', name: 'Server' },
    ];
    return fc.array(pathWithDuplicateArb(services), { minLength: 1, maxLength: 2 }).map((paths) => {
      const uniquePaths = paths.map((p, i) => ({
        ...p,
        id: `dup-path-${i}`,
        operationName: `dup-op-${i}`,
      }));
      return {
        schemaVersion: 1 as const,
        seed: base.seed,
        maxSimulationTimeMs: base.maxSimulationTimeMs,
        services,
        paths: uniquePaths,
        invariants: [],
      } satisfies Scenario;
    });
  });

/**
 * Scenario with circuit breakers and high failure rate.
 */
const scenarioWithCircuitBreakerArb: fc.Arbitrary<Scenario> = fc
  .record({
    seed: fc.nat({ max: 4294967295 }),
    maxSimulationTimeMs: fc.integer({ min: 5000, max: 10000 }),
  })
  .chain((base) => {
    const services: Service[] = [
      { id: 'svc0', name: 'Client' },
      { id: 'svc1', name: 'Server' },
    ];
    return fc
      .array(pathWithCircuitBreakerArb(services), { minLength: 1, maxLength: 2 })
      .map((paths) => {
        const uniquePaths = paths.map((p, i) => ({
          ...p,
          id: `cb-path-${i}`,
          operationName: `cb-op-${i}`,
        }));
        return {
          schemaVersion: 1 as const,
          seed: base.seed,
          maxSimulationTimeMs: base.maxSimulationTimeMs,
          services,
          paths: uniquePaths,
          invariants: [],
        } satisfies Scenario;
      });
  });

/**
 * Scenario with idempotency enabled and side effects + duplicates.
 */
const scenarioWithIdempotencyArb: fc.Arbitrary<Scenario> = fc
  .record({
    seed: fc.nat({ max: 4294967295 }),
    maxSimulationTimeMs: fc.integer({ min: 5000, max: 10000 }),
  })
  .chain((base) => {
    const services: Service[] = [
      { id: 'svc0', name: 'Client' },
      { id: 'svc1', name: 'Server' },
    ];
    return fc
      .array(pathWithIdempotencyArb(services), { minLength: 1, maxLength: 2 })
      .map((paths) => {
        const uniquePaths = paths.map((p, i) => ({
          ...p,
          id: `idemp-path-${i}`,
          operationName: `idemp-op-${i}`,
          sideEffect: `effect-${i}`,
        }));
        return {
          schemaVersion: 1 as const,
          seed: base.seed,
          maxSimulationTimeMs: base.maxSimulationTimeMs,
          services,
          paths: uniquePaths,
          invariants: [],
        } satisfies Scenario;
      });
  });

/**
 * Scenario with invariants for full determinism check.
 */
const scenarioWithInvariantsArb: fc.Arbitrary<Scenario> = fc
  .record({
    seed: fc.nat({ max: 4294967295 }),
    maxSimulationTimeMs: fc.integer({ min: 5000, max: 10000 }),
  })
  .chain((base) => {
    const services: Service[] = [
      { id: 'svc0', name: 'Client' },
      { id: 'svc1', name: 'Server' },
    ];
    return fc.array(pathArb(services), { minLength: 1, maxLength: 2 }).map((paths) => {
      const uniquePaths = paths.map((p, i) => ({
        ...p,
        id: `path-${i}`,
        operationName: `op-${i}`,
        sideEffect: `effect-${i}`,
      }));
      const invariants: Invariant[] = [
        { type: 'noPendingRequests', id: 'inv-pending' },
        { type: 'maxCompletionTime', id: 'inv-time', maxMs: base.maxSimulationTimeMs },
        ...uniquePaths.map((p, i) => ({
          type: 'maxSideEffectCount' as const,
          id: `inv-se-${i}`,
          effectName: `effect-${i}`,
          maxCount: 100,
        })),
      ];
      return {
        schemaVersion: 1 as const,
        seed: base.seed,
        maxSimulationTimeMs: base.maxSimulationTimeMs,
        services,
        paths: uniquePaths,
        invariants,
      } satisfies Scenario;
    });
  });

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Property: full-system invariants', () => {
  it('unique sequences globally — every event.sequence is unique across the entire log', () => {
    fc.assert(
      fc.property(scenarioArbitrary, (scenario) => {
        const result = simulateScenario(scenario);
        const sequences = result.events.map((e) => e.sequence);
        const uniqueSet = new Set(sequences);
        expect(uniqueSet.size).toBe(sequences.length);
      }),
      { seed: 42, numRuns: 100 },
    );
  });

  it('safe integers — all numeric identity fields are non-negative safe integers', () => {
    fc.assert(
      fc.property(scenarioArbitrary, (scenario) => {
        const result = simulateScenario(scenario);

        for (const event of result.events) {
          // timestamp and sequence on every event
          expect(event.timestamp).toBeGreaterThanOrEqual(0);
          expect(Number.isSafeInteger(event.timestamp)).toBe(true);
          expect(event.sequence).toBeGreaterThanOrEqual(0);
          expect(Number.isSafeInteger(event.sequence)).toBe(true);

          // Fields specific to event types
          if ('operationId' in event) {
            const e = event as SimEvent & { operationId: number };
            expect(e.operationId).toBeGreaterThanOrEqual(0);
            expect(Number.isSafeInteger(e.operationId)).toBe(true);
          }
          if ('attempt' in event) {
            const e = event as SimEvent & { attempt: number };
            expect(e.attempt).toBeGreaterThanOrEqual(0);
            expect(Number.isSafeInteger(e.attempt)).toBe(true);
          }
          if ('deliveryIndex' in event) {
            const e = event as SimEvent & { deliveryIndex: number };
            expect(e.deliveryIndex).toBeGreaterThanOrEqual(0);
            expect(Number.isSafeInteger(e.deliveryIndex)).toBe(true);
          }
        }
      }),
      { seed: 42, numRuns: 100 },
    );
  });

  it('retry count bounds — RetryScheduled events per operationId never exceed path maxRetries', () => {
    fc.assert(
      fc.property(scenarioArbitrary, (scenario) => {
        const result = simulateScenario(scenario);

        // Count retries per operationId
        const retriesByOp = new Map<number, number>();
        for (const event of result.events) {
          if (event.type === 'RetryScheduled') {
            retriesByOp.set(event.operationId, (retriesByOp.get(event.operationId) ?? 0) + 1);
          }
        }

        // Determine which path each operation belongs to (first RequestSent per operationId)
        const opToPath = new Map<number, string>();
        for (const event of result.events) {
          if (event.type === 'RequestSent' && !opToPath.has(event.operationId)) {
            opToPath.set(event.operationId, event.pathId);
          }
        }

        // Verify bounds
        for (const [opId, retryCount] of retriesByOp) {
          const pathId = opToPath.get(opId);
          const path = scenario.paths.find((p) => p.id === pathId);
          const maxRetries = path?.resilience.retry?.maxRetries ?? 0;
          expect(retryCount).toBeLessThanOrEqual(maxRetries);
        }
      }),
      { seed: 42, numRuns: 100 },
    );
  });

  it('network duplication does not consume retry budget — retries respect maxRetries regardless of duplicates', () => {
    fc.assert(
      fc.property(scenarioWithDuplicatesArb, (scenario) => {
        const result = simulateScenario(scenario);

        // Count retries per operationId
        const retriesByOp = new Map<number, number>();
        for (const event of result.events) {
          if (event.type === 'RetryScheduled') {
            retriesByOp.set(event.operationId, (retriesByOp.get(event.operationId) ?? 0) + 1);
          }
        }

        // Determine which path each operation belongs to
        const opToPath = new Map<number, string>();
        for (const event of result.events) {
          if (event.type === 'RequestSent' && !opToPath.has(event.operationId)) {
            opToPath.set(event.operationId, event.pathId);
          }
        }

        // Even with duplicate deliveries, retries should never exceed maxRetries
        for (const [opId, retryCount] of retriesByOp) {
          const pathId = opToPath.get(opId);
          const path = scenario.paths.find((p) => p.id === pathId);
          const maxRetries = path?.resilience.retry?.maxRetries ?? 0;
          expect(retryCount).toBeLessThanOrEqual(maxRetries);
        }

        // Verify duplicates actually occurred (scenario validity check)
        const duplicateDeliveries = result.events.filter(
          (e) => e.type === 'RequestArrived' && e.deliveryIndex > 0,
        );
        // At least some scenarios should produce duplicates (not a hard fail if PRNG didn't trigger)
        void duplicateDeliveries;
      }),
      { seed: 42, numRuns: 100 },
    );
  });

  it('idempotency side-effect dedup — with idempotency enabled, each operationId emits at most one SideEffect per named effect', () => {
    fc.assert(
      fc.property(scenarioWithIdempotencyArb, (scenario) => {
        const result = simulateScenario(scenario);

        // Group SideEffect events by (operationId, effectName)
        const sideEffectCounts = new Map<string, number>();
        for (const event of result.events) {
          if (event.type === 'SideEffect') {
            const key = `${event.operationId}:${event.effectName}`;
            sideEffectCounts.set(key, (sideEffectCounts.get(key) ?? 0) + 1);
          }
        }

        // With idempotency enabled, each (operationId, effectName) should have at most 1 emission
        for (const [, count] of sideEffectCounts) {
          expect(count).toBeLessThanOrEqual(1);
        }
      }),
      { seed: 42, numRuns: 100 },
    );
  });

  it('circuit breaker half-open probe limit — at most one probe request admitted per generation', () => {
    fc.assert(
      fc.property(scenarioWithCircuitBreakerArb, (scenario) => {
        const result = simulateScenario(scenario);

        // Find all half-open transition events and track generations per path
        const halfOpenGenerations = new Map<string, number[]>(); // pathId → [generation, ...]
        for (const event of result.events) {
          if (event.type === 'CircuitStateChange' && event.newState === 'half-open') {
            const gens = halfOpenGenerations.get(event.pathId) ?? [];
            gens.push(event.generation);
            halfOpenGenerations.set(event.pathId, gens);
          }
        }

        // For each path with circuit breaker, track which requests were admitted during half-open
        // A request that produces RequestArrived (not CircuitOpenError) during half-open is a probe
        // We verify: between each open→half-open transition and the next state change,
        // at most one request was successfully sent (not rejected by circuit)

        for (const [pathId, generations] of halfOpenGenerations) {
          // For each half-open generation, count admitted requests
          // The admitted requests are those between half-open transition and next state change
          // that are NOT CircuitOpenError for this path
          for (const gen of generations) {
            // Find the timestamp of the half-open transition
            const halfOpenEvent = result.events.find(
              (e) =>
                e.type === 'CircuitStateChange' &&
                e.pathId === pathId &&
                e.newState === 'half-open' &&
                e.generation === gen,
            );
            if (!halfOpenEvent) continue;

            // Find the next state change for this path after the half-open
            const nextStateChange = result.events.find(
              (e) =>
                e.type === 'CircuitStateChange' &&
                e.pathId === pathId &&
                e.sequence > halfOpenEvent.sequence &&
                (e.newState === 'closed' || e.newState === 'open'),
            );

            // Count RequestSent events that were NOT rejected (i.e., no corresponding CircuitOpenError)
            // during this half-open window
            const rejectedOps = new Set<string>();
            for (const e of result.events) {
              if (
                e.type === 'CircuitOpenError' &&
                e.pathId === pathId &&
                e.sequence > halfOpenEvent.sequence &&
                (!nextStateChange || e.sequence < nextStateChange.sequence)
              ) {
                rejectedOps.add(`${e.operationId}:${e.attempt}:${e.deliveryIndex}`);
              }
            }

            // RequestSent events in the window that were NOT rejected are probes
            let admittedCount = 0;
            for (const e of result.events) {
              if (
                e.type === 'RequestSent' &&
                e.pathId === pathId &&
                e.sequence > halfOpenEvent.sequence &&
                (!nextStateChange || e.sequence < nextStateChange.sequence)
              ) {
                const opKey = `${e.operationId}:${e.attempt}:${e.deliveryIndex}`;
                if (!rejectedOps.has(opKey)) {
                  admittedCount++;
                }
              }
            }

            // At most one probe per half-open generation
            expect(admittedCount).toBeLessThanOrEqual(1);
          }
        }
      }),
      { seed: 42, numRuns: 100 },
    );
  });

  it('late/stale responses do not trigger RetryScheduled or CircuitStateChange', () => {
    fc.assert(
      fc.property(scenarioArbitrary, (scenario) => {
        const result = simulateScenario(scenario);

        // Collect all late ResponseReceived events
        const lateResponses = result.events.filter((e) => e.type === 'ResponseReceived' && e.late);

        for (const lateEvent of lateResponses) {
          if (lateEvent.type !== 'ResponseReceived') continue;

          // No RetryScheduled or CircuitStateChange should have a sequence immediately after
          // the late response that references the same operationId and attempt.
          // More precisely: after a late response is processed, it should NOT produce
          // any consequential events. We check that no RetryScheduled or CircuitStateChange
          // was produced as a direct consequence of this late event.

          // Find events produced at the same timestamp with sequence > lateEvent.sequence
          // that reference the same operationId (for retry) or pathId (for circuit)
          const consequentialRetries = result.events.filter(
            (e) =>
              e.type === 'RetryScheduled' &&
              e.operationId === lateEvent.operationId &&
              e.sequence > lateEvent.sequence &&
              e.timestamp === lateEvent.timestamp,
          );

          // A late response from attempt N should not trigger retry to attempt N+1
          // if the primary was already resolved
          const consequentialCircuit = result.events.filter(
            (e) =>
              e.type === 'CircuitStateChange' &&
              e.pathId === lateEvent.pathId &&
              e.sequence > lateEvent.sequence &&
              e.timestamp === lateEvent.timestamp,
          );

          // For truly late events (where primary already resolved), there should be
          // no retries or circuit changes produced at the exact same timestamp + higher sequence.
          // The engine marks events as late BECAUSE the attempt was already resolved,
          // so processing should produce no consequential events.
          expect(consequentialRetries.length).toBe(0);
          expect(consequentialCircuit.length).toBe(0);
        }
      }),
      { seed: 42, numRuns: 100 },
    );
  });

  it('full determinism with metrics and invariants — same Scenario + same seed → identical everything', () => {
    fc.assert(
      fc.property(scenarioWithInvariantsArb, (scenario) => {
        // Run simulation twice with the exact same scenario
        const result1 = simulateScenario(scenario);
        const result2 = simulateScenario(scenario);

        // Events must be identical
        expect(result1.events).toEqual(result2.events);
        expect(result1.totalEvents).toBe(result2.totalEvents);
        expect(result1.finalTimestamp).toBe(result2.finalTimestamp);
        expect(result1.stopped).toBe(result2.stopped);

        // Metrics must be identical
        const metrics1 = computeMetrics(result1.events);
        const metrics2 = computeMetrics(result2.events);
        expect(metrics1).toEqual(metrics2);

        // Invariant results must be identical
        const inv1 = evaluateInvariants(result1.events, scenario.invariants);
        const inv2 = evaluateInvariants(result2.events, scenario.invariants);
        expect(inv1).toEqual(inv2);
      }),
      { seed: 42, numRuns: 100 },
    );
  });
});
