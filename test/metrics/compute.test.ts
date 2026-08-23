import { describe, it, expect } from 'vitest';
import { computeMetrics } from '../../src/metrics/compute';
import { simulateScenario } from '../../src/engine/simulate-scenario';
import {
  createPaymentDoubleChargeScenario,
  createPaymentIdempotentScenario,
  createSuccessScenario,
} from '../../src/scenario/demo-loader';
import type { EventLog, SimEvent } from '../../src/engine/types';

function makeEvent(partial: Partial<SimEvent> & { type: SimEvent['type'] }): SimEvent {
  return { timestamp: 0, sequence: 0, ...partial } as SimEvent;
}

describe('computeMetrics', () => {
  it('returns all zeros for empty log', () => {
    const m = computeMetrics([]);
    expect(m.totalRequests).toBe(0);
    expect(m.totalEvents).toBe(0);
    expect(m.p50Latency).toBeNull();
    expect(m.p95Latency).toBeNull();
    expect(m.p99Latency).toBeNull();
    expect(m.simulatedDuration).toBe(0);
  });

  it('counts requests, deliveries, and side effects', () => {
    const log: EventLog = [
      makeEvent({
        type: 'RequestSent',
        sequence: 1,
        pathId: 'p1',
        operationId: 1,
        idempotencyKey: 'k',
        attempt: 0,
        deliveryIndex: 0,
      }),
      makeEvent({
        type: 'RequestArrived',
        sequence: 2,
        pathId: 'p1',
        operationId: 1,
        idempotencyKey: 'k',
        attempt: 0,
        deliveryIndex: 0,
        deduplicated: false,
      }),
      makeEvent({
        type: 'SideEffect',
        sequence: 3,
        serviceId: 's',
        effectName: 'charge',
        operationId: 1,
        attempt: 0,
        deliveryIndex: 0,
      }),
    ];
    const m = computeMetrics(log);
    expect(m.totalRequests).toBe(1);
    expect(m.totalDeliveries).toBe(1);
    expect(m.sideEffectCounts).toEqual({ charge: 1 });
  });

  it('counts duplicate deliveries and deduplications', () => {
    const log: EventLog = [
      makeEvent({
        type: 'RequestArrived',
        sequence: 1,
        pathId: 'p1',
        operationId: 1,
        idempotencyKey: 'k',
        attempt: 0,
        deliveryIndex: 0,
        deduplicated: false,
      }),
      makeEvent({
        type: 'RequestArrived',
        sequence: 2,
        pathId: 'p1',
        operationId: 1,
        idempotencyKey: 'k',
        attempt: 0,
        deliveryIndex: 1,
        deduplicated: true,
      }),
      makeEvent({
        type: 'RequestArrived',
        sequence: 3,
        pathId: 'p1',
        operationId: 1,
        idempotencyKey: 'k',
        attempt: 0,
        deliveryIndex: 2,
        deduplicated: true,
      }),
    ];
    const m = computeMetrics(log);
    expect(m.totalDeliveries).toBe(3);
    expect(m.duplicateDeliveries).toBe(2);
    expect(m.deduplications).toBe(2);
  });

  it('computes latency percentiles from non-late responses', () => {
    const log: EventLog = Array.from({ length: 100 }, (_, i) =>
      makeEvent({
        type: 'ResponseReceived',
        sequence: i + 1,
        timestamp: i + 1,
        pathId: 'p1',
        operationId: 1,
        attempt: 0,
        deliveryIndex: 0,
        success: true,
        deduplicated: false,
        late: false,
        latency: i + 1, // 1..100
      }),
    );
    const m = computeMetrics(log);
    expect(m.p50Latency).toBe(50);
    expect(m.p95Latency).toBe(95);
    expect(m.p99Latency).toBe(99);
  });

  it('excludes late responses from latency percentiles', () => {
    const log: EventLog = [
      makeEvent({
        type: 'ResponseReceived',
        sequence: 1,
        pathId: 'p1',
        operationId: 1,
        attempt: 0,
        deliveryIndex: 0,
        success: true,
        deduplicated: false,
        late: false,
        latency: 50,
      }),
      makeEvent({
        type: 'ResponseReceived',
        sequence: 2,
        pathId: 'p1',
        operationId: 1,
        attempt: 0,
        deliveryIndex: 1,
        success: true,
        deduplicated: false,
        late: true,
        latency: 9999,
      }),
    ];
    const m = computeMetrics(log);
    expect(m.p50Latency).toBe(50); // late response excluded
  });

  it('percentile ordering: p50 ≤ p95 ≤ p99', () => {
    const log: EventLog = Array.from({ length: 50 }, (_, i) =>
      makeEvent({
        type: 'ResponseReceived',
        sequence: i + 1,
        timestamp: i,
        pathId: 'p1',
        operationId: 1,
        attempt: 0,
        deliveryIndex: 0,
        success: true,
        deduplicated: false,
        late: false,
        latency: (i + 1) * 10,
      }),
    );
    const m = computeMetrics(log);
    expect(m.p50Latency).not.toBeNull();
    expect(m.p95Latency).not.toBeNull();
    expect(m.p99Latency).not.toBeNull();
    expect(m.p50Latency!).toBeLessThanOrEqual(m.p95Latency!);
    expect(m.p95Latency!).toBeLessThanOrEqual(m.p99Latency!);
  });

  it('single latency sample: all percentiles equal that value', () => {
    const log: EventLog = [
      makeEvent({
        type: 'ResponseReceived',
        sequence: 1,
        pathId: 'p1',
        operationId: 1,
        attempt: 0,
        deliveryIndex: 0,
        success: true,
        deduplicated: false,
        late: false,
        latency: 42,
      }),
    ];
    const m = computeMetrics(log);
    expect(m.p50Latency).toBe(42);
    expect(m.p95Latency).toBe(42);
    expect(m.p99Latency).toBe(42);
  });

  it('counts failures by type', () => {
    const log: EventLog = [
      makeEvent({ type: 'TimeoutError', sequence: 1, pathId: 'p1', operationId: 1, attempt: 0 }),
      makeEvent({ type: 'TimeoutError', sequence: 2, pathId: 'p1', operationId: 1, attempt: 1 }),
      makeEvent({
        type: 'CircuitOpenError',
        sequence: 3,
        pathId: 'p1',
        operationId: 2,
        attempt: 0,
        deliveryIndex: 0,
      }),
      makeEvent({
        type: 'ResponseLost',
        sequence: 4,
        pathId: 'p1',
        operationId: 1,
        attempt: 0,
        deliveryIndex: 0,
      }),
    ];
    const m = computeMetrics(log);
    expect(m.failuresByType.timeout).toBe(2);
    expect(m.failuresByType.circuitOpen).toBe(1);
    expect(m.failuresByType.responseLost).toBe(1);
  });

  it('does not double-count multiple delivery responses as caller successes', () => {
    const log: EventLog = [
      makeEvent({
        type: 'ResponseReceived',
        sequence: 1,
        pathId: 'p1',
        operationId: 1,
        attempt: 0,
        deliveryIndex: 0,
        success: true,
        deduplicated: false,
        late: false,
        latency: 50,
      }),
      makeEvent({
        type: 'ResponseReceived',
        sequence: 2,
        pathId: 'p1',
        operationId: 1,
        attempt: 0,
        deliveryIndex: 1,
        success: true,
        deduplicated: false,
        late: true,
        latency: 50,
      }),
      makeEvent({
        type: 'ResponseReceived',
        sequence: 3,
        pathId: 'p1',
        operationId: 1,
        attempt: 0,
        deliveryIndex: 2,
        success: true,
        deduplicated: false,
        late: true,
        latency: 50,
      }),
    ];
    const m = computeMetrics(log);
    // Only deliveryIndex=0, late=false counts
    expect(m.successfulCallerOutcomes).toBe(1);
  });
});

// ─── Payment demo metrics ────────────────────────────────────────────────────

describe('Payment demo metrics', () => {
  it('double-charge scenario metrics', () => {
    const result = simulateScenario(createPaymentDoubleChargeScenario());
    const m = computeMetrics(result.events);
    expect(m.sideEffectCounts['charge']).toBe(2);
    expect(m.failuresByType.responseLost).toBe(1);
    expect(m.failuresByType.timeout).toBe(1);
    expect(m.retries).toBe(1);
    expect(m.successfulCallerOutcomes).toBe(1);
  });

  it('idempotent scenario metrics', () => {
    const result = simulateScenario(createPaymentIdempotentScenario());
    const m = computeMetrics(result.events);
    expect(m.sideEffectCounts['charge']).toBe(1);
    expect(m.deduplications).toBe(1);
    expect(m.successfulCallerOutcomes).toBe(1);
  });

  it('success scenario metrics', () => {
    const result = simulateScenario(createSuccessScenario());
    const m = computeMetrics(result.events);
    expect(m.totalRequests).toBe(1);
    expect(m.successfulCallerOutcomes).toBe(1);
    expect(m.p50Latency).toBe(0); // no latency configured
  });
});
