import { describe, it, expect } from 'vitest';
import { simulateScenario } from '../../src/engine/simulate-scenario';
import {
  createCircuitBreakerState,
  checkCircuit,
  recordOutcome,
} from '../../src/engine/circuit-breaker';
import type { Scenario } from '../../src/scenario/types';

// ─── Test Scenarios ──────────────────────────────────────────────────────────

function duplicationScenario(idempotency: boolean): Scenario {
  return {
    schemaVersion: 1,
    seed: 100,
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
        label: 'dup-test',
        deadlineMs: 5000,
        operationName: 'op',
        sideEffect: 'effect',
        failures: [{ type: 'duplicateRequest', count: 3, probability: 1.0 }],
        resilience: { idempotencyEnabled: idempotency },
      },
    ],
    invariants: [],
  };
}

function serviceErrorScenario(): Scenario {
  return {
    schemaVersion: 1,
    seed: 200,
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
        label: 'error-test',
        deadlineMs: 5000,
        operationName: 'op',
        sideEffect: 'effect',
        failures: [{ type: 'serviceError', probability: 1.0 }],
        resilience: {
          idempotencyEnabled: false,
          retry: { maxRetries: 2, baseDelay: 100, jitterFactor: 0 },
        },
      },
    ],
    invariants: [],
  };
}

function circuitBreakerScenario(): Scenario {
  return {
    schemaVersion: 1,
    seed: 300,
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
        label: 'cb-test',
        deadlineMs: 100,
        operationName: 'op',
        sideEffect: 'effect',
        failures: [{ type: 'lostResponse', probability: 1.0 }],
        resilience: {
          idempotencyEnabled: false,
          retry: { maxRetries: 5, baseDelay: 50, jitterFactor: 0 },
          circuitBreaker: { failureThreshold: 2, cooldownMs: 1000 },
        },
      },
    ],
    invariants: [],
  };
}

// ─── Network Duplication Tests ───────────────────────────────────────────────

describe('Network duplication', () => {
  it('creates count deliveries with distinct deliveryIndex values', () => {
    const result = simulateScenario(duplicationScenario(false));
    const arrivals = result.events.filter((e) => e.type === 'RequestArrived');
    expect(arrivals).toHaveLength(3); // count=3
    const indices = arrivals.map((e) => e.type === 'RequestArrived' && e.deliveryIndex);
    expect(indices).toEqual([0, 1, 2]);
  });

  it('all deliveries share operationId and idempotencyKey', () => {
    const result = simulateScenario(duplicationScenario(false));
    const arrivals = result.events.filter((e) => e.type === 'RequestArrived');
    const opIds = new Set(arrivals.map((e) => e.type === 'RequestArrived' && e.operationId));
    const keys = new Set(arrivals.map((e) => e.type === 'RequestArrived' && e.idempotencyKey));
    expect(opIds.size).toBe(1);
    expect(keys.size).toBe(1);
  });

  it('without idempotency: each delivery emits the side effect', () => {
    const result = simulateScenario(duplicationScenario(false));
    const effects = result.events.filter((e) => e.type === 'SideEffect');
    expect(effects).toHaveLength(3); // one per delivery
  });

  it('with idempotency: only first delivery emits side effect', () => {
    const result = simulateScenario(duplicationScenario(true));
    const effects = result.events.filter((e) => e.type === 'SideEffect');
    expect(effects).toHaveLength(1);
  });

  it('with idempotency: later deliveries are logged as deduplicated', () => {
    const result = simulateScenario(duplicationScenario(true));
    const arrivals = result.events.filter((e) => e.type === 'RequestArrived');
    const deduped = arrivals.filter((e) => e.type === 'RequestArrived' && e.deduplicated);
    expect(deduped).toHaveLength(2); // deliveryIndex 1 and 2
  });

  it('duplication is independent of retries (does not consume budget)', () => {
    // Scenario with dup + retry — budget starts at 1 retry
    const scenario: Scenario = {
      schemaVersion: 1,
      seed: 50,
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
          failures: [{ type: 'duplicateRequest', count: 2, probability: 1.0 }],
          resilience: {
            idempotencyEnabled: false,
            retry: { maxRetries: 1, baseDelay: 100, jitterFactor: 0 },
          },
        },
      ],
      invariants: [],
    };
    const result = simulateScenario(scenario);
    // Should have success (no loss/errors), so no retry triggered
    const retries = result.events.filter((e) => e.type === 'RetryScheduled');
    expect(retries).toHaveLength(0);
    // But duplication still happened
    const arrivals = result.events.filter((e) => e.type === 'RequestArrived');
    expect(arrivals).toHaveLength(2);
  });
});

