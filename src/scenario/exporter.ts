import type { Scenario } from './types';

/**
 * Export a validated Scenario to a JSON string.
 * Produces deterministic output (keys in schema order, 2-space indent).
 */
export function exportScenario(scenario: Scenario): string {
  return JSON.stringify(scenario, null, 2);
}
