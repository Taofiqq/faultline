import { useState, useCallback } from 'react';
import './tokens.css';
import './App.css';
import './Results.css';
import { useAppState } from './state/useAppState';
import { TopologyGraph } from './TopologyGraph';
import { ScenarioPanel } from './ScenarioPanel';
import { RunStatus } from './RunStatus';
import { ResultsWorkspace } from './ResultsWorkspace';
import { DemoLauncher } from './DemoLauncher';
import { ImportExportControls } from './ImportExportControls';
import type { DemoSnapshot } from './DemoLauncher';
import { validateDraft } from './state/useAppState';

export function App() {
  const app = useAppState();
  const { state } = app;
  const [selectedEventSequence, setSelectedEventSequence] = useState<number | null>(null);

  const handleSelectEvent = useCallback((seq: number | null) => {
    setSelectedEventSequence(seq);
  }, []);

  // Clear event selection on new run
  const handleRun = useCallback(() => {
    setSelectedEventSequence(null);
    app.runSimulation();
  }, [app]);

  // Build current demo snapshot if available
  const currentDemoSnapshot: DemoSnapshot | null =
    state.simulationResult && state.invariantResults && state.metrics
      ? {
          simulationResult: state.simulationResult,
          invariantResults: state.invariantResults,
          metrics: state.metrics,
          idempotencyEnabled: state.isIdempotencyEnabled,
        }
      : null;

  // Build scenario for export (validate without errors = exportable)
  const exportableScenario =
    state.draft.services.length > 0 && validateDraft(state.draft).length === 0
      ? ({
          schemaVersion: 1,
          seed: state.draft.seed ?? 42,
          maxSimulationTimeMs: state.draft.maxSimulationTimeMs ?? 60000,
          services: state.draft.services,
          paths: state.draft.paths.map((p) => ({
            ...p,
            deadlineMs: p.deadlineMs ?? 5000,
            resilience: {
              idempotencyEnabled: p.resilience.idempotencyEnabled ?? false,
              ...p.resilience,
            },
          })),
          invariants: state.draft.invariants,
        } as unknown as import('../scenario/types').Scenario)
      : null;

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header__brand">
          <h1 className="app-header__title">Faultline</h1>
          <span className="app-header__subtitle">Distributed Systems Failure Simulator</span>
        </div>
        <div className="app-header__controls">
          <DemoLauncher
            onLoadDemo={app.loadDemo}
            onEnableIdempotency={() => {
              app.enableIdempotencyAndReplay();
            }}
            onResetDemo={app.resetDemo}
            baselineResult={state.baselineSnapshot}
            currentResult={currentDemoSnapshot}
            isIdempotencyEnabled={state.isIdempotencyEnabled}
            isDemoMode={state.isDemoMode}
          />
          <ImportExportControls
            scenario={exportableScenario}
            onImport={(s) => app.loadScenario(s)}
            onImportError={() => {
              /* Validation errors handled in panel via next validation pass */
            }}
          />
          <label className="app-header__seed">
            <span className="label-text">Seed</span>
            <input
              type="number"
              min={0}
              max={4294967295}
              value={state.draft.seed ?? ''}
              onChange={(e) => app.setSeed(e.target.value ? Number(e.target.value) : null)}
              className="input input--sm"
              aria-label="Random seed"
            />
          </label>
          <button
            className="btn btn--primary"
            onClick={handleRun}
            disabled={state.draft.services.length === 0}
            aria-label="Run simulation"
          >
            ▶ Run
          </button>
        </div>
      </header>

      <main className="app-workspace">
        <section className="app-workspace__canvas" aria-label="Topology editor">
          <TopologyGraph
            services={state.draft.services}
            paths={state.draft.paths}
            selectedServiceId={state.selectedServiceId}
            selectedPathId={state.selectedPathId}
            onSelectService={app.selectService}
            onSelectPath={app.selectPath}
            onAddService={app.addService}
            onConnect={app.addPath}
            onDeleteService={app.deleteService}
            onDeletePath={app.deletePath}
          />
        </section>

        <aside className="app-workspace__panel" aria-label="Scenario inspector">
          <ScenarioPanel
            draft={state.draft}
            selectedServiceId={state.selectedServiceId}
            selectedPathId={state.selectedPathId}
            validationErrors={state.validationErrors}
            onRenameService={app.renameService}
            onDeleteService={app.deleteService}
            onUpdatePath={app.updatePath}
            onUpdatePathFailures={app.updatePathFailures}
            onUpdatePathResilience={app.updatePathResilience}
            onSetMaxSimTime={app.setMaxSimTime}
            onUpdateInvariants={app.updateInvariants}
          />
        </aside>
      </main>

      <section className="app-results" aria-label="Simulation results">
        <ResultsWorkspace
          simulationResult={state.simulationResult}
          invariantResults={state.invariantResults}
          metrics={state.metrics}
          onSelectEvent={handleSelectEvent}
          selectedEventSequence={selectedEventSequence}
        />
      </section>

      <footer className="app-footer" aria-label="Results summary">
        <RunStatus
          status={state.status}
          validationErrors={state.validationErrors}
          simulationResult={state.simulationResult}
          invariantResults={state.invariantResults}
          metrics={state.metrics}
        />
      </footer>
    </div>
  );
}
