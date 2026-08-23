import type { PathDraft, FailureInjection, ResilienceConfig } from '../scenario/types';
import type { ValidationError } from '../scenario/types';

interface PathEditorProps {
  path: PathDraft;
  validationErrors: ValidationError[];
  onUpdate: (updates: Partial<PathDraft>) => void;
  onUpdateFailures: (failures: FailureInjection[]) => void;
  onUpdateResilience: (resilience: Partial<ResilienceConfig>) => void;
}

export function PathEditor({
  path,
  validationErrors,
  onUpdate,
  onUpdateFailures,
  onUpdateResilience,
}: PathEditorProps) {
  const pathErrors = validationErrors.filter((e) => e.path.startsWith(`paths.${path.id}`));
  const labelError = pathErrors.find((e) => e.path.includes('label'));
  const deadlineError = pathErrors.find((e) => e.path.includes('deadlineMs'));
  const operationNameError = pathErrors.find((e) => e.path.includes('operationName'));

  return (
    <div className="scenario-panel__section">
      <h3 className="panel-heading">Path: {path.label}</h3>

      {/* Basic settings */}
      <label className="field">
        <span className="label-text">Label</span>
        <input
          className={`input${labelError ? ' input--error' : ''}`}
          value={path.label}
          onChange={(e) => onUpdate({ label: e.target.value })}
          aria-invalid={labelError ? true : undefined}
          aria-describedby={labelError ? `path-label-error-${path.id}` : undefined}
        />
        {labelError && (
          <span id={`path-label-error-${path.id}`} className="field-error" role="alert">
            {labelError.message}
          </span>
        )}
      </label>
      <label className="field">
        <span className="label-text">Deadline (ms)</span>
        <input
          className={`input${deadlineError ? ' input--error' : ''}`}
          type="number"
          min={1}
          value={path.deadlineMs ?? ''}
          onChange={(e) => onUpdate({ deadlineMs: e.target.value ? Number(e.target.value) : null })}
          aria-invalid={deadlineError ? true : undefined}
          aria-describedby={deadlineError ? `path-deadline-error-${path.id}` : undefined}
        />
        {deadlineError && (
          <span id={`path-deadline-error-${path.id}`} className="field-error" role="alert">
            {deadlineError.message}
          </span>
        )}
      </label>
      <label className="field">
        <span className="label-text">Operation Name</span>
        <input
          className={`input${operationNameError ? ' input--error' : ''}`}
          value={path.operationName}
          onChange={(e) => onUpdate({ operationName: e.target.value })}
          aria-invalid={operationNameError ? true : undefined}
          aria-describedby={operationNameError ? `path-opname-error-${path.id}` : undefined}
        />
        {operationNameError && (
          <span id={`path-opname-error-${path.id}`} className="field-error" role="alert">
            {operationNameError.message}
          </span>
        )}
      </label>
      <label className="field">
        <span className="label-text">Side Effect (optional)</span>
        <input
          className="input"
          value={path.sideEffect ?? ''}
          onChange={(e) => onUpdate({ sideEffect: e.target.value || undefined })}
        />
      </label>

      {/* Failure injections */}
      <h4 className="panel-subheading">Failure Injections</h4>
      {path.failures.map((f, i) => (
        <div key={i} className="failure-item">
          <span className="failure-type">{f.type}</span>
          <span className="failure-prob">p={f.probability}</span>
          <button
            className="btn btn--danger btn--sm"
            onClick={() => {
              const updated = [...path.failures];
              updated.splice(i, 1);
              onUpdateFailures(updated);
            }}
          >
            ×
          </button>
        </div>
      ))}
      <div className="failure-add">
        <select
          onChange={(e) => {
            const type = e.target.value;
            if (!type) return;
            let injection: FailureInjection;
            switch (type) {
              case 'fixedLatency':
                injection = { type: 'fixedLatency', ms: 100, probability: 1.0 };
                break;
              case 'randomLatency':
                injection = { type: 'randomLatency', minMs: 50, maxMs: 200, probability: 1.0 };
                break;
              case 'lostResponse':
                injection = { type: 'lostResponse', probability: 0.5 };
                break;
              case 'serviceError':
                injection = { type: 'serviceError', probability: 0.5 };
                break;
              case 'duplicateRequest':
                injection = { type: 'duplicateRequest', count: 2, probability: 1.0 };
                break;
              default:
                return;
            }
            onUpdateFailures([...path.failures, injection]);
            e.target.value = '';
          }}
          aria-label="Add failure injection"
        >
          <option value="">+ Add Failure...</option>
          <option value="fixedLatency">Fixed Latency</option>
          <option value="randomLatency">Random Latency</option>
          <option value="lostResponse">Lost Response</option>
          <option value="serviceError">Service Error</option>
          <option value="duplicateRequest">Duplicate Request</option>
        </select>
      </div>

      {/* Resilience */}
      <h4 className="panel-subheading">Resilience</h4>
      <label className="field field--checkbox">
        <input
          type="checkbox"
          checked={path.resilience.idempotencyEnabled ?? false}
          onChange={(e) => onUpdateResilience({ idempotencyEnabled: e.target.checked })}
        />
        <span>Idempotency</span>
      </label>

      <fieldset className="fieldset">
        <legend className="label-text">Retry</legend>
        <label className="field">
          <span className="label-text">Max Retries (0-50)</span>
          <input
            className="input"
            type="number"
            min={0}
            max={50}
            value={path.resilience.retry?.maxRetries ?? ''}
            onChange={(e) => {
              const val = e.target.value ? Number(e.target.value) : undefined;
              if (val !== undefined) {
                onUpdateResilience({
                  retry: {
                    maxRetries: val,
                    baseDelay: path.resilience.retry?.baseDelay ?? 100,
                    jitterFactor: path.resilience.retry?.jitterFactor ?? 0,
                  },
                });
              } else {
                onUpdateResilience({ retry: undefined });
              }
            }}
          />
        </label>
        {path.resilience.retry && (
          <>
            <label className="field">
              <span className="label-text">Base Delay (ms)</span>
              <input
                className="input"
                type="number"
                min={1}
                value={path.resilience.retry.baseDelay}
                onChange={(e) =>
                  onUpdateResilience({
                    retry: { ...path.resilience.retry!, baseDelay: Number(e.target.value) },
                  })
                }
              />
            </label>
            <label className="field">
              <span className="label-text">Jitter Factor (0-1)</span>
              <input
                className="input"
                type="number"
                min={0}
                max={1}
                step={0.1}
                value={path.resilience.retry.jitterFactor}
                onChange={(e) =>
                  onUpdateResilience({
                    retry: { ...path.resilience.retry!, jitterFactor: Number(e.target.value) },
                  })
                }
              />
            </label>
          </>
        )}
      </fieldset>

      <fieldset className="fieldset">
        <legend className="label-text">Circuit Breaker</legend>
        <label className="field">
          <span className="label-text">Failure Threshold</span>
          <input
            className="input"
            type="number"
            min={1}
            value={path.resilience.circuitBreaker?.failureThreshold ?? ''}
            onChange={(e) => {
              const val = e.target.value ? Number(e.target.value) : undefined;
              if (val !== undefined) {
                onUpdateResilience({
                  circuitBreaker: {
                    failureThreshold: val,
                    cooldownMs: path.resilience.circuitBreaker?.cooldownMs ?? 5000,
                  },
                });
              } else {
                onUpdateResilience({ circuitBreaker: undefined });
              }
            }}
          />
        </label>
        {path.resilience.circuitBreaker && (
          <label className="field">
            <span className="label-text">Cooldown (ms)</span>
            <input
              className="input"
              type="number"
              min={1}
              value={path.resilience.circuitBreaker.cooldownMs}
              onChange={(e) =>
                onUpdateResilience({
                  circuitBreaker: {
                    ...path.resilience.circuitBreaker!,
                    cooldownMs: Number(e.target.value),
                  },
                })
              }
            />
          </label>
        )}
      </fieldset>
    </div>
  );
}
