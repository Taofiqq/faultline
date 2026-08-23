import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { importScenario } from '../../src/scenario/importer';
import { exportScenario } from '../../src/scenario/exporter';
import { simulateScenario } from '../../src/engine/simulate-scenario';
import { evaluateInvariants } from '../../src/invariants/evaluator';
import { computeMetrics } from '../../src/metrics/compute';
import {
  createPaymentDoubleChargeScenario,
  createPaymentIdempotentScenario,
} from '../../src/scenario/demo-loader';
import type { Scenario } from '../../src/scenario/types';

// ─── Deterministic Export Golden Tests ───────────────────────────────────────

describe('Deterministic export', () => {
  it('repeated exports are byte-identical', () => {
    const scenario = createPaymentDoubleChargeScenario();
    const json1 = exportScenario(scenario);
    const json2 = exportScenario(scenario);
    expect(json1).toBe(json2);
  });

  it('export does not mutate the input scenario', () => {
    const scenario = createPaymentDoubleChargeScenario();
    const before = JSON.stringify(scenario);
    exportScenario(scenario);
    const after = JSON.stringify(scenario);
    expect(after).toBe(before);
  });

  it('exported JSON has stable key order (schemaVersion first)', () => {
    const scenario = createPaymentDoubleChargeScenario();
    const json = exportScenario(scenario);
    const keys = Object.keys(JSON.parse(json));
    expect(keys).toEqual([
      'schemaVersion',
      'seed',
      'maxSimulationTimeMs',
      'services',
      'paths',
      'invariants',
    ]);
  });

  it('path keys are in schema-defined order', () => {
    const scenario = createPaymentDoubleChargeScenario();
    const json = exportScenario(scenario);
    const parsed = JSON.parse(json);
    const pathKeys = Object.keys(parsed.paths[0]);
    expect(pathKeys[0]).toBe('id');
    expect(pathKeys[1]).toBe('source');
    expect(pathKeys[2]).toBe('destination');
    expect(pathKeys.includes('failures')).toBe(true);
    expect(pathKeys.includes('resilience')).toBe(true);
  });
});

// ─── Boundary/Edge-Case Validation Tests ─────────────────────────────────────

describe('Import boundary validation', () => {
  const base = createPaymentDoubleChargeScenario();
  const baseJson = () => JSON.parse(exportScenario(base));

  it('rejects seed = -1', () => {
    const data = baseJson();
    data.seed = -1;
    const result = importScenario(JSON.stringify(data));
    expect(result.valid).toBe(false);
  });

  it('rejects seed > 2^32 - 1', () => {
    const data = baseJson();
    data.seed = 4294967296;
    const result = importScenario(JSON.stringify(data));
    expect(result.valid).toBe(false);
  });

  it('accepts seed = 0 (minimum)', () => {
    const data = baseJson();
    data.seed = 0;
    const result = importScenario(JSON.stringify(data));
    expect(result.valid).toBe(true);
  });

  it('accepts seed = 4294967295 (maximum)', () => {
    const data = baseJson();
    data.seed = 4294967295;
    const result = importScenario(JSON.stringify(data));
    expect(result.valid).toBe(true);
  });

  it('rejects probability = -0.1', () => {
    const data = baseJson();
    data.paths[0].failures[0].probability = -0.1;
    const result = importScenario(JSON.stringify(data));
    expect(result.valid).toBe(false);
  });

  it('rejects probability = 1.1', () => {
    const data = baseJson();
    data.paths[0].failures[0].probability = 1.1;
    const result = importScenario(JSON.stringify(data));
    expect(result.valid).toBe(false);
  });

  it('rejects deadlineMs = 0', () => {
    const data = baseJson();
    data.paths[0].deadlineMs = 0;
    const result = importScenario(JSON.stringify(data));
    expect(result.valid).toBe(false);
  });

  it('rejects retry maxRetries = -1', () => {
    const data = baseJson();
    data.paths[0].resilience.retry.maxRetries = -1;
    const result = importScenario(JSON.stringify(data));
    expect(result.valid).toBe(false);
  });

  it('rejects retry maxRetries = 51', () => {
    const data = baseJson();
    data.paths[0].resilience.retry.maxRetries = 51;
    const result = importScenario(JSON.stringify(data));
    expect(result.valid).toBe(false);
  });

  it('accepts retry maxRetries = 0 (no retries)', () => {
    const data = baseJson();
    data.paths[0].resilience.retry.maxRetries = 0;
    const result = importScenario(JSON.stringify(data));
    expect(result.valid).toBe(true);
  });

  it('rejects duplicate count = 1', () => {
    const data = baseJson();
    data.paths[0].failures = [{ type: 'duplicateRequest', count: 1, probability: 1.0 }];
    const result = importScenario(JSON.stringify(data));
    expect(result.valid).toBe(false);
  });

  it('rejects maxSimulationTimeMs = 0', () => {
    const data = baseJson();
    data.maxSimulationTimeMs = 0;
    const result = importScenario(JSON.stringify(data));
    expect(result.valid).toBe(false);
  });

  it('rejects unsupported schemaVersion', () => {
    const data = baseJson();
    data.schemaVersion = 2;
    const result = importScenario(JSON.stringify(data));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.code.includes('schema'))).toBe(true);
    }
  });

  it('rejects unknown properties', () => {
    const data = baseJson();
    data.unknownProp = 'should fail';
    const result = importScenario(JSON.stringify(data));
    expect(result.valid).toBe(false);
  });

  it('rejects invalid service reference (self-loop)', () => {
    const data = baseJson();
    data.paths[0].destination = data.paths[0].source;
    const result = importScenario(JSON.stringify(data));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.code === 'semantic.selfLoop')).toBe(true);
    }
  });

  it('rejects non-existent service reference', () => {
    const data = baseJson();
    data.paths[0].source = 'nonexistent';
    const result = importScenario(JSON.stringify(data));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.code === 'semantic.invalidServiceRef')).toBe(true);
    }
  });

  it('rejects malformed JSON', () => {
    const result = importScenario('{broken json');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]!.code).toBe('parse.invalidJson');
    }
  });
});

