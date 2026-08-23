/**
 * Metrics Module — derives all metrics solely from the normalized EventLog.
 *
 * Percentile algorithm: Nearest-rank method (deterministic).
 * - Sort eligible latencies ascending.
 * - p-th percentile = value at index ceil(p/100 * N) - 1.
 * - Empty sets return null.
 * - Guarantees p50 ≤ p95 ≤ p99 when values exist.
 */

import type { EventLog } from '../engine/types';

export interface SimulationMetrics {
  totalRequests: number; // RequestSent count
  totalAttempts: number; // unique (operationId, attempt) pairs in RequestSent
  totalDeliveries: number; // RequestArrived count
  retries: number; // RetryScheduled count
  failuresByType: {
    timeout: number;
    serviceError: number;
    circuitOpen: number;
    responseLost: number;
  };
  duplicateDeliveries: number; // RequestArrived with deliveryIndex > 0
  deduplications: number; // RequestArrived with deduplicated=true
  sideEffectCounts: Record<string, number>;
  successfulCallerOutcomes: number; // ResponseReceived: success=true, late=false, deliveryIndex=0
  circuitTransitions: number; // CircuitStateChange count
  p50Latency: number | null;
  p95Latency: number | null;
  p99Latency: number | null;
  totalEvents: number;
  simulatedDuration: number; // final event timestamp
}

/**
 * Compute the nearest-rank percentile from a sorted array.
 * Returns null for empty arrays.
 */
function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)]!;
}

export function computeMetrics(log: EventLog): SimulationMetrics {
  let totalRequests = 0;
  let retries = 0;
  let timeouts = 0;
  let serviceErrors = 0;
  let circuitOpen = 0;
  let responseLost = 0;
  let duplicateDeliveries = 0;
  let deduplications = 0;
  let successfulCallerOutcomes = 0;
  let circuitTransitions = 0;
  let totalDeliveries = 0;
  const sideEffectCounts: Record<string, number> = {};
  const latencies: number[] = [];
  const attemptKeys = new Set<string>();

  let lastTimestamp = 0;

  for (const e of log) {
    lastTimestamp = Math.max(lastTimestamp, e.timestamp);

    switch (e.type) {
      case 'RequestSent':
        totalRequests++;
        attemptKeys.add(`${e.operationId}:${e.attempt}`);
        break;
      case 'RequestArrived':
        totalDeliveries++;
        if (e.deliveryIndex > 0) duplicateDeliveries++;
        if (e.deduplicated) deduplications++;
        break;
      case 'SideEffect':
        sideEffectCounts[e.effectName] = (sideEffectCounts[e.effectName] ?? 0) + 1;
        break;
      case 'ResponseReceived':
        // Eligible latency: not late
        if (!e.late) {
          latencies.push(e.latency);
        }
        // Successful caller outcome: success, not late, deliveryIndex=0
        if (e.success && !e.late && e.deliveryIndex === 0) {
          successfulCallerOutcomes++;
        }
        // Count service errors
        if (!e.success && !e.late) {
          serviceErrors++;
        }
        break;
      case 'ResponseLost':
        responseLost++;
        break;
      case 'TimeoutError':
        timeouts++;
        break;
      case 'CircuitOpenError':
        circuitOpen++;
        break;
      case 'CircuitStateChange':
        circuitTransitions++;
        break;
      case 'RetryScheduled':
        retries++;
        break;
    }
  }

  // Sort latencies for percentile computation
  latencies.sort((a, b) => a - b);

  return {
    totalRequests,
    totalAttempts: attemptKeys.size,
    totalDeliveries,
    retries,
    failuresByType: {
      timeout: timeouts,
      serviceError: serviceErrors,
      circuitOpen,
      responseLost,
    },
    duplicateDeliveries,
    deduplications,
    sideEffectCounts,
    successfulCallerOutcomes,
    circuitTransitions,
    p50Latency: percentile(latencies, 50),
    p95Latency: percentile(latencies, 95),
    p99Latency: percentile(latencies, 99),
    totalEvents: log.length,
    simulatedDuration: lastTimestamp,
  };
}
