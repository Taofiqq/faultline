/**
 * Golden fixture generator.
 * Run with: npx tsx scripts/generate-golden.ts
 *
 * Only run this explicitly when golden files need updating.
 * Any change to golden fixtures is treated as a breaking change in PR review.
 */
import { simulateScenario } from '../src/engine/simulate-scenario';
import { computeMetrics } from '../src/metrics/compute';
import { evaluateInvariants } from '../src/invariants/evaluator';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Scenario } from '../src/scenario/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const outDir = join(__dirname, '..', 'test', 'golden');
mkdirSync(outDir, { recursive: true });

function generate(name: string, scenario: Scenario) {
  const result = simulateScenario(scenario);
  const metrics = computeMetrics(result.events);
  const invariantResults = evaluateInvariants(result.events, scenario.invariants);

  const fixture = {
    scenario: { seed: scenario.seed, schemaVersion: scenario.schemaVersion },
    events: result.events,
    metrics,
    invariantResults,
    stopped: result.stopped,
    stopReason: result.stopReason ?? null,
    totalEvents: result.totalEvents,
    finalTimestamp: result.finalTimestamp,
  };

  writeFileSync(join(outDir, `${name}.json`), JSON.stringify(fixture, null, 2));
  console.log(`Generated: ${name}.json (${result.events.length} events)`);
}

// ─── Scenario 1: Payment Without Idempotency (double charge) ─────────────────

const paymentNoIdempotency: Scenario = {
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

// ─── Scenario 2: Payment With Idempotency (single charge) ────────────────────

const paymentWithIdempotency: Scenario = {
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
};

// ─── Scenario 3: Network Duplication Without Idempotency ─────────────────────

const networkDuplication: Scenario = {
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
};

// ─── Scenario 4: Network Duplication With Idempotency ────────────────────────

const networkDuplicationIdempotent: Scenario = {
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
};

// ─── Scenario 5: Circuit Breaker Lifecycle ───────────────────────────────────

const circuitBreakerLifecycle: Scenario = {
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
};

// ─── Generate All ────────────────────────────────────────────────────────────

console.log('Generating golden fixtures...\n');

generate('payment-no-idempotency', paymentNoIdempotency);
generate('payment-with-idempotency', paymentWithIdempotency);
generate('network-duplication', networkDuplication);
generate('network-duplication-idempotent', networkDuplicationIdempotent);
generate('circuit-breaker-lifecycle', circuitBreakerLifecycle);

console.log('\nDone. Golden fixtures written to test/golden/');
