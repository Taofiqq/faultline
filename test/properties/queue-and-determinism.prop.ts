import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { EventQueue, simulate } from '../../src/engine/event-loop';
import { createPRNG } from '../../src/engine/prng';
import type { SimEvent } from '../../src/engine/types';
import type { QueueEvent } from '../../src/engine/failure-pipeline';

function makeEvent(timestamp: number, sequence: number): QueueEvent {
  return {
    type: 'RequestSent',
    timestamp,
    sequence,
    pathId: 'p1',
    operationId: 1,
    idempotencyKey: 'key-1',
    attempt: 0,
    deliveryIndex: 0,
  };
}

describe('Property: EventQueue ordering', () => {
  it('events are always dequeued in (timestamp, sequence) order', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            timestamp: fc.nat({ max: 100000 }),
            sequence: fc.nat({ max: 1000000 }),
          }),
          { minLength: 1, maxLength: 200 },
        ),
        (entries) => {
          const q = new EventQueue();
          for (const { timestamp, sequence } of entries) {
            q.push(makeEvent(timestamp, sequence));
          }

          let prev: SimEvent | undefined;
          while (!q.isEmpty()) {
            const current = q.pop()!;
            if (prev) {
              if (current.timestamp === prev.timestamp) {
                expect(current.sequence).toBeGreaterThanOrEqual(prev.sequence);
              } else {
                expect(current.timestamp).toBeGreaterThan(prev.timestamp);
              }
            }
            prev = current;
          }
        },
      ),
      { numRuns: 500 },
    );
  });

  it('queue size equals insertions minus removals', () => {
    fc.assert(
      fc.property(
        fc.array(fc.nat({ max: 1000 }), { minLength: 0, maxLength: 100 }),
        (timestamps) => {
          const q = new EventQueue();
          for (let i = 0; i < timestamps.length; i++) {
            q.push(makeEvent(timestamps[i]!, i));
          }
          expect(q.size).toBe(timestamps.length);

          let removed = 0;
          while (!q.isEmpty()) {
            q.pop();
            removed++;
          }
          expect(removed).toBe(timestamps.length);
          expect(q.size).toBe(0);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('Property: PRNG determinism', () => {
  it('same seed always produces identical output sequence', () => {
    fc.assert(
      fc.property(fc.nat({ max: 4294967295 }), (seed) => {
        const prng1 = createPRNG(seed);
        const prng2 = createPRNG(seed);

        for (let i = 0; i < 100; i++) {
          expect(prng1.nextU32()).toBe(prng2.nextU32());
        }
      }),
      { numRuns: 200 },
    );
  });

  it('nextFloat is always in [0, 1)', () => {
    fc.assert(
      fc.property(fc.nat({ max: 4294967295 }), (seed) => {
        const prng = createPRNG(seed);
        for (let i = 0; i < 50; i++) {
          const f = prng.nextFloat();
          expect(f).toBeGreaterThanOrEqual(0);
          expect(f).toBeLessThan(1);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('nextRange always returns values within bounds', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 4294967295 }),
        fc.nat({ max: 1000 }),
        fc.nat({ max: 1000 }),
        (seed, a, b) => {
          const min = Math.min(a, b);
          const max = Math.max(a, b);
          const prng = createPRNG(seed);
          for (let i = 0; i < 20; i++) {
            const r = prng.nextRange(min, max);
            expect(r).toBeGreaterThanOrEqual(min);
            expect(r).toBeLessThanOrEqual(max);
            expect(Number.isInteger(r)).toBe(true);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('Property: simulate determinism', () => {
  it('identical inputs produce identical event logs', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 4294967295 }),
        fc.array(fc.nat({ max: 50000 }), { minLength: 1, maxLength: 50 }),
        (seed, timestamps) => {
          // Use seed to create deterministic initial events
          const prng = createPRNG(seed);
          const events: QueueEvent[] = timestamps.map((ts, i) => makeEvent(ts, i + 1));

          const result1 = simulate({ initialEvents: [...events] });
          const result2 = simulate({ initialEvents: [...events] });

          expect(result1.events).toEqual(result2.events);
          expect(result1.totalEvents).toBe(result2.totalEvents);
          expect(result1.finalTimestamp).toBe(result2.finalTimestamp);
          expect(result1.stopped).toBe(result2.stopped);

          // Verify event ordering invariant
          for (let i = 1; i < result1.events.length; i++) {
            const prev = result1.events[i - 1]!;
            const curr = result1.events[i]!;
            expect(curr.timestamp).toBeGreaterThanOrEqual(prev.timestamp);
            if (curr.timestamp === prev.timestamp) {
              expect(curr.sequence).toBeGreaterThan(prev.sequence);
            }
          }

          // Suppress unused variable warning
          void prng;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('simulation always terminates (event count ≤ 100,000)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.nat({ max: 59000 }), { minLength: 1, maxLength: 100 }),
        (timestamps) => {
          const events: QueueEvent[] = timestamps.map((ts, i) => makeEvent(ts, i + 1));
          const result = simulate({ initialEvents: events });
          expect(result.totalEvents).toBeLessThanOrEqual(100000);
          expect(result.events.length).toBeLessThanOrEqual(100001); // +1 for possible SimulationStopped
        },
      ),
      { numRuns: 200 },
    );
  });
});
