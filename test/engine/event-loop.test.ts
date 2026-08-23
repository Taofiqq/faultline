import { describe, it, expect } from 'vitest';
import { EventQueue, simulate } from '../../src/engine/event-loop';
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

describe('EventQueue', () => {
  it('dequeues events in timestamp order', () => {
    const q = new EventQueue();
    q.push(makeEvent(30, 1));
    q.push(makeEvent(10, 2));
    q.push(makeEvent(20, 3));

    expect(q.pop()!.timestamp).toBe(10);
    expect(q.pop()!.timestamp).toBe(20);
    expect(q.pop()!.timestamp).toBe(30);
  });

  it('dequeues events at same timestamp by sequence (FIFO)', () => {
    const q = new EventQueue();
    q.push(makeEvent(100, 3));
    q.push(makeEvent(100, 1));
    q.push(makeEvent(100, 2));

    expect(q.pop()!.sequence).toBe(1);
    expect(q.pop()!.sequence).toBe(2);
    expect(q.pop()!.sequence).toBe(3);
  });

  it('mixed timestamps and sequences sort correctly', () => {
    const q = new EventQueue();
    q.push(makeEvent(5, 10));
    q.push(makeEvent(5, 5));
    q.push(makeEvent(3, 20));
    q.push(makeEvent(3, 15));
    q.push(makeEvent(10, 1));

    const results = [];
    while (!q.isEmpty()) results.push(q.pop()!);

    expect(results.map((e) => [e.timestamp, e.sequence])).toEqual([
      [3, 15],
      [3, 20],
      [5, 5],
      [5, 10],
      [10, 1],
    ]);
  });

  it('returns undefined when empty', () => {
    const q = new EventQueue();
    expect(q.pop()).toBeUndefined();
    expect(q.peek()).toBeUndefined();
  });

  it('size reflects current count', () => {
    const q = new EventQueue();
    expect(q.size).toBe(0);
    q.push(makeEvent(1, 1));
    expect(q.size).toBe(1);
    q.push(makeEvent(2, 2));
    expect(q.size).toBe(2);
    q.pop();
    expect(q.size).toBe(1);
  });
});

describe('simulate()', () => {
  it('returns empty result for no initial events', () => {
    const result = simulate();
    expect(result.events).toEqual([]);
    expect(result.totalEvents).toBe(0);
    expect(result.stopped).toBe(false);
  });

  it('processes all events in order', () => {
    const events: QueueEvent[] = [makeEvent(50, 2), makeEvent(10, 1), makeEvent(30, 3)];
    const result = simulate({ initialEvents: events });

    expect(result.events.map((e) => e.timestamp)).toEqual([10, 30, 50]);
    expect(result.totalEvents).toBe(3);
    expect(result.finalTimestamp).toBe(50);
  });

  it('stops at time limit and emits SimulationStopped', () => {
    const events: QueueEvent[] = [
      makeEvent(100, 1),
      makeEvent(200, 2),
      makeEvent(70000, 3), // exceeds default 60000
    ];
    const result = simulate({ initialEvents: events });

    expect(result.stopped).toBe(true);
    expect(result.stopReason).toBe('time-limit');
    // Should have processed events at 100, 200 and then stopped before 70000
    expect(result.totalEvents).toBe(2);
    const lastEvent = result.events[result.events.length - 1]!;
    expect(lastEvent.type).toBe('SimulationStopped');
    expect(lastEvent.type === 'SimulationStopped' && lastEvent.reason).toBe('time-limit');
  });

  it('stops at event limit', () => {
    // Create events that stay within time limit but exceed 100K count
    let counter = 0;
    const result = simulate({
      initialEvents: [makeEvent(0, 1)],
      maxSimulationTimeMs: 999999999, // high time limit so event limit fires first
      processEvent: (_event, nextSeq) => {
        counter++;
        if (counter > 100001) return { enqueue: [], log: true };
        return {
          enqueue: [
            {
              type: 'RequestSent' as const,
              timestamp: 0,
              sequence: nextSeq(),
              pathId: 'p1',
              operationId: counter,
              idempotencyKey: `key-${counter}`,
              attempt: 0,
              deliveryIndex: 0,
            },
          ],
          log: true,
        };
      },
    });

    expect(result.stopped).toBe(true);
    expect(result.stopReason).toBe('event-limit');
    const lastEvent = result.events[result.events.length - 1]!;
    expect(lastEvent.type).toBe('SimulationStopped');
  });

  it('custom maxSimulationTimeMs is respected', () => {
    const events: QueueEvent[] = [
      makeEvent(50, 1),
      makeEvent(150, 2), // exceeds 100ms limit
    ];
    const result = simulate({ initialEvents: events, maxSimulationTimeMs: 100 });

    expect(result.stopped).toBe(true);
    expect(result.stopReason).toBe('time-limit');
    expect(result.totalEvents).toBe(1);
  });

  it('events at same timestamp are processed in sequence order (FIFO)', () => {
    const events: QueueEvent[] = [
      makeEvent(10, 5),
      makeEvent(10, 3),
      makeEvent(10, 7),
      makeEvent(10, 1),
    ];
    const result = simulate({ initialEvents: events });

    // All at same timestamp — should be ordered by sequence
    const sequences = result.events.map((e) => e.sequence);
    expect(sequences).toEqual([1, 3, 5, 7]);
  });

  it('timestamps are non-decreasing in output', () => {
    const events: QueueEvent[] = [
      makeEvent(100, 1),
      makeEvent(50, 2),
      makeEvent(200, 3),
      makeEvent(50, 4),
    ];
    const result = simulate({ initialEvents: events });

    const timestamps = result.events.map((e) => e.timestamp);
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]!).toBeGreaterThanOrEqual(timestamps[i - 1]!);
    }
  });

  it('processEvent can enqueue new events', () => {
    const initial: QueueEvent[] = [makeEvent(10, 1)];
    const result = simulate({
      initialEvents: initial,
      processEvent: (event, nextSeq) => {
        if (event.timestamp === 10) {
          return {
            enqueue: [
              {
                type: 'ResponseReceived' as const,
                timestamp: 20,
                sequence: nextSeq(),
                pathId: 'p1',
                operationId: 1,
                success: true,
                deduplicated: false,
                late: false,
                latency: 10,
              },
            ],
            log: true,
          };
        }
        return { enqueue: [], log: true };
      },
    });

    expect(result.events).toHaveLength(2);
    expect(result.events[1]!.type).toBe('ResponseReceived');
    expect(result.events[1]!.timestamp).toBe(20);
  });
});