// ─── Atomicity/Non-Mutation Tests ────────────────────────────────────────────

describe('Import atomicity', () => {
  it('invalid import does not produce partial state', () => {
    const result = importScenario('{"schemaVersion": 1, "seed": -1}');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect('scenario' in result).toBe(false);
    }
  });

  it('import does not mutate the JSON string', () => {
    const json = exportScenario(createPaymentDoubleChargeScenario());
    const jsonCopy = json.slice();
    importScenario(json);
    expect(json).toBe(jsonCopy);
  });
});

// ─── Round-Trip Golden Tests with Payment Scenarios ──────────────────────────

describe('Round-trip: payment scenarios', () => {
  it('double-charge scenario round-trips without changing simulation', () => {
    const scenario = createPaymentDoubleChargeScenario();
    const json = exportScenario(scenario);
    const imported = importScenario(json);
    expect(imported.valid).toBe(true);
    if (!imported.valid) return;

    // Simulate both
    const result1 = simulateScenario(scenario);
    const result2 = simulateScenario(imported.scenario);
    expect(result2.events).toEqual(result1.events);

    // Invariants match
    const inv1 = evaluateInvariants(result1.events, scenario.invariants);
    const inv2 = evaluateInvariants(result2.events, imported.scenario.invariants);
    expect(inv2).toEqual(inv1);

    // Metrics match
    const m1 = computeMetrics(result1.events);
    const m2 = computeMetrics(result2.events);
    expect(m2).toEqual(m1);
  });

  it('idempotent scenario round-trips without changing simulation', () => {
    const scenario = createPaymentIdempotentScenario();
    const json = exportScenario(scenario);
    const imported = importScenario(json);
    expect(imported.valid).toBe(true);
    if (!imported.valid) return;

    const result1 = simulateScenario(scenario);
    const result2 = simulateScenario(imported.scenario);
    expect(result2.events).toEqual(result1.events);
  });

  it('import → export → import remains stable', () => {
    const scenario = createPaymentDoubleChargeScenario();
    const json1 = exportScenario(scenario);
    const r1 = importScenario(json1);
    expect(r1.valid).toBe(true);
    if (!r1.valid) return;
    const json2 = exportScenario(r1.scenario);
    expect(json2).toBe(json1); // byte-identical
    const r2 = importScenario(json2);
    expect(r2.valid).toBe(true);
    if (!r2.valid) return;
    expect(r2.scenario).toEqual(r1.scenario);
  });

  it('reordered JSON keys do not affect imported scenario', () => {
    const scenario = createPaymentDoubleChargeScenario();
    const json = exportScenario(scenario);
    const parsed = JSON.parse(json);
    // Reorder top-level keys
    const reordered = {
      invariants: parsed.invariants,
      seed: parsed.seed,
      paths: parsed.paths,
      schemaVersion: parsed.schemaVersion,
      services: parsed.services,
      maxSimulationTimeMs: parsed.maxSimulationTimeMs,
    };
    const result = importScenario(JSON.stringify(reordered));
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.scenario).toEqual(scenario);
  });
});

// ─── Fast-Check Property Test ────────────────────────────────────────────────

describe('Property: export/import equivalence', () => {
  const scenarioArb = fc
    .record({
      seed: fc.nat({ max: 4294967295 }),
      maxSimulationTimeMs: fc.integer({ min: 1, max: 60000 }),
    })
    .chain(({ seed, maxSimulationTimeMs }) =>
      fc.constant({
        schemaVersion: 1 as const,
        seed,
        maxSimulationTimeMs,
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
            failures: [] as Scenario['paths'][0]['failures'],
            resilience: { idempotencyEnabled: false },
          },
        ],
        invariants: [] as Scenario['invariants'],
      } satisfies Scenario),
    );

  it('export → import produces deeply equal scenario (100 runs)', () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const json = exportScenario(scenario);
        const result = importScenario(json);
        expect(result.valid).toBe(true);
        if (result.valid) {
          expect(result.scenario).toEqual(scenario);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('repeated exports are byte-identical (100 runs)', () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const json1 = exportScenario(scenario);
        const json2 = exportScenario(scenario);
        expect(json1).toBe(json2);
      }),
      { numRuns: 100 },
    );
  });
});
