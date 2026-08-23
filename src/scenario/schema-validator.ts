import Ajv from 'ajv';
import schema from './schema-v1.json';
import type { Scenario, ValidationError } from './types';

const ajv = new Ajv({ allErrors: true, strict: false });
const validateStructure = ajv.compile(schema);

/**
 * Pass 1: Structural validation using JSON Schema (Ajv).
 * Returns an empty array if valid, or a list of ValidationErrors if not.
 */
export function validateStructural(data: unknown): ValidationError[] {
  const valid = validateStructure(data);
  if (valid) return [];

  return (validateStructure.errors ?? []).map((err) => ({
    path: err.instancePath || '/',
    code: `schema.${err.keyword}`,
    message: err.message ?? 'Unknown schema error',
    actual: err.params,
    expected: err.schema,
  }));
}

/**
 * Pass 2: Semantic validation.
 * Assumes structural validation has already passed (data conforms to schema shape).
 */
export function validateSemantic(data: Scenario): ValidationError[] {
  const errors: ValidationError[] = [];
  const serviceIds = new Set<string>();
  const pathIds = new Set<string>();
  const invariantIds = new Set<string>();

  // Check for duplicate service IDs
  for (let i = 0; i < data.services.length; i++) {
    const svc = data.services[i]!;
    if (serviceIds.has(svc.id)) {
      errors.push({
        path: `/services/${i}/id`,
        code: 'semantic.duplicateServiceId',
        message: `Duplicate service ID: "${svc.id}"`,
        actual: svc.id,
      });
    }
    serviceIds.add(svc.id);
  }

  // Check for duplicate path IDs and referential integrity
  for (let i = 0; i < data.paths.length; i++) {
    const p = data.paths[i]!;

    if (pathIds.has(p.id)) {
      errors.push({
        path: `/paths/${i}/id`,
        code: 'semantic.duplicatePathId',
        message: `Duplicate path ID: "${p.id}"`,
        actual: p.id,
      });
    }
    pathIds.add(p.id);

    // Self-loop check
    if (p.source === p.destination) {
      errors.push({
        path: `/paths/${i}`,
        code: 'semantic.selfLoop',
        message: `Path "${p.id}" has the same source and destination: "${p.source}"`,
        actual: { source: p.source, destination: p.destination },
      });
    }

    // Referential integrity: source exists
    if (!serviceIds.has(p.source)) {
      errors.push({
        path: `/paths/${i}/source`,
        code: 'semantic.invalidServiceRef',
        message: `Path "${p.id}" references non-existent source service: "${p.source}"`,
        actual: p.source,
        expected: [...serviceIds],
      });
    }

    // Referential integrity: destination exists
    if (!serviceIds.has(p.destination)) {
      errors.push({
        path: `/paths/${i}/destination`,
        code: 'semantic.invalidServiceRef',
        message: `Path "${p.id}" references non-existent destination service: "${p.destination}"`,
        actual: p.destination,
        expected: [...serviceIds],
      });
    }

    // Random latency: maxMs >= minMs
    for (let j = 0; j < p.failures.length; j++) {
      const f = p.failures[j]!;
      if (f.type === 'randomLatency' && f.maxMs < f.minMs) {
        errors.push({
          path: `/paths/${i}/failures/${j}/maxMs`,
          code: 'semantic.invalidRange',
          message: `Random latency maxMs (${f.maxMs}) must be >= minMs (${f.minMs})`,
          actual: f.maxMs,
          expected: `>= ${f.minMs}`,
        });
      }
    }
  }

  // Check for duplicate invariant IDs and referential integrity
  for (let i = 0; i < data.invariants.length; i++) {
    const inv = data.invariants[i]!;

    if (invariantIds.has(inv.id)) {
      errors.push({
        path: `/invariants/${i}/id`,
        code: 'semantic.duplicateInvariantId',
        message: `Duplicate invariant ID: "${inv.id}"`,
        actual: inv.id,
      });
    }
    invariantIds.add(inv.id);

    // Path-referencing invariants must reference existing paths
    if ('pathId' in inv) {
      const pathId = (inv as { pathId: string }).pathId;
      if (!pathIds.has(pathId)) {
        errors.push({
          path: `/invariants/${i}/pathId`,
          code: 'semantic.invalidPathRef',
          message: `Invariant "${inv.id}" references non-existent path: "${pathId}"`,
          actual: pathId,
          expected: [...pathIds],
        });
      }
    }
  }

  return errors;
}
