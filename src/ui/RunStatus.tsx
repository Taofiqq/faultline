import type { AppStatus } from './state/useAppState';
import type { SimulationResult } from '../engine/types';
import type { InvariantResult } from '../invariants/evaluator';
import type { SimulationMetrics } from '../metrics/compute';
import type { ValidationError } from '../scenario/types';

interface RunStatusProps {
  status: AppStatus;
  validationErrors: ValidationError[];
  simulationResult: SimulationResult | null;
  invariantResults: InvariantResult[] | null;
  metrics: SimulationMetrics | null;
}

export function RunStatus({
  status,
  validationErrors,
  simulationResult,
  invariantResults,
  metrics,
}: RunStatusProps) {
  if (status === 'empty') {
    return <span className="run-status run-status--dim">Add services and paths to begin.</span>;
  }

  if (status === 'invalid') {
    return (
      <span className="run-status run-status--error">
        ✗ {validationErrors.length} validation error(s) — fix configuration to run.
      </span>
    );
  }

  if (status === 'editing') {
    return <span className="run-status run-status--dim">Ready to run. Press ▶ Run.</span>;
  }

  if (status === 'completed' && simulationResult && invariantResults && metrics) {
    const allPassed = invariantResults.every((r) => r.passed);
    const passCount = invariantResults.filter((r) => r.passed).length;
    const failCount = invariantResults.filter((r) => !r.passed).length;

    return (
      <span className={`run-status ${allPassed ? 'run-status--success' : 'run-status--error'}`}>
        {allPassed ? '✓' : '✗'} {metrics.totalEvents} events | {metrics.simulatedDuration}ms
        simulated
        {invariantResults.length > 0 && (
          <>
            {' '}
            | Invariants: {passCount} passed{failCount > 0 && `, ${failCount} failed`}
          </>
        )}
        {simulationResult.stopped && <> | ⚠ Stopped: {simulationResult.stopReason}</>}
      </span>
    );
  }

  return <span className="run-status run-status--dim">—</span>;
}
