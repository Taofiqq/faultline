import { describe, it, expect } from 'vitest';
import { simulateScenario } from '../../src/engine/simulate-scenario';
import type { Scenario } from '../../src/scenario/types';

describe('1000-event performance fixture', () => {
  it('should handle scenarios generating 1000+ events efficiently', () => {
    // A scenario designed to produce at least 1000 events
    // Many paths with high failure rates causing retries
    const services = [
      { id: 'gateway', name: 'Gateway' },
      { id: 'service-a', name: 'Service A' },
      { id: 'service-b', name: 'Service B' },
    ];

    const paths = Array.from({ length: 100 }, (_, i) => ({
      id: `path-${i}`,
      source: i % 2 === 0 ? 'gateway' : 'service-a',
      destination: i % 2 === 0 ? 'service-a' : 'service-b',
      label: `Path ${i}`,
      deadlineMs: 10000,
      operationName: `operation-${i}`,
      failures: [
        {
          type: 'serviceError' as const,
          probability: 0.7,
        },
        {
          type: 'randomLatency' as const,
          probability: 0.3,
          minMs: 50,
          maxMs: 500,
        },
      ],
      resilience: {
        idempotencyEnabled: false,
        retry: {
          maxRetries: 5,
          baseDelay: 50,
          jitterFactor: 0.2,
        },
      },
    }));

    const scenario: Scenario = {
      schemaVersion: 1,
      seed: 12345,
      maxSimulationTimeMs: 60000,
      services,
      paths,
      invariants: [],
    };

    const start = performance.now();
    const result = simulateScenario(scenario);
    const elapsed = performance.now() - start;

    // Should generate at least 1000 events
    expect(result.events.length).toBeGreaterThanOrEqual(1000);
    // Should still complete in reasonable time
    expect(elapsed).toBeLessThan(5000);
    // Verify determinism: run again with same seed
    const result2 = simulateScenario(scenario);
    expect(result2.events.length).toBe(result.events.length);
    expect(result2.events).toEqual(result.events);
  });

  it('should handle near-limit event counts without crashing', () => {
    // Stress test with many paths and retries
    const services = [
      { id: 'src', name: 'Source' },
      { id: 'dst', name: 'Destination' },
    ];

    const paths = Array.from({ length: 200 }, (_, i) => ({
      id: `stress-path-${i}`,
      source: 'src',
      destination: 'dst',
      label: `Stress ${i}`,
      deadlineMs: 30000,
      operationName: `stress-op-${i}`,
      failures: [
        {
          type: 'serviceError' as const,
          probability: 0.8,
        },
      ],
      resilience: {
        idempotencyEnabled: false,
        retry: {
          maxRetries: 5,
          baseDelay: 10,
          jitterFactor: 0.1,
        },
      },
    }));

    const scenario: Scenario = {
      schemaVersion: 1,
      seed: 99999,
      maxSimulationTimeMs: 60000,
      services,
      paths,
      invariants: [],
    };

    const start = performance.now();
    const result = simulateScenario(scenario);
    const elapsed = performance.now() - start;

    expect(result.events.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(10000);
    // Should not exceed engine safety limit
    expect(result.events.length).toBeLessThanOrEqual(100000);
  });
});
