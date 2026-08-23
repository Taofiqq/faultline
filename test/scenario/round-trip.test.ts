import { describe, it, expect } from 'vitest';
import { importScenario } from '../../src/scenario/importer';
import { exportScenario } from '../../src/scenario/exporter';
import type { Scenario } from '../../src/scenario/types';

const testScenario: Scenario = {
  schemaVersion: 1,
  seed: 12345,
  maxSimulationTimeMs: 30000,
  services: [
    { id: 'client', name: 'Client' },
    { id: 'gateway', name: 'API Gateway' },
    { id: 'payment', name: 'Payment Service' },
  ],
  paths: [
    {
      id: 'p1',
      source: 'client',
      destination: 'gateway',
      label: 'create-order',
      deadlineMs: 5000,
      operationName: 'createOrder',
      failures: [{ type: 'fixedLatency', ms: 100, probability: 1.0 }],
      resilience: {
        idempotencyEnabled: true,
        retry: { maxRetries: 3, baseDelay: 100, jitterFactor: 0.1 },
      },
    },
    {
      id: 'p2',
      source: 'gateway',
      destination: 'payment',
      label: 'charge',
      deadlineMs: 3000,
      operationName: 'charge',
      sideEffect: 'charge',
      failures: [{ type: 'duplicateRequest', count: 2, probability: 1.0 }],
      resilience: {
        idempotencyEnabled: false,
        circuitBreaker: { failureThreshold: 3, cooldownMs: 5000 },
      },
    },
  ],
  invariants: [
    { type: 'maxSideEffectCount', id: 'inv-1', effectName: 'charge', maxCount: 1 },
    { type: 'noPendingRequests', id: 'inv-2' },
  ],
};

describe('round-trip: export → import', () => {
  it('produces an identical scenario after export and re-import', () => {
    const json = exportScenario(testScenario);
    const result = importScenario(json);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.scenario).toEqual(testScenario);
    }
  });

  it('export produces valid JSON that passes structural validation', () => {
    const json = exportScenario(testScenario);
    const parsed = JSON.parse(json);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.seed).toBe(12345);
  });

  it('export → import → re-export produces identical JSON', () => {
    const json1 = exportScenario(testScenario);
    const result = importScenario(json1);
    expect(result.valid).toBe(true);
    if (result.valid) {
      const json2 = exportScenario(result.scenario);
      expect(json2).toBe(json1);
    }
  });
});
