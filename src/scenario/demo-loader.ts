/**
 * Built-in payment double-charge demonstration scenario.
 *
 * Topology: Client → API Gateway → Payment Service → Bank
 * (simplified to a single path: Gateway → Payment Service)
 *
 * The double charge is caused by retry after a lost response:
 * - Original request processes successfully, emitting "charge" side-effect.
 * - Response is lost (PRNG draw < 0.5 with seed=0).
 * - Caller times out and schedules a retry.
 * - Retry also processes successfully, emitting a second "charge".
 * - With idempotency enabled, the retry returns the cached response
 *   and no second side-effect is emitted.
 */

import type { Scenario } from '../scenario/types';

/**
 * Payment scenario WITHOUT idempotency — produces double charge.
 *
 * Config: seed=0, lostResponse prob=0.5, maxRetries=1, baseDelay=100, jitter=0
 *
 * With seed=0 xoshiro128**: first loss draw ~0.262 (<0.5 = LOST),
 * second draw ~0.838 (>=0.5 = NOT LOST). So original is lost, retry succeeds.
 */
export function createPaymentDoubleChargeScenario(): Scenario {
  return {
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
  };
}

/**
 * Payment scenario WITH idempotency — produces exactly one charge.
 * Identical to the double-charge variant except idempotencyEnabled: true.
 */
export function createPaymentIdempotentScenario(): Scenario {
  return {
    ...createPaymentDoubleChargeScenario(),
    paths: [
      {
        ...createPaymentDoubleChargeScenario().paths[0]!,
        resilience: {
          idempotencyEnabled: true,
          retry: { maxRetries: 1, baseDelay: 100, jitterFactor: 0 },
        },
      },
    ],
  };
}

/**
 * Simple success scenario — no failures, used for testing the happy path.
 */
export function createSuccessScenario(): Scenario {
  return {
    schemaVersion: 1,
    seed: 42,
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
        label: 'request',
        deadlineMs: 5000,
        operationName: 'getData',
        failures: [],
        resilience: { idempotencyEnabled: false },
      },
    ],
    invariants: [],
  };
}

/**
 * Late response scenario — fixed latency > deadline causes timeout,
 * then response arrives after deadline (late: true).
 */
export function createLateResponseScenario(): Scenario {
  return {
    schemaVersion: 1,
    seed: 42,
    maxSimulationTimeMs: 60000,
    services: [
      { id: 'client', name: 'Client' },
      { id: 'server', name: 'Slow Server' },
    ],
    paths: [
      {
        id: 'client-to-slow',
        source: 'client',
        destination: 'server',
        label: 'slow-request',
        deadlineMs: 100,
        operationName: 'slowOp',
        sideEffect: 'process',
        failures: [{ type: 'fixedLatency', ms: 200, probability: 1.0 }],
        resilience: { idempotencyEnabled: false },
      },
    ],
    invariants: [],
  };
}