// ─── Service Error Tests ─────────────────────────────────────────────────────

describe('Simulated service errors', () => {
  it('emits ResponseSent with success: false on service error', () => {
    const result = simulateScenario(serviceErrorScenario());
    const responses = result.events.filter((e) => e.type === 'ResponseSent');
    expect(responses[0]!.type === 'ResponseSent' && responses[0]!.success).toBe(false);
  });

  it('no side-effect is emitted on service error', () => {
    const result = simulateScenario(serviceErrorScenario());
    // With 100% service error, no side effects should ever be emitted
    const effects = result.events.filter((e) => e.type === 'SideEffect');
    expect(effects).toHaveLength(0);
  });

  it('service error is retryable (triggers retry)', () => {
    const result = simulateScenario(serviceErrorScenario());
    const retries = result.events.filter((e) => e.type === 'RetryScheduled');
    // With 100% error and 2 retries max, we get retries scheduled
    expect(retries.length).toBeGreaterThanOrEqual(1);
  });

  it('service errors are not cached by idempotency', () => {
    // Scenario: first call errors, second call (retry) should get fresh processing
    const scenario: Scenario = {
      ...serviceErrorScenario(),
      paths: [
        {
          ...serviceErrorScenario().paths[0]!,
          // Use 50% error probability so some succeed
          failures: [{ type: 'serviceError', probability: 0.5 }],
          resilience: {
            idempotencyEnabled: true,
            retry: { maxRetries: 3, baseDelay: 50, jitterFactor: 0 },
          },
        },
      ],
    };
    const result = simulateScenario(scenario);
    // Even with idempotency, errors should not be cached
    // If error was cached, all retries would also get errors
    // With 50% probability over multiple attempts, at least one should succeed
    const successResponses = result.events.filter(
      (e) => e.type === 'ResponseSent' && e.success === true,
    );
    // We can't guarantee success with any specific seed, but we verify no caching
    // by checking that failed responses don't have deduplicated: true
    const failedResponses = result.events.filter(
      (e) => e.type === 'ResponseSent' && e.success === false,
    );
    for (const r of failedResponses) {
      expect(r.type === 'ResponseSent' && r.deduplicated).toBe(false);
    }
    void successResponses;
  });
});

// ─── Circuit Breaker Unit Tests ──────────────────────────────────────────────

describe('Circuit breaker state machine', () => {
  const config = { failureThreshold: 2, cooldownMs: 1000 };

  it('starts in closed state', () => {
    const state = createCircuitBreakerState();
    expect(state.status).toBe('closed');
    expect(state.consecutiveFailures).toBe(0);
    expect(state.generation).toBe(0);
  });

  it('admits requests when closed', () => {
    const state = createCircuitBreakerState();
    expect(checkCircuit(state, config, 0, 1)).toBe('admit');
  });

  it('opens after consecutive failures reach threshold', () => {
    const state = createCircuitBreakerState();
    recordOutcome(state, config, 0, false, 100);
    expect(state.status).toBe('closed');
    recordOutcome(state, config, 0, false, 200);
    expect(state.status).toBe('open');
    expect(state.generation).toBe(1);
  });

  it('success resets consecutive failures', () => {
    const state = createCircuitBreakerState();
    recordOutcome(state, config, 0, false, 100);
    expect(state.consecutiveFailures).toBe(1);
    recordOutcome(state, config, 0, true, 200);
    expect(state.consecutiveFailures).toBe(0);
    expect(state.status).toBe('closed');
  });

  it('rejects requests when open (before cooldown)', () => {
    const state = createCircuitBreakerState();
    recordOutcome(state, config, 0, false, 0);
    recordOutcome(state, config, 0, false, 0);
    // Now open, opened at t=0, cooldown=1000
    expect(checkCircuit(state, config, 500, 10)).toBe('reject');
  });

  it('transitions to half-open after cooldown', () => {
    const state = createCircuitBreakerState();
    recordOutcome(state, config, 0, false, 0);
    recordOutcome(state, config, 0, false, 0);
    // cooldown elapsed at t=1000
    const decision = checkCircuit(state, config, 1000, 10);
    expect(decision).toBe('probe');
    expect(state.status).toBe('half-open');
  });

  it('only first request after cooldown becomes probe', () => {
    const state = createCircuitBreakerState();
    recordOutcome(state, config, 0, false, 0);
    recordOutcome(state, config, 0, false, 0);
    const d1 = checkCircuit(state, config, 1000, 5); // first → probe
    const d2 = checkCircuit(state, config, 1000, 6); // second → reject
    expect(d1).toBe('probe');
    expect(d2).toBe('reject');
  });

  it('probe success closes circuit', () => {
    const state = createCircuitBreakerState();
    recordOutcome(state, config, 0, false, 0);
    recordOutcome(state, config, 0, false, 0);
    checkCircuit(state, config, 1000, 5); // → half-open
    recordOutcome(state, config, 1, true, 1000); // probe success
    expect(state.status).toBe('closed');
    expect(state.consecutiveFailures).toBe(0);
  });

  it('probe failure reopens circuit with new generation', () => {
    const state = createCircuitBreakerState();
    recordOutcome(state, config, 0, false, 0);
    recordOutcome(state, config, 0, false, 0);
    expect(state.generation).toBe(1);
    checkCircuit(state, config, 1000, 5); // → half-open
    recordOutcome(state, config, 1, false, 1000); // probe fails
    expect(state.status).toBe('open');
    expect(state.generation).toBe(2);
  });

  it('stale generation outcomes are ignored', () => {
    const state = createCircuitBreakerState();
    recordOutcome(state, config, 0, false, 0);
    recordOutcome(state, config, 0, false, 0); // opens, gen=1
    // Outcome from gen 0 (stale) should be ignored
    recordOutcome(state, config, 0, true, 500);
    expect(state.status).toBe('open'); // unchanged
  });
});

