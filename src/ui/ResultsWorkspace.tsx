import { useState } from 'react';
import type { SimulationResult } from '../engine/types';
import type { InvariantResult } from '../invariants/evaluator';
import type { SimulationMetrics } from '../metrics/compute';
import { TimelineView } from './TimelineView';
import { EventTable } from './EventTable';
import { MetricsPanel } from './MetricsPanel';
import { InvariantResultsPanel } from './InvariantResultsPanel';

type ResultTab = 'timeline' | 'events' | 'metrics' | 'invariants';

interface ResultsWorkspaceProps {
  simulationResult: SimulationResult | null;
  invariantResults: InvariantResult[] | null;
  metrics: SimulationMetrics | null;
  onSelectEvent?: (sequence: number | null) => void;
  selectedEventSequence?: number | null;
}

export function ResultsWorkspace({
  simulationResult,
  invariantResults,
  metrics,
  onSelectEvent,
  selectedEventSequence,
}: ResultsWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<ResultTab>('timeline');

  if (!simulationResult) {
    return (
      <div className="results-workspace results-workspace--empty">
        <p>Run a simulation to see results here.</p>
      </div>
    );
  }

  const tabs: { id: ResultTab; label: string }[] = [
    { id: 'timeline', label: 'Timeline' },
    { id: 'events', label: 'Events' },
    { id: 'metrics', label: 'Metrics' },
    { id: 'invariants', label: 'Invariants' },
  ];

  return (
    <div className="results-workspace">
      <nav className="results-tabs" role="tablist" aria-label="Results views">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`results-tab ${activeTab === tab.id ? 'results-tab--active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      <div className="results-content" role="tabpanel">
        {activeTab === 'timeline' && (
          <TimelineView
            events={simulationResult.events}
            selectedSequence={selectedEventSequence ?? null}
            onSelectEvent={onSelectEvent ?? (() => {})}
          />
        )}
        {activeTab === 'events' && (
          <EventTable
            events={simulationResult.events}
            selectedSequence={selectedEventSequence ?? null}
            onSelectEvent={onSelectEvent ?? (() => {})}
          />
        )}
        {activeTab === 'metrics' && metrics && <MetricsPanel metrics={metrics} />}
        {activeTab === 'invariants' && invariantResults && (
          <InvariantResultsPanel
            results={invariantResults}
            onSelectEvidence={onSelectEvent ?? (() => {})}
          />
        )}
      </div>
    </div>
  );
}
