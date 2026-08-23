import type { AppStatus } from './state/useAppState';
import type { SimulationResult } from '../engine/types';
import type { InvariantResult } from '../invariants/evaluator';
import type { SimulationMetrics } from '../metrics/compute';
import type { ValidationError } from '../scenario/types';

interface RunStatusProps {
  status: AppStatus;
  validationErrors: ValidationError[];
  importErrors: ValidationError[];
  runtimeError: string | null;
  simulationResult: SimulationResult | null;
  invariantResults: InvariantResult[] | null;
  metrics: SimulationMetrics | null;
}

export function RunStatus({
  status,
  validationErrors,
  importErrors,
  runtimeError,
  simulationResult,
  invariantResults,
  metrics,
}: RunStatusProps) {
  return (
    <div aria-live="polite" aria-atomic="true">
      {runtimeError && (
        <div className="run-status run-status--error" role="alert">
          ⚠ Runtime error: {runtimeError}. Try adjusting your scenario and re-running.
        </div>
      )}

      {importErrors.length > 0 && (
        <div className="run-status run-status--error" role="alert" aria-label="Import errors">
          ✗ Import failed ({importErrors.length} error{importErrors.length > 1 ? 's' : ''}):
          <ul className="import-error-list">
            {importErrors.slice(0, 3).map((err, i) => (
              <li key={i}>
                <code>{err.path}</code>: {err.message}
              </li>
            ))}
            {importErrors.length > 3 && <li>...and {importErrors.length - 3} more</li>}
          </ul>
        </div>
      )}

      {status === 'empty' && (
        <span className="run-status run-status--dim">Add services and paths to begin.</span>
      )}

      {status === 'invalid' && (
        <span className="run-status run-status--error">
          ✗ {validationErrors.length} validation error(s) — fix configuration to run.
        </span>
      )}

      {status === 'editing' && !runtimeError && (
        <span className="run-status run-status--dim">Ready to run. Press ▶ Run.</span>
      )}

      {status === 'completed' && simulationResult && invariantResults && metrics && (
        <span
          className={`run-status ${invariantResults.every((r) => r.passed) ? 'run-status--success' : 'run-status--error'}`}
        >
          {invariantResults.every((r) => r.passed) ? '✓' : '✗'} {metrics.totalEvents} events |{' '}
          {metrics.simulatedDuration}ms simulated
          {invariantResults.length > 0 && (
            <>
              {' '}
              | Invariants: {invariantResults.filter((r) => r.passed).length} passed
              {invariantResults.some((r) => !r.passed) &&
                `, ${invariantResults.filter((r) => !r.passed).length} failed`}
            </>
          )}
          {simulationResult.stopped && <> | ⚠ Stopped: {simulationResult.stopReason}</>}
        </span>
      )}
    </div>
  );
}