// ─── Circuit Breaker Integration Tests ───────────────────────────────────────

describe('Circuit breaker integration', () => {
  it('circuit opens after threshold timeouts', () => {
    const result = simulateScenario(circuitBreakerScenario());
    const stateChanges = result.events.filter((e) => e.type === 'CircuitStateChange');
    expect(stateChanges.length).toBeGreaterThanOrEqual(1);
    const firstOpen = stateChanges.find(
      (e) => e.type === 'CircuitStateChange' && e.newState === 'open',
    );
    expect(firstOpen).toBeDefined();
  });

  it('circuit-open error is emitted when circuit is open', () => {
    const result = simulateScenario(circuitBreakerScenario());
    const circuitErrors = result.events.filter((e) => e.type === 'CircuitOpenError');
    expect(circuitErrors.length).toBeGreaterThanOrEqual(1);
  });

  it('circuit-open is non-retryable (no RetryScheduled after it)', () => {
    const result = simulateScenario(circuitBreakerScenario());
    // Find CircuitOpenError events and verify no RetryScheduled follows for that attempt
    const events = result.events;
    for (let i = 0; i < events.length; i++) {
      if (events[i]!.type === 'CircuitOpenError') {
        // The next event for this operation should NOT be RetryScheduled
        const opId = (events[i] as { operationId: number }).operationId;
        const nextRetry = events
          .slice(i + 1)
          .find((e) => e.type === 'RetryScheduled' && e.operationId === opId);
        // Circuit-open doesn't trigger retries
        expect(nextRetry).toBeUndefined();
      }
    }
  });

  it('is deterministic across runs', () => {
    const r1 = simulateScenario(circuitBreakerScenario());
    const r2 = simulateScenario(circuitBreakerScenario());
    expect(r1.events).toEqual(r2.events);
  });
});

// ─── Golden Sequence: Duplication without idempotency ─────────────────────────

describe('Golden: duplication without idempotency', () => {
  it('produces 3 side effects (one per delivery)', () => {
    const result = simulateScenario(duplicationScenario(false));
    const effects = result.events.filter((e) => e.type === 'SideEffect');
    expect(effects).toHaveLength(3);
  });

  it('first ResponseReceived resolves the attempt; others are late', () => {
    const result = simulateScenario(duplicationScenario(false));
    const received = result.events.filter((e) => e.type === 'ResponseReceived');
    expect(received.length).toBe(3);
    // First resolves normally (late: false)
    const nonLate = received.filter((e) => e.type === 'ResponseReceived' && !e.late);
    expect(nonLate).toHaveLength(1);
    // Others are late (attempt already resolved)
    const late = received.filter((e) => e.type === 'ResponseReceived' && e.late);
    expect(late).toHaveLength(2);
  });
});

describe('Golden: duplication with idempotency', () => {
  it('produces exactly 1 side effect', () => {
    const result = simulateScenario(duplicationScenario(true));
    const effects = result.events.filter((e) => e.type === 'SideEffect');
    expect(effects).toHaveLength(1);
  });

  it('2 of 3 arrivals are deduplicated', () => {
    const result = simulateScenario(duplicationScenario(true));
    const deduped = result.events.filter((e) => e.type === 'RequestArrived' && e.deduplicated);
    expect(deduped).toHaveLength(2);
  });
});
