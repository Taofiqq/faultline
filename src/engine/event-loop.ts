import type { SimEvent, EventLog, SimulationResult } from './types';

// ─── Priority Queue (Min-Heap) ───────────────────────────────────────────────
// Ordered by (timestamp ASC, sequence ASC) — guarantees FIFO at same timestamp.

export class EventQueue {
  private heap: SimEvent[] = [];

  get size(): number {
    return this.heap.length;
  }

  isEmpty(): boolean {
    return this.heap.length === 0;
  }

  peek(): SimEvent | undefined {
    return this.heap[0];
  }

  push(event: SimEvent): void {
    this.heap.push(event);
    this.bubbleUp(this.heap.length - 1);
  }

  pop(): SimEvent | undefined {
    const heap = this.heap;
    if (heap.length === 0) return undefined;
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      this.sinkDown(0);
    }
    return top;
  }

  private bubbleUp(i: number): void {
    const heap = this.heap;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.compare(heap[i]!, heap[parent]!) < 0) {
        [heap[i], heap[parent]] = [heap[parent]!, heap[i]!];
        i = parent;
      } else {
        break;
      }
    }
  }

  private sinkDown(i: number): void {
    const heap = this.heap;
    const n = heap.length;
    while (true) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;

      if (left < n && this.compare(heap[left]!, heap[smallest]!) < 0) {
        smallest = left;
      }
      if (right < n && this.compare(heap[right]!, heap[smallest]!) < 0) {
        smallest = right;
      }
      if (smallest !== i) {
        [heap[i], heap[smallest]] = [heap[smallest]!, heap[i]!];
        i = smallest;
      } else {
        break;
      }
    }
  }

  /**
   * Compare two events by (timestamp, sequence).
   * Returns negative if a should come before b.
   */
  private compare(a: SimEvent, b: SimEvent): number {
    if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
    return a.sequence - b.sequence;
  }
}

// ─── Simulation Entry Point ──────────────────────────────────────────────────

const DEFAULT_MAX_TIME = 60_000;
const MAX_EVENTS = 100_000;

export interface SimulateOptions {
  maxSimulationTimeMs?: number;
  /** Initial events to seed the queue. */
  initialEvents?: SimEvent[];
  /**
   * Event processor: given an event and a sequence allocator, returns
   * new events to enqueue. Not needed for M3 — will be connected in M4.
   */
  processEvent?: (event: SimEvent, nextSequence: () => number) => SimEvent[];
}

/**
 * Run the discrete-event simulation loop.
 *
 * - Events are dequeued in (timestamp, sequence) order.
 * - Terminates when: queue empty, time limit, or event limit.
 * - Emits SimulationStopped if a limit is hit.
 */
export function simulate(options: SimulateOptions = {}): SimulationResult {
  const maxTime = options.maxSimulationTimeMs ?? DEFAULT_MAX_TIME;
  const queue = new EventQueue();
  const log: EventLog = [];
  let sequence = 0;
  let clock = 0;
  let eventCount = 0;
  let stopped = false;
  let stopReason: 'time-limit' | 'event-limit' | undefined;

  const nextSequence = (): number => ++sequence;

  // Seed initial events
  if (options.initialEvents) {
    for (const event of options.initialEvents) {
      queue.push(event);
    }
  }

  while (!queue.isEmpty()) {
    const event = queue.peek()!;

    // Safety limit checks (before processing)
    if (event.timestamp > maxTime) {
      stopped = true;
      stopReason = 'time-limit';
      const stopEvent: SimEvent = {
        type: 'SimulationStopped',
        timestamp: clock,
        sequence: nextSequence(),
        reason: 'time-limit',
      };
      log.push(stopEvent);
      break;
    }

    if (eventCount >= MAX_EVENTS) {
      stopped = true;
      stopReason = 'event-limit';
      const stopEvent: SimEvent = {
        type: 'SimulationStopped',
        timestamp: clock,
        sequence: nextSequence(),
        reason: 'event-limit',
      };
      log.push(stopEvent);
      break;
    }

    queue.pop();
    clock = event.timestamp;
    eventCount++;
    log.push(event);

    // Process event and enqueue results
    if (options.processEvent) {
      const produced = options.processEvent(event, nextSequence);
      for (const e of produced) {
        queue.push(e);
      }
    }
  }

  return {
    events: log,
    finalTimestamp: clock,
    totalEvents: eventCount,
    stopped,
    stopReason,
  };
}
