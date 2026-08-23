/**
 * Built-in payment double-charge demonstration scenario.
 *
 * Topology: Client → API Gateway → Payment Service → Bank
 *
 * In M4 (minimal slice): single path Gateway → Payment Service with
 * lost response injection (probability 1.0) to demonstrate that the
 * destination processes the request (side-effect: "charge") but the
 * caller times out.
 *
 * The double-charge from network duplication is added in M5.
 */

import type { Scenario } from '../scenario/types';

/**
 * Payment scenario with lost response — demonstrates one charge + one timeout.
 */
export function createPaymentScenario(): Scenario {
  return {
    schemaVersion: 1,
    seed: 42,
    maxSimulationTimeMs: 60000,
    services: [
      { id: 'client', name: 'Client' },
      { id: 'gateway', name: 'API Gateway' },
      { id: 'payment', name: 'Payment Service' },
      { id: 'bank', name: 'Bank' },
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
        failures: [{ type: 'lostResponse', probability: 1.0 }],
        resilience: { idempotencyEnabled: false },
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
        // Request latency of 0 so request arrives instantly,
        // but response latency of 200ms > 100ms deadline
        failures: [{ type: 'fixedLatency', ms: 200, probability: 1.0 }],
        resilience: { idempotencyEnabled: false },
      },
    ],
    invariants: [],
  };
}
