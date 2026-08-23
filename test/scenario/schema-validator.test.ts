import { describe, it, expect } from 'vitest';
import { validateStructural, validateSemantic } from '../../src/scenario/schema-validator';
import { importScenario } from '../../src/scenario/importer';
import type { Scenario } from '../../src/scenario/types';

const validScenario: Scenario = {
  schemaVersion: 1,
  seed: 42,
  maxSimulationTimeMs: 60000,
  services: [
    { id: 'svc-1', name: 'Client' },
    { id: 'svc-2', name: 'Server' },
  ],
  paths: [
    {
      id: 'path-1',
      source: 'svc-1',
      destination: 'svc-2',
      label: 'request',
      deadlineMs: 5000,
      operationName: 'getUser',
      failures: [],
      resilience: { idempotencyEnabled: false },
    },
  ],
  invariants: [{ type: 'noPendingRequests', id: 'inv-1' }],
};

describe('validateStructural', () => {
  it('accepts a valid scenario', () => {
    const errors = validateStructural(validScenario);
    expect(errors).toEqual([]);
  });

  it('rejects missing schemaVersion', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { schemaVersion: _, ...rest } = validScenario;
    const errors = validateStructural(rest);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.code.includes('required'))).toBe(true);
  });

  it('rejects invalid seed (negative)', () => {
    const errors = validateStructural({ ...validScenario, seed: -1 });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects invalid seed (too large)', () => {
    const errors = validateStructural({ ...validScenario, seed: 4294967296 });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects wrong schemaVersion', () => {
    const errors = validateStructural({ ...validScenario, schemaVersion: 2 });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects invalid failure type', () => {
    const bad = {
      ...validScenario,
      paths: [
        {
          ...validScenario.paths[0],
          failures: [{ type: 'unknown', probability: 0.5 }],
        },
      ],
    };
    const errors = validateStructural(bad);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects probability > 1', () => {
    const bad = {
      ...validScenario,
      paths: [
        {
          ...validScenario.paths[0],
          failures: [{ type: 'lostResponse', probability: 1.5 }],
        },
      ],
    };
    const errors = validateStructural(bad);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects duplicate request count < 2', () => {
    const bad = {
      ...validScenario,
      paths: [
        {
          ...validScenario.paths[0],
          failures: [{ type: 'duplicateRequest', count: 1, probability: 1.0 }],
        },
      ],
    };
    const errors = validateStructural(bad);
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('validateSemantic', () => {
  it('accepts a valid scenario', () => {
    const errors = validateSemantic(validScenario);
    expect(errors).toEqual([]);
  });

  it('rejects duplicate service IDs', () => {
    const bad: Scenario = {
      ...validScenario,
      services: [
        { id: 'svc-1', name: 'A' },
        { id: 'svc-1', name: 'B' },
      ],
    };
    const errors = validateSemantic(bad);
    expect(errors.some((e) => e.code === 'semantic.duplicateServiceId')).toBe(true);
  });

  it('rejects self-loop paths', () => {
    const bad: Scenario = {
      ...validScenario,
      paths: [
        {
          ...validScenario.paths[0]!,
          source: 'svc-1',
          destination: 'svc-1',
        },
      ],
    };
    const errors = validateSemantic(bad);
    expect(errors.some((e) => e.code === 'semantic.selfLoop')).toBe(true);
  });

  it('rejects path referencing non-existent source', () => {
    const bad: Scenario = {
      ...validScenario,
      paths: [
        {
          ...validScenario.paths[0]!,
          source: 'nonexistent',
        },
      ],
    };
    const errors = validateSemantic(bad);
    expect(errors.some((e) => e.code === 'semantic.invalidServiceRef')).toBe(true);
  });

  it('rejects path referencing non-existent destination', () => {
    const bad: Scenario = {
      ...validScenario,
      paths: [
        {
          ...validScenario.paths[0]!,
          destination: 'nonexistent',
        },
      ],
    };
    const errors = validateSemantic(bad);
    expect(errors.some((e) => e.code === 'semantic.invalidServiceRef')).toBe(true);
  });

  it('rejects duplicate path IDs', () => {
    const bad: Scenario = {
      ...validScenario,
      paths: [
        validScenario.paths[0]!,
        { ...validScenario.paths[0]!, source: 'svc-2', destination: 'svc-1' },
      ],
    };
    const errors = validateSemantic(bad);
    expect(errors.some((e) => e.code === 'semantic.duplicatePathId')).toBe(true);
  });

  it('rejects randomLatency where maxMs < minMs', () => {
    const bad: Scenario = {
      ...validScenario,
      paths: [
        {
          ...validScenario.paths[0]!,
          failures: [{ type: 'randomLatency', minMs: 100, maxMs: 50, probability: 1 }],
        },
      ],
    };
    const errors = validateSemantic(bad);
    expect(errors.some((e) => e.code === 'semantic.invalidRange')).toBe(true);
  });

  it('rejects invariant referencing non-existent path', () => {
    const bad: Scenario = {
      ...validScenario,
      invariants: [{ type: 'maxRequestCount', id: 'inv-1', pathId: 'nonexistent', maxCount: 5 }],
    };
    const errors = validateSemantic(bad);
    expect(errors.some((e) => e.code === 'semantic.invalidPathRef')).toBe(true);
  });

  it('rejects duplicate invariant IDs', () => {
    const bad: Scenario = {
      ...validScenario,
      invariants: [
        { type: 'noPendingRequests', id: 'inv-1' },
        { type: 'noPendingRequests', id: 'inv-1' },
      ],
    };
    const errors = validateSemantic(bad);
    expect(errors.some((e) => e.code === 'semantic.duplicateInvariantId')).toBe(true);
  });
});

describe('importScenario', () => {
  it('imports a valid JSON string and returns a Scenario', () => {
    const result = importScenario(JSON.stringify(validScenario));
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.scenario.seed).toBe(42);
      expect(result.scenario.services).toHaveLength(2);
    }
  });

  it('rejects invalid JSON', () => {
    const result = importScenario('not json at all');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]!.code).toBe('parse.invalidJson');
    }
  });

  it('rejects structurally invalid input', () => {
    const result = importScenario(JSON.stringify({ schemaVersion: 2 }));
    expect(result.valid).toBe(false);
  });

  it('rejects semantically invalid input (self-loop)', () => {
    const bad = {
      ...validScenario,
      paths: [{ ...validScenario.paths[0], source: 'svc-1', destination: 'svc-1' }],
    };
    const result = importScenario(JSON.stringify(bad));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.code === 'semantic.selfLoop')).toBe(true);
    }
  });

  it('applies default maxSimulationTimeMs when not provided', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { maxSimulationTimeMs: _, ...withoutMax } = validScenario;
    const result = importScenario(JSON.stringify(withoutMax));
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.scenario.maxSimulationTimeMs).toBe(60000);
    }
  });
});
