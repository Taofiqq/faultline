import { validateStructural, validateSemantic } from './schema-validator';
import type { Scenario, ValidationResult } from './types';

/**
 * Import a scenario from a JSON string.
 * Performs two-pass atomic validation:
 *   1. Structural (JSON Schema via Ajv)
 *   2. Semantic (referential integrity, ranges, self-loops, duplicates)
 *
 * Returns either a validated Scenario or all collected errors.
 */
export function importScenario(json: string): ValidationResult {
  // Parse JSON
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (e) {
    return {
      valid: false,
      errors: [
        {
          path: '/',
          code: 'parse.invalidJson',
          message: `Invalid JSON: ${e instanceof Error ? e.message : 'Unknown error'}`,
        },
      ],
    };
  }

  // Pass 1: Structural validation
  const structuralErrors = validateStructural(data);
  if (structuralErrors.length > 0) {
    return { valid: false, errors: structuralErrors };
  }

  // At this point data conforms to schema shape — cast is safe
  const scenario = data as Scenario;

  // Apply defaults
  if (scenario.maxSimulationTimeMs === undefined) {
    (scenario as { maxSimulationTimeMs: number }).maxSimulationTimeMs = 60000;
  }

  // Pass 2: Semantic validation
  const semanticErrors = validateSemantic(scenario);
  if (semanticErrors.length > 0) {
    return { valid: false, errors: semanticErrors };
  }

  return { valid: true, scenario };
}
