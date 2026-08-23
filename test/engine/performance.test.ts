import { describe, it, expect } from 'vitest';
import { simulateScenario } from '../../src/engine/simulate-scenario';
import type { Scenario } from '../../src/scenario/types';

describe('Engine performance', () => {
  it('should simulate 100 requests × 3 retries in under 2 seconds', () => {
    // Create a scenario with 100 paths, each with 3 max retries
    const services = [
      { id: 'client', name: 'Client' },
      { id: 'server', name: 'Server' },
    ];

    const paths = Array.from({ length: 100 }, (_, i) => ({
      id: `path-${i}`,
      source: 'client',
      destination: 'server',
      label: `Request ${i}`,
      deadlineMs: 5000,
      operationName: `op-${i}`,
      failures: [
        {
          type: 'randomLatency' as const,
          probability: 0.5,
          minMs: 10,
          maxMs: 100,
        },
      ],
      resilience: {
        idempotencyEnabled: false,
        retry: {
          maxRetries: 3,
          baseDelay: 100,
          jitterFactor: 0.1,
        },
      },
    }));

    const scenario: Scenario = {
      schemaVersion: 1,
      seed: 42,
      maxSimulationTimeMs: 60000,
      services,
      paths,
      invariants: [],
    };

    const start = performance.now();
    const result = simulateScenario(scenario);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(2000);
    expect(result.events.length).toBeGreaterThan(0);
    // With 100 paths × up to 3 retries = up to 400 request attempts
    // Plus responses, so we expect significant event count
    expect(result.events.length).toBeGreaterThan(100);
  });
});
