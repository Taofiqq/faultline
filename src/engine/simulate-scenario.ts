/**
 * simulateScenario — connects a validated Scenario to the event loop + pipeline.
 *
 * Creates initial RequestSent events for each path, then runs the
 * discrete-event simulation using the failure pipeline.
 */

import { simulate } from './event-loop';
import { createPRNG } from './prng';
import { createPipelineState, processPipelineEvent } from './failure-pipeline';
import type { QueueEvent } from './failure-pipeline';
import type { SimulationResult } from './types';
import type { Scenario } from '../scenario/types';

export function simulateScenario(scenario: Scenario): SimulationResult {
  const prng = createPRNG(scenario.seed);
  const state = createPipelineState(scenario);

  // Create initial RequestSent events — one per path
  const initialEvents: QueueEvent[] = scenario.paths.map((path, index) => {
    const operationId = state.nextOperationId++;
    return {
      type: 'RequestSent' as const,
      timestamp: 0,
      sequence: index + 1, // deterministic initial sequences
      pathId: path.id,
      operationId,
      idempotencyKey: `op-${operationId}`,
      attempt: 0,
      deliveryIndex: 0,
    };
  });

  return simulate({
    maxSimulationTimeMs: scenario.maxSimulationTimeMs,
    initialEvents,
    processEvent: (event, nextSequence) => {
      return processPipelineEvent(event, state, prng, nextSequence);
    },
  });
}
