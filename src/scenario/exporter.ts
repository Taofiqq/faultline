import type { Scenario, Path, FailureInjection, Invariant } from './types';

/**
 * Export a validated Scenario to a deterministic JSON string.
 *
 * Guarantees:
 * - Stable object-key ordering (schema-defined order).
 * - Human-readable (2-space indent).
 * - Byte-identical on repeated exports of the same Scenario.
 * - No mutation of the supplied Scenario.
 * - No runtime state, event logs, or internal data.
 */
export function exportScenario(scenario: Scenario): string {
  const ordered = orderScenario(scenario);
  return JSON.stringify(ordered, null, 2);
}

function orderScenario(s: Scenario): object {
  return {
    schemaVersion: s.schemaVersion,
    seed: s.seed,
    maxSimulationTimeMs: s.maxSimulationTimeMs,
    services: s.services.map((svc) => ({ id: svc.id, name: svc.name })),
    paths: s.paths.map(orderPath),
    invariants: s.invariants.map(orderInvariant),
  };
}

function orderPath(p: Path): object {
  const base: Record<string, unknown> = {
    id: p.id,
    source: p.source,
    destination: p.destination,
    label: p.label,
    deadlineMs: p.deadlineMs,
    operationName: p.operationName,
  };
  if (p.sideEffect !== undefined) {
    base.sideEffect = p.sideEffect;
  }
  base.failures = p.failures.map(orderFailure);
  base.resilience = orderResilience(p);
  return base;
}

function orderFailure(f: FailureInjection): object {
  switch (f.type) {
    case 'fixedLatency':
      return { type: f.type, ms: f.ms, probability: f.probability };
    case 'randomLatency':
      return { type: f.type, minMs: f.minMs, maxMs: f.maxMs, probability: f.probability };
    case 'lostResponse':
      return { type: f.type, probability: f.probability };
    case 'serviceError':
      return { type: f.type, probability: f.probability };
    case 'duplicateRequest':
      return { type: f.type, count: f.count, probability: f.probability };
  }
}

function orderResilience(p: Path): object {
  const r: Record<string, unknown> = {
    idempotencyEnabled: p.resilience.idempotencyEnabled,
  };
  if (p.resilience.retry) {
    r.retry = {
      maxRetries: p.resilience.retry.maxRetries,
      baseDelay: p.resilience.retry.baseDelay,
      jitterFactor: p.resilience.retry.jitterFactor,
    };
  }
  if (p.resilience.circuitBreaker) {
    r.circuitBreaker = {
      failureThreshold: p.resilience.circuitBreaker.failureThreshold,
      cooldownMs: p.resilience.circuitBreaker.cooldownMs,
    };
  }
  return r;
}

function orderInvariant(inv: Invariant): object {
  switch (inv.type) {
    case 'maxSideEffectCount':
      return { type: inv.type, id: inv.id, effectName: inv.effectName, maxCount: inv.maxCount };
    case 'maxRequestCount':
      return { type: inv.type, id: inv.id, pathId: inv.pathId, maxCount: inv.maxCount };
    case 'requiredSuccessCount':
      return { type: inv.type, id: inv.id, pathId: inv.pathId, minCount: inv.minCount };
    case 'maxCompletionTime':
      return { type: inv.type, id: inv.id, maxMs: inv.maxMs };
    case 'noPendingRequests':
      return { type: inv.type, id: inv.id };
  }
}
