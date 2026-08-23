import type { InvariantResult } from '../invariants/evaluator';

interface InvariantResultsPanelProps {
  results: InvariantResult[];
  onSelectEvidence: (sequence: number | null) => void;
}

export function InvariantResultsPanel({ results, onSelectEvidence }: InvariantResultsPanelProps) {
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  return (
    <div className="invariant-results" aria-label="Invariant results">
      <div className="invariant-results__summary">
        <span className="invariant-results__passed">✓ {passed} passed</span>
        {failed > 0 && <span className="invariant-results__failed">✗ {failed} failed</span>}
      </div>

      {results.map((r) => (
        <div
          key={r.invariantId}
          className={`invariant-result ${r.passed ? 'invariant-result--pass' : 'invariant-result--fail'}`}
        >
          <div className="invariant-result__header">
            <span className="invariant-result__status">{r.passed ? '✓' : '✗'}</span>
            <span className="invariant-result__type">{r.type}</span>
            <span className="invariant-result__id">{r.invariantId}</span>
          </div>
          <p className="invariant-result__message">{r.message}</p>
          <div className="invariant-result__values">
            <span>Actual: {r.actual}</span>
            <span>Threshold: {r.threshold}</span>
          </div>
          {r.evidence.length > 0 && (
            <div className="invariant-result__evidence">
              <span className="label-text">Evidence ({r.evidence.length}):</span>
              <ul className="evidence-list">
                {r.evidence.map((ev) => (
                  <li key={ev.sequence}>
                    <button
                      className="evidence-link"
                      onClick={() => onSelectEvidence(ev.sequence)}
                      aria-label={`Go to event ${ev.sequence} at t=${ev.timestamp}ms`}
                    >
                      seq={ev.sequence} t={ev.timestamp}ms
                    </button>
                    <span className="evidence-desc">{ev.description}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
