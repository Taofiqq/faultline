import type { SimulationResult } from '../engine/types';
import type { InvariantResult } from '../invariants/evaluator';
import type { SimulationMetrics } from '../metrics/compute';

interface DemoLauncherProps {
  onLoadDemo: () => void;
  onEnableIdempotency: () => void;
  onResetDemo: () => void;
  baselineResult: DemoSnapshot | null;
  currentResult: DemoSnapshot | null;
  isIdempotencyEnabled: boolean;
  isDemoMode: boolean;
}

export interface DemoSnapshot {
  simulationResult: SimulationResult;
  invariantResults: InvariantResult[];
  metrics: SimulationMetrics;
  idempotencyEnabled: boolean;
}

export function DemoLauncher({
  onLoadDemo,
  onEnableIdempotency,
  onResetDemo,
  baselineResult,
  currentResult,
  isIdempotencyEnabled,
  isDemoMode,
}: DemoLauncherProps) {
  if (!isDemoMode) {
    return (
      <button
        className="btn btn--primary demo-btn"
        onClick={onLoadDemo}
        aria-label="Load payment demo"
      >
        ⚡ Payment Double-Charge Demo
      </button>
    );
  }

  return (
    <div className="demo-launcher" aria-label="Payment demonstration">
      <div className="demo-launcher__header">
        <h3>Payment Double-Charge Demo</h3>
        <span className="label-text">Deterministic · Seed 0</span>
        <button className="btn btn--sm" onClick={onResetDemo}>
          Reset Demo
        </button>
      </div>

      {baselineResult && !isIdempotencyEnabled && (
        <div className="demo-launcher__step">
          <h4 className="panel-subheading">Baseline Result (No Resilience)</h4>
          <DemoOutcomeCard snapshot={baselineResult} label="Baseline" />
          <div className="demo-launcher__causal">
            <p className="demo-causal-step">1. Payment Service processes original request</p>
            <p className="demo-causal-step">2. "charge" side-effect occurs</p>
            <p className="demo-causal-step">3. Successful response is lost</p>
            <p className="demo-causal-step">4. Caller times out and retries</p>
            <p className="demo-causal-step">5. Retry performs a second charge</p>
            <p className="demo-causal-step">6. "charge ≤ 1" invariant fails</p>
          </div>
          <button className="btn btn--primary" onClick={onEnableIdempotency}>
            Enable Idempotency and Replay →
          </button>
        </div>
      )}

      {baselineResult && isIdempotencyEnabled && currentResult && (
        <div className="demo-launcher__step">
          <h4 className="panel-subheading">Comparison: Before → After</h4>
          <DemoComparison baseline={baselineResult} corrected={currentResult} />
        </div>
      )}
    </div>
  );
}

function DemoOutcomeCard({ snapshot, label }: { snapshot: DemoSnapshot; label: string }) {
  const charges = snapshot.metrics.sideEffectCounts['charge'] ?? 0;
  const retries = snapshot.metrics.retries;
  const successes = snapshot.metrics.successfulCallerOutcomes;
  const invPassed = snapshot.invariantResults.every((r) => r.passed);

  return (
    <div className={`demo-outcome ${invPassed ? 'demo-outcome--pass' : 'demo-outcome--fail'}`}>
      <span className="demo-outcome__label">{label}</span>
      <div className="demo-outcome__stats">
        <span>Charges: {charges}</span>
        <span>Retries: {retries}</span>
        <span>Successes: {successes}</span>
        <span>Invariant: {invPassed ? '✓ Passed' : '✗ Failed'}</span>
      </div>
    </div>
  );
}

function DemoComparison({
  baseline,
  corrected,
}: {
  baseline: DemoSnapshot;
  corrected: DemoSnapshot;
}) {
  const bCharges = baseline.metrics.sideEffectCounts['charge'] ?? 0;
  const cCharges = corrected.metrics.sideEffectCounts['charge'] ?? 0;
  const bInv = baseline.invariantResults.every((r) => r.passed);
  const cInv = corrected.invariantResults.every((r) => r.passed);

  return (
    <div className="demo-comparison">
      <p className="demo-comparison__same-seed">
        Same seed (0), same scenario. Only change: idempotency enabled.
      </p>
      <table className="demo-comparison__table">
        <thead>
          <tr>
            <th>Metric</th>
            <th>Before</th>
            <th>After</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Charges</td>
            <td>{bCharges}</td>
            <td>{cCharges}</td>
          </tr>
          <tr>
            <td>Retries</td>
            <td>{baseline.metrics.retries}</td>
            <td>{corrected.metrics.retries}</td>
          </tr>
          <tr>
            <td>Successful Outcomes</td>
            <td>{baseline.metrics.successfulCallerOutcomes}</td>
            <td>{corrected.metrics.successfulCallerOutcomes}</td>
          </tr>
          <tr>
            <td>Invariant</td>
            <td className={bInv ? '' : 'demo-fail'}>{bInv ? 'Passed' : 'Failed'}</td>
            <td className={cInv ? 'demo-pass' : ''}>{cInv ? 'Passed' : 'Failed'}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
