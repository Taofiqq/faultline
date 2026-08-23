import type {
  ScenarioDraft,
  PathDraft,
  ValidationError,
  FailureInjection,
  ResilienceConfig,
  InvariantDraft,
} from '../scenario/types';
import { PathEditor } from './PathEditor';
import { InvariantBuilder } from './InvariantBuilder';

interface ScenarioPanelProps {
  draft: ScenarioDraft;
  selectedServiceId: string | null;
  selectedPathId: string | null;
  validationErrors: ValidationError[];
  onRenameService: (id: string, name: string) => void;
  onDeleteService: (id: string) => void;
  onUpdatePath: (id: string, updates: Partial<PathDraft>) => void;
  onUpdatePathFailures: (id: string, failures: FailureInjection[]) => void;
  onUpdatePathResilience: (id: string, resilience: Partial<ResilienceConfig>) => void;
  onSetMaxSimTime: (ms: number | null) => void;
  onUpdateInvariants: (invariants: InvariantDraft[]) => void;
}

export function ScenarioPanel({
  draft,
  selectedServiceId,
  selectedPathId,
  validationErrors,
  onRenameService,
  onDeleteService,
  onUpdatePath,
  onUpdatePathFailures,
  onUpdatePathResilience,
  onSetMaxSimTime,
  onUpdateInvariants,
}: ScenarioPanelProps) {
  const selectedService = draft.services.find((s) => s.id === selectedServiceId);
  const selectedPath = draft.paths.find((p) => p.id === selectedPathId);

  return (
    <div className="scenario-panel">
      <div className="scenario-panel__section">
        <h3 className="panel-heading">Scenario</h3>
        <label className="field">
          <span className="label-text">Max Simulation Time (ms)</span>
          <input
            type="number"
            className="input"
            min={1}
            value={draft.maxSimulationTimeMs ?? ''}
            onChange={(e) => onSetMaxSimTime(e.target.value ? Number(e.target.value) : null)}
          />
        </label>
      </div>

      {selectedService && (
        <div className="scenario-panel__section">
          <h3 className="panel-heading">Service: {selectedService.name}</h3>
          <label className="field">
            <span className="label-text">Name</span>
            <input
              type="text"
              className="input"
              value={selectedService.name}
              onChange={(e) => onRenameService(selectedService.id, e.target.value)}
            />
          </label>
          <button
            className="btn btn--danger btn--sm"
            onClick={() => onDeleteService(selectedService.id)}
          >
            Delete Service (and connected paths)
          </button>
        </div>
      )}

      {selectedPath && (
        <PathEditor
          path={selectedPath}
          validationErrors={validationErrors}
          onUpdate={(updates) => onUpdatePath(selectedPath.id, updates)}
          onUpdateFailures={(failures) => onUpdatePathFailures(selectedPath.id, failures)}
          onUpdateResilience={(resilience) => onUpdatePathResilience(selectedPath.id, resilience)}
        />
      )}

      {!selectedService && !selectedPath && (
        <div className="scenario-panel__empty">
          <p style={{ color: 'var(--color-text-muted)' }}>
            Select a service or path to edit its settings.
          </p>
        </div>
      )}

      <div className="scenario-panel__section">
        <InvariantBuilder
          invariants={draft.invariants}
          paths={draft.paths}
          onChange={onUpdateInvariants}
        />
      </div>

      {validationErrors.length > 0 && (
        <div className="scenario-panel__errors" role="alert">
          <h4 className="panel-heading" style={{ color: 'var(--color-error)' }}>
            Validation Errors
          </h4>
          <ul className="error-list">
            {validationErrors.map((err, i) => (
              <li key={i} className="error-item">
                <code>{err.path}</code>: {err.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
