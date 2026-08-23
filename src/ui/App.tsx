import './tokens.css';
import './App.css';
import { useAppState } from './state/useAppState';
import { TopologyGraph } from './TopologyGraph';
import { ScenarioPanel } from './ScenarioPanel';
import { RunStatus } from './RunStatus';

export function App() {
  const app = useAppState();
  const { state } = app;

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header__brand">
          <h1 className="app-header__title">Faultline</h1>
          <span className="app-header__subtitle">Distributed Systems Failure Simulator</span>
        </div>
        <div className="app-header__controls">
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
            onClick={app.runSimulation}
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
