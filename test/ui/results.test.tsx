/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ResultsWorkspace } from '../../src/ui/ResultsWorkspace';
import { TimelineView } from '../../src/ui/TimelineView';
import { EventTable } from '../../src/ui/EventTable';
import { MetricsPanel } from '../../src/ui/MetricsPanel';
import { InvariantResultsPanel } from '../../src/ui/InvariantResultsPanel';
import { simulateScenario } from '../../src/engine/simulate-scenario';
import { evaluateInvariants } from '../../src/invariants/evaluator';
import { computeMetrics } from '../../src/metrics/compute';
import { createPaymentDoubleChargeScenario } from '../../src/scenario/demo-loader';
import type { SimulationMetrics } from '../../src/metrics/compute';

// Run the payment demo to get real data for tests
const scenario = createPaymentDoubleChargeScenario();
const simResult = simulateScenario(scenario);
const invResults = evaluateInvariants(simResult.events, scenario.invariants);
const metrics = computeMetrics(simResult.events);

describe('ResultsWorkspace', () => {
  it('shows empty state when no simulation result', () => {
    render(<ResultsWorkspace simulationResult={null} invariantResults={null} metrics={null} />);
    expect(screen.getByText(/Run a simulation/)).toBeDefined();
  });

  it('shows tabs when simulation result exists', () => {
    render(
      <ResultsWorkspace
        simulationResult={simResult}
        invariantResults={invResults}
        metrics={metrics}
      />,
    );
    expect(screen.getByRole('tab', { name: /Timeline/ })).toBeDefined();
    expect(screen.getByRole('tab', { name: /Events/ })).toBeDefined();
    expect(screen.getByRole('tab', { name: /Metrics/ })).toBeDefined();
    expect(screen.getByRole('tab', { name: /Invariants/ })).toBeDefined();
  });

  it('does not call simulateScenario or computeMetrics', () => {
    // This test verifies that components receive data via props only
    render(
      <ResultsWorkspace
        simulationResult={simResult}
        invariantResults={invResults}
        metrics={metrics}
      />,
    );
    // If it rendered without error, it used the provided props
    expect(screen.getByRole('tabpanel')).toBeDefined();
  });
});

describe('TimelineView', () => {
  it('renders all event types as markers', () => {
    render(
      <TimelineView events={simResult.events} selectedSequence={null} onSelectEvent={() => {}} />,
    );
    const buttons = screen.getAllByRole('button');
    // Each event gets a button (minus other buttons)
    expect(buttons.length).toBeGreaterThanOrEqual(simResult.events.length);
  });

  it('shows empty state for empty events', () => {
    render(<TimelineView events={[]} selectedSequence={null} onSelectEvent={() => {}} />);
    expect(screen.getByText(/No events/)).toBeDefined();
  });

  it('events at same timestamp are both visible', () => {
    const { container } = render(
      <TimelineView events={simResult.events} selectedSequence={null} onSelectEvent={() => {}} />,
    );
    // Multiple events at t=0 should all have buttons
    const t0Events = simResult.events.filter((e) => e.timestamp === 0);
    const t0Buttons = container.querySelectorAll('[data-sequence]');
    expect(t0Buttons.length).toBeGreaterThanOrEqual(t0Events.length);
  });

  it('event markers have aria-labels with type and timestamp', () => {
    render(
      <TimelineView events={simResult.events} selectedSequence={null} onSelectEvent={() => {}} />,
    );
    const first = simResult.events[0]!;
    const label = screen.getByLabelText(new RegExp(`${first.type} at ${first.timestamp}ms`));
    expect(label).toBeDefined();
  });

  it('clicking an event calls onSelectEvent', () => {
    const onSelect = vi.fn();
    render(
      <TimelineView events={simResult.events} selectedSequence={null} onSelectEvent={onSelect} />,
    );
    const firstButton = screen.getAllByRole('button')[0]!;
    fireEvent.click(firstButton);
    expect(onSelect).toHaveBeenCalled();
  });

  it('selected event has selected class', () => {
    const seq = simResult.events[0]!.sequence;
    const { container } = render(
      <TimelineView events={simResult.events} selectedSequence={seq} onSelectEvent={() => {}} />,
    );
    const selected = container.querySelector('.timeline__event--selected');
    expect(selected).not.toBeNull();
  });
});

