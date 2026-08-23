/**
 * Golden Determinism Tests
 *
 * Verifies that the simulation engine produces identical normalized event
 * sequences for known scenarios. Any difference from the golden fixtures
 * indicates a determinism regression.
 *
 * To update golden files after an intentional engine change:
 *   npx tsx scripts/generate-golden.ts
 *
 * Golden file updates are treated as breaking changes in PR review.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { simulateScenario } from '../../src/engine/simulate-scenario';
import { computeMetrics } from '../../src/metrics/compute';
import { evaluateInvariants } from '../../src/invariants/evaluator';
import type { Scenario } from '../../src/scenario/types';
import type { SimulationMetrics } from '../../src/metrics/compute';
import type { InvariantResult } from '../../src/invariants/evaluator';
import type { SimEvent } from '../../src/engine/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── Types ───────────────────────────────────────────────────────────────────

interface GoldenFixture {
  scenario: { seed: number; schemaVersion: number };
  events: SimEvent[];
  metrics: SimulationMetrics;
  invariantResults: InvariantResult[];
  stopped: boolean;
  stopReason: string | null;
  totalEvents: number;
  finalTimestamp: number;
}

function loadGolden(name: string): GoldenFixture {
  const path = join(__dirname, `${name}.json`);
  return JSON.parse(readFileSync(path, 'utf-8')) as GoldenFixture;
}

// ─── Scenario Definitions ────────────────────────────────────────────────────
// Must match exactly what generated the golden files.

const scenarios: Record<string, Scenario> = {
  'payment-no-idempotency': {
    schemaVersion: 1,
    seed: 0,
    maxSimulationTimeMs: 60000,
    services: [
      { id: 'gateway', name: 'API Gateway' },
      { id: 'payment', name: 'Payment Service' },
    ],
    paths: [
      {
        id: 'gateway-to-payment',
        source: 'gateway',
        destination: 'payment',
        label: 'charge',
        deadlineMs: 3000,
        operationName: 'charge',
        sideEffect: 'charge',
        failures: [{ type: 'lostResponse', probability: 0.5 }],
        resilience: {
          idempotencyEnabled: false,
          retry: { maxRetries: 1, baseDelay: 100, jitterFactor: 0 },
        },
      },
    ],
    invariants: [
      {
        type: 'maxSideEffectCount',
        id: 'inv-charge-at-most-once',
        effectName: 'charge',
        maxCount: 1,
      },
    ],
  },

  'payment-with-idempotency': {
    schemaVersion: 1,
    seed: 0,
    maxSimulationTimeMs: 60000,
    services: [
      { id: 'gateway', name: 'API Gateway' },
      { id: 'payment', name: 'Payment Service' },
    ],
    paths: [
      {
        id: 'gateway-to-payment',
        source: 'gateway',
        destination: 'payment',
        label: 'charge',
        deadlineMs: 3000,
        operationName: 'charge',
        sideEffect: 'charge',
        failures: [{ type: 'lostResponse', probability: 0.5 }],
        resilience: {
          idempotencyEnabled: true,
          retry: { maxRetries: 1, baseDelay: 100, jitterFactor: 0 },
        },
      },
    ],
    invariants: [
      {
        type: 'maxSideEffectCount',
        id: 'inv-charge-at-most-once',
        effectName: 'charge',
        maxCount: 1,
      },
    ],
  },

  'network-duplication': {
    schemaVersion: 1,
    seed: 100,
    maxSimulationTimeMs: 60000,
    services: [
      { id: 'client', name: 'Client' },
      { id: 'server', name: 'Server' },
    ],
    paths: [
      {
        id: 'client-to-server',
        source: 'client',
        destination: 'server',
        label: 'process',
        deadlineMs: 5000,
        operationName: 'processOrder',
        sideEffect: 'fulfill',
        failures: [{ type: 'duplicateRequest', count: 3, probability: 1.0 }],
        resilience: {
          idempotencyEnabled: false,
          retry: { maxRetries: 1, baseDelay: 200, jitterFactor: 0 },
        },
      },
    ],
    invariants: [
      {
        type: 'maxSideEffectCount',
        id: 'inv-fulfill-once',
        effectName: 'fulfill',
        maxCount: 1,
      },
    ],
  },

  'network-duplication-idempotent': {
    schemaVersion: 1,
    seed: 100,
    maxSimulationTimeMs: 60000,
    services: [
      { id: 'client', name: 'Client' },
      { id: 'server', name: 'Server' },
    ],
    paths: [
      {
        id: 'client-to-server',
        source: 'client',
        destination: 'server',
        label: 'process',
        deadlineMs: 5000,
        operationName: 'processOrder',
        sideEffect: 'fulfill',
        failures: [{ type: 'duplicateRequest', count: 3, probability: 1.0 }],
        resilience: {
          idempotencyEnabled: true,
          retry: { maxRetries: 1, baseDelay: 200, jitterFactor: 0 },
        },
      },
    ],
    invariants: [
      {
        type: 'maxSideEffectCount',
        id: 'inv-fulfill-once',
        effectName: 'fulfill',
        maxCount: 1,
      },
    ],
  },

  'circuit-breaker-lifecycle': {
    schemaVersion: 1,
    seed: 42,
    maxSimulationTimeMs: 60000,
    services: [
      { id: 'caller', name: 'Caller' },
      { id: 'service', name: 'Service' },
    ],
    paths: [
      {
        id: 'caller-to-service',
        source: 'caller',
        destination: 'service',
        label: 'call',
        deadlineMs: 500,
        operationName: 'call',
        sideEffect: 'process',
        failures: [{ type: 'serviceError', probability: 0.8 }],
        resilience: {
          idempotencyEnabled: false,
          retry: { maxRetries: 5, baseDelay: 50, jitterFactor: 0 },
          circuitBreaker: { failureThreshold: 3, cooldownMs: 1000 },
        },
      },
    ],
    invariants: [],
  },
};

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe('Golden determinism', () => {
  const fixtureNames = [
    'payment-no-idempotency',
    'payment-with-idempotency',
    'network-duplication',
    'network-duplication-idempotent',
    'circuit-breaker-lifecycle',
  ] as const;

  for (const name of fixtureNames) {
    describe(name, () => {
      it('produces identical event sequence to golden fixture', () => {
        const golden = loadGolden(name);
        const scenario = scenarios[name]!;
        const result = simulateScenario(scenario);

        expect(result.events).toEqual(golden.events);
      });

      it('produces identical metrics to golden fixture', () => {
        const golden = loadGolden(name);
        const scenario = scenarios[name]!;
        const result = simulateScenario(scenario);
        const metrics = computeMetrics(result.events);

        expect(metrics).toEqual(golden.metrics);
      });

      it('produces identical invariant results to golden fixture', () => {
        const golden = loadGolden(name);
        const scenario = scenarios[name]!;
        const result = simulateScenario(scenario);
        const invariantResults = evaluateInvariants(result.events, scenario.invariants);

        expect(invariantResults).toEqual(golden.invariantResults);
      });

      it('produces identical simulation metadata to golden fixture', () => {
        const golden = loadGolden(name);
        const scenario = scenarios[name]!;
        const result = simulateScenario(scenario);

        expect(result.stopped).toBe(golden.stopped);
        expect(result.stopReason ?? null).toBe(golden.stopReason);
        expect(result.totalEvents).toBe(golden.totalEvents);
        expect(result.finalTimestamp).toBe(golden.finalTimestamp);
      });

      it('is deterministic across multiple runs', () => {
        const scenario = scenarios[name]!;
        const run1 = simulateScenario(scenario);
        const run2 = simulateScenario(scenario);

        expect(run1.events).toEqual(run2.events);
        expect(run1.totalEvents).toBe(run2.totalEvents);
        expect(run1.finalTimestamp).toBe(run2.finalTimestamp);
      });
    });
  }
});

// ─── Structural Invariant Tests ──────────────────────────────────────────────

describe('Golden fixture structural invariants', () => {
  it('payment-no-idempotency: invariant fails (double charge)', () => {
    const golden = loadGolden('payment-no-idempotency');
    const chargeInvariant = golden.invariantResults.find(
      (r) => r.invariantId === 'inv-charge-at-most-once',
    );
    expect(chargeInvariant).toBeDefined();
    expect(chargeInvariant!.passed).toBe(false);
    expect(chargeInvariant!.actual).toBeGreaterThan(1);
  });

  it('payment-with-idempotency: invariant passes (single charge)', () => {
    const golden = loadGolden('payment-with-idempotency');
    const chargeInvariant = golden.invariantResults.find(
      (r) => r.invariantId === 'inv-charge-at-most-once',
    );
    expect(chargeInvariant).toBeDefined();
    expect(chargeInvariant!.passed).toBe(true);
    expect(chargeInvariant!.actual).toBeLessThanOrEqual(1);
  });

  it('network-duplication: invariant fails (multiple fulfillments)', () => {
    const golden = loadGolden('network-duplication');
    const fulfillInvariant = golden.invariantResults.find(
      (r) => r.invariantId === 'inv-fulfill-once',
    );
    expect(fulfillInvariant).toBeDefined();
    expect(fulfillInvariant!.passed).toBe(false);
    expect(fulfillInvariant!.actual).toBeGreaterThan(1);
  });

  it('network-duplication-idempotent: invariant passes (single fulfillment)', () => {
    const golden = loadGolden('network-duplication-idempotent');
    const fulfillInvariant = golden.invariantResults.find(
      (r) => r.invariantId === 'inv-fulfill-once',
    );
    expect(fulfillInvariant).toBeDefined();
    expect(fulfillInvariant!.passed).toBe(true);
    expect(fulfillInvariant!.actual).toBeLessThanOrEqual(1);
  });

  it('circuit-breaker-lifecycle: contains circuit state transitions', () => {
    const golden = loadGolden('circuit-breaker-lifecycle');
    const circuitEvents = golden.events.filter((e) => e.type === 'CircuitStateChange');
    expect(circuitEvents.length).toBeGreaterThan(0);
  });

  it('all fixtures have events sorted by (timestamp, sequence)', () => {
    for (const name of Object.keys(scenarios)) {
      const golden = loadGolden(name);
      for (let i = 1; i < golden.events.length; i++) {
        const prev = golden.events[i - 1]!;
        const curr = golden.events[i]!;
        const ordered =
          curr.timestamp > prev.timestamp ||
          (curr.timestamp === prev.timestamp && curr.sequence > prev.sequence);
        expect(ordered).toBe(true);
      }
    }
  });
});
