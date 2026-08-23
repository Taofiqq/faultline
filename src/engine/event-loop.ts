import type { SimEvent, EventLog, SimulationResult } from './types';
import type { QueueEvent, ProcessResult } from './failure-pipeline';

// ─── Priority Queue (Min-Heap) ───────────────────────────────────────────────
// Ordered by (timestamp ASC, sequence ASC) — guarantees FIFO at same timestamp.

export class EventQueue {
  private heap: QueueEvent[] = [];

  get size(): number {
    return this.heap.length;
  }

  isEmpty(): boolean {
    return this.heap.length === 0;
  }

  peek(): QueueEvent | undefined {
    return this.heap[0];
  }

  push(event: QueueEvent): void {
    this.heap.push(event);
    this.bubbleUp(this.heap.length - 1);
  }

  pop(): QueueEvent | undefined {
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

  private compare(a: QueueEvent, b: QueueEvent): number {
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
  initialEvents?: QueueEvent[];
  /**
   * Event processor: given an event and a sequence allocator, returns
   * a ProcessResult with events to enqueue, logging control, etc.
   */
  processEvent?: (event: QueueEvent, nextSequence: () => number) => ProcessResult;
}

/**
 * Run the discrete-event simulation loop.
 *
 * - Events are dequeued in (timestamp, sequence) order.
 * - Terminates when: queue empty, time limit, or event limit.
 * - Emits SimulationStopped if a limit is hit.
 * - Internal events (type starts with '_') are never logged.
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

    // Process event
    if (options.processEvent) {
      const result = options.processEvent(event, nextSequence);

      // Log control
      if (result.log) {
        if (result.logAs) {
          log.push(result.logAs);
        } else if (!event.type.startsWith('_')) {
          log.push(event as SimEvent);
        }
      }

      // Enqueue produced events
      for (const e of result.enqueue) {
        queue.push(e);
      }
    } else {
      // No processor — log all non-internal events
      if (!event.type.startsWith('_')) {
        log.push(event as SimEvent);
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