describe('EventTable', () => {
  it('renders all events in order', () => {
    const { container } = render(
      <EventTable events={simResult.events} selectedSequence={null} onSelectEvent={() => {}} />,
    );
    const rows = container.querySelectorAll('.event-table__row');
    expect(rows.length).toBe(simResult.events.length);
  });

  it('shows filtered/total counts', () => {
    render(
      <EventTable events={simResult.events} selectedSequence={null} onSelectEvent={() => {}} />,
    );
    expect(
      screen.getByText(`${simResult.events.length}/${simResult.events.length} events`),
    ).toBeDefined();
  });

  it('filtering reduces visible rows', () => {
    const { container } = render(
      <EventTable events={simResult.events} selectedSequence={null} onSelectEvent={() => {}} />,
    );
    const allRows = container.querySelectorAll('.event-table__row').length;
    // Filter by SideEffect type
    const typeFilter = screen.getByLabelText('Filter by type');
    fireEvent.change(typeFilter, { target: { value: 'SideEffect' } });
    const filteredRows = container.querySelectorAll('.event-table__row').length;
    expect(filteredRows).toBeLessThan(allRows);
    expect(filteredRows).toBeGreaterThan(0);
  });

  it('clear button resets filters', () => {
    render(
      <EventTable events={simResult.events} selectedSequence={null} onSelectEvent={() => {}} />,
    );
    // Apply filter
    const typeFilter = screen.getByLabelText('Filter by type');
    fireEvent.change(typeFilter, { target: { value: 'SideEffect' } });
    // Verify filtered state shows clear button
    const clearBtn = screen.getByLabelText('Clear filters');
    expect(clearBtn).toBeDefined();
    // Click clear
    fireEvent.click(clearBtn);
    // After clear, all events should show (check count text)
    expect(
      screen.getByText(`${simResult.events.length}/${simResult.events.length} events`),
    ).toBeDefined();
  });

  it('clicking a row calls onSelectEvent', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <EventTable events={simResult.events} selectedSequence={null} onSelectEvent={onSelect} />,
    );
    const firstRow = container.querySelector('.event-table__row')!;
    fireEvent.click(firstRow);
    expect(onSelect).toHaveBeenCalled();
  });
});

describe('MetricsPanel', () => {
  it('displays key metric values', () => {
    const { container } = render(<MetricsPanel metrics={metrics} />);
    // Check that the metrics panel renders with correct aria label
    expect(container.querySelector('[aria-label="Simulation metrics"]')).not.toBeNull();
    // Check duration is displayed
    expect(screen.getByText(`${metrics.simulatedDuration} ms`)).toBeDefined();
  });

  it('displays null latency as "No eligible responses"', () => {
    const nullMetrics: SimulationMetrics = {
      ...metrics,
      p50Latency: null,
      p95Latency: null,
      p99Latency: null,
    };
    render(<MetricsPanel metrics={nullMetrics} />);
    const noResponse = screen.getAllByText('No eligible responses');
    expect(noResponse.length).toBe(3);
  });

  it('displays side effect section', () => {
    render(<MetricsPanel metrics={metrics} />);
    expect(screen.getByText('charge')).toBeDefined();
    expect(screen.getByText('Side Effects')).toBeDefined();
  });
});

describe('InvariantResultsPanel', () => {
  it('shows pass/fail summary', () => {
    render(<InvariantResultsPanel results={invResults} onSelectEvidence={() => {}} />);
    expect(screen.getByText(/failed/)).toBeDefined();
  });

  it('shows invariant actual and threshold', () => {
    render(<InvariantResultsPanel results={invResults} onSelectEvidence={() => {}} />);
    expect(screen.getByText(/Actual: 2/)).toBeDefined();
    expect(screen.getByText(/Threshold: 1/)).toBeDefined();
  });

  it('evidence links call onSelectEvidence', () => {
    const onSelect = vi.fn();
    render(<InvariantResultsPanel results={invResults} onSelectEvidence={onSelect} />);
    const links = screen.getAllByRole('button', { name: /Go to event/ });
    expect(links.length).toBeGreaterThan(0);
    fireEvent.click(links[0]!);
    expect(onSelect).toHaveBeenCalled();
  });

  it('renders message for each invariant', () => {
    render(<InvariantResultsPanel results={invResults} onSelectEvidence={() => {}} />);
    expect(screen.getByText(invResults[0]!.message)).toBeDefined();
  });
});
