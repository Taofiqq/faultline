import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { simulate } from '../../src/engine/event-loop';
import { simulateScenario } from '../../src/engine/simulate-scenario';
import {
  createPaymentDoubleChargeScenario,
  createPaymentIdempotentScenario,
} from '../../src/scenario/demo-loader';
import { evaluateInvariants } from '../../src/invariants/evaluator';
import type { Scenario } from '../../src/scenario/types';
import type { QueueEvent } from '../../src/engine/failure-pipeline';

describe('Event sequence uniqueness', () => {
  it('payment scenario (no idempotency) has all unique sequences', () => {
    const result = simulateScenario(createPaymentDoubleChargeScenario());
    const seqs = result.events.map((e) => e.sequence);
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it('payment scenario (with idempotency) has all unique sequences', () => {
    const result = simulateScenario(createPaymentIdempotentScenario());
    const seqs = result.events.map((e) => e.sequence);
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it('multiple initial paths cannot collide with generated events', () => {
    const scenario: Scenario = {
      schemaVersion: 1,
      seed: 42,
      maxSimulationTimeMs: 60000,
      services: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C' },
      ],
      paths: [
        {
          id: 'p1',
          source: 'a',
          destination: 'b',
          label: 'r1',
          deadlineMs: 5000,
          operationName: 'op1',
          failures: [],
          resilience: { idempotencyEnabled: false },
        },
        {
          id: 'p2',
          source: 'b',
          destination: 'c',
          label: 'r2',
          deadlineMs: 5000,
          operationName: 'op2',
          failures: [],
          resilience: { idempotencyEnabled: false },
        },
        {
          id: 'p3',
          source: 'a',
          destination: 'c',
          label: 'r3',
          deadlineMs: 5000,
          operationName: 'op3',
          failures: [],
          resilience: { idempotencyEnabled: false },
        },
      ],
      invariants: [],
    };
    const result = simulateScenario(scenario);
    const seqs = result.events.map((e) => e.sequence);
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it('rejects duplicate initial sequences', () => {
    const events: QueueEvent[] = [
      {
        type: 'RequestSent',
        timestamp: 0,
        sequence: 1,
        pathId: 'p1',
        operationId: 1,
        idempotencyKey: 'k',
        attempt: 0,
        deliveryIndex: 0,
      },
      {
        type: 'RequestSent',
        timestamp: 0,
        sequence: 1, // duplicate!
        pathId: 'p2',
        operationId: 2,
        idempotencyKey: 'k2',
        attempt: 0,
        deliveryIndex: 0,
      },
    ];
    expect(() => simulate({ initialEvents: events })).toThrow(/Duplicate initial event sequence/);
  });

  it('rejects negative initial sequence', () => {
    const events: QueueEvent[] = [
      {
        type: 'RequestSent',
        timestamp: 0,
        sequence: -1,
        pathId: 'p1',
        operationId: 1,
        idempotencyKey: 'k',
        attempt: 0,
        deliveryIndex: 0,
      },
    ];
    expect(() => simulate({ initialEvents: events })).toThrow(/non-negative safe integer/);
  });

  it('evidence links resolve to exactly one event', () => {
    const scenario = createPaymentDoubleChargeScenario();
    const result = simulateScenario(scenario);
    const invResults = evaluateInvariants(result.events, scenario.invariants);

    for (const inv of invResults) {
      for (const ev of inv.evidence) {
        const matching = result.events.filter((e) => e.sequence === ev.sequence);
        expect(matching.length).toBe(1);
      }
    }
  });

  it('same scenario and seed produce identical sequence values', () => {
    const r1 = simulateScenario(createPaymentDoubleChargeScenario());
    const r2 = simulateScenario(createPaymentDoubleChargeScenario());
    expect(r1.events.map((e) => e.sequence)).toEqual(r2.events.map((e) => e.sequence));
  });
});

describe('Property: unique sequences', () => {
  it('all public event sequences are unique for any scenario', () => {
    fc.assert(
      fc.property(fc.nat({ max: 4294967295 }), (seed) => {
        const scenario: Scenario = {
          schemaVersion: 1,
          seed,
          maxSimulationTimeMs: 10000,
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
              sideEffect: 'eff',
              failures: [
                { type: 'lostResponse', probability: 0.3 },
                { type: 'duplicateRequest', count: 2, probability: 0.5 },
              ],
              resilience: {
                idempotencyEnabled: false,
                retry: { maxRetries: 2, baseDelay: 50, jitterFactor: 0 },
              },
            },
          ],
          invariants: [],
        };
        const result = simulateScenario(scenario);
        const seqs = result.events.map((e) => e.sequence);
        expect(new Set(seqs).size).toBe(seqs.length);
      }),
      { numRuns: 100 },
    );
  });
});
