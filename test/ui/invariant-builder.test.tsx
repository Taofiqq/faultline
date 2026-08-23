/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { renderHook, act } from '@testing-library/react';
import { InvariantBuilder } from '../../src/ui/InvariantBuilder';
import { resetInvariantCounter } from '../../src/ui/invariant-counter';
import { App } from '../../src/ui/App';
import { useAppState, resetIdCounter } from '../../src/ui/state/useAppState';
import { createPaymentDoubleChargeScenario } from '../../src/scenario/demo-loader';
import type { InvariantDraft, PathDraft } from '../../src/scenario/types';

beforeEach(() => {
  resetInvariantCounter();
  resetIdCounter();
});

// ─── InvariantBuilder CRUD ───────────────────────────────────────────────────

describe('InvariantBuilder', () => {
  const paths: PathDraft[] = [
    {
      id: 'p1',
      source: 'a',
      destination: 'b',
      label: 'test-path',
      deadlineMs: 5000,
      operationName: 'op',
      failures: [],
      resilience: { idempotencyEnabled: false },
    },
  ];

  it('renders add-invariant select', () => {
    render(<InvariantBuilder invariants={[]} paths={paths} onChange={() => {}} />);
    expect(screen.getByTestId('add-invariant-select')).toBeDefined();
  });

  it('adds a maxSideEffectCount invariant', () => {
    const onChange = vi.fn();
    render(<InvariantBuilder invariants={[]} paths={paths} onChange={onChange} />);
    fireEvent.change(screen.getByTestId('add-invariant-select'), {
      target: { value: 'maxSideEffectCount' },
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    const newInvariants = onChange.mock.calls[0]![0] as InvariantDraft[];
    expect(newInvariants).toHaveLength(1);
    expect(newInvariants[0]!.type).toBe('maxSideEffectCount');
    expect(newInvariants[0]!.id).toMatch(/^inv-/);
  });

  it('adds a noPendingRequests invariant', () => {
    const onChange = vi.fn();
    render(<InvariantBuilder invariants={[]} paths={paths} onChange={onChange} />);
    fireEvent.change(screen.getByTestId('add-invariant-select'), {
      target: { value: 'noPendingRequests' },
    });
    const newInvariants = onChange.mock.calls[0]![0] as InvariantDraft[];
    expect(newInvariants[0]!.type).toBe('noPendingRequests');
  });

  it('removes an invariant', () => {
    const inv: InvariantDraft = { type: 'noPendingRequests', id: 'inv-1' };
    const onChange = vi.fn();
    render(<InvariantBuilder invariants={[inv]} paths={paths} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Remove invariant inv-1'));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('generates stable IDs without random APIs', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <InvariantBuilder invariants={[]} paths={paths} onChange={onChange} />,
    );
    fireEvent.change(screen.getByTestId('add-invariant-select'), {
      target: { value: 'maxCompletionTime' },
    });
    const id1 = (onChange.mock.calls[0]![0] as InvariantDraft[])[0]!.id;

    resetInvariantCounter();
    onChange.mockClear();
    rerender(<InvariantBuilder invariants={[]} paths={paths} onChange={onChange} />);
    fireEvent.change(screen.getByTestId('add-invariant-select'), {
      target: { value: 'maxCompletionTime' },
    });
    const id2 = (onChange.mock.calls[0]![0] as InvariantDraft[])[0]!.id;

    expect(id1).toBe(id2); // Same counter = same ID
  });

  it('path-based invariant uses existing path ID', () => {
    const onChange = vi.fn();
    render(<InvariantBuilder invariants={[]} paths={paths} onChange={onChange} />);
    fireEvent.change(screen.getByTestId('add-invariant-select'), {
      target: { value: 'maxRequestCount' },
    });
    const inv = (onChange.mock.calls[0]![0] as InvariantDraft[])[0]!;
    expect(inv.pathId).toBe('p1');
  });
});

// ─── InvariantBuilder validation integration ─────────────────────────────────

describe('InvariantBuilder validation', () => {
  it('invariant with missing pathId reference produces validation error on Run', () => {
    const { result } = renderHook(() => useAppState());
    act(() => {
      result.current.addService('A');
      result.current.addService('B');
    });
    // Manually set invariants referencing a non-existent path
    act(() => {
      result.current.updateDraft((d) => ({
        ...d,
        invariants: [{ type: 'maxRequestCount', id: 'inv-1', pathId: 'nonexistent', maxCount: 5 }],
      }));
    });
    act(() => {
      result.current.addPath(
        result.current.state.draft.services[0]!.id,
        result.current.state.draft.services[1]!.id,
      );
    });
    act(() => {
      result.current.runSimulation();
    });
    // Should have a validation error about the invalid path reference
    expect(result.current.state.status).toBe('invalid');
    expect(
      result.current.state.validationErrors.some((e) => e.code.includes('invalidPathRef')),
    ).toBe(true);
  });

  it('valid invariant reaches evaluateInvariants unchanged', () => {
    const { result } = renderHook(() => useAppState());
    act(() => {
      result.current.loadScenario(createPaymentDoubleChargeScenario());
    });
    act(() => {
      result.current.runSimulation();
    });
    expect(result.current.state.invariantResults).not.toBeNull();
    expect(result.current.state.invariantResults![0]!.invariantId).toBe('inv-charge-at-most-once');
  });
});

// ─── App shell render ────────────────────────────────────────────────────────

describe('App shell', () => {
  it('renders without crashing', () => {
    const { container } = render(<App />);
    expect(container.querySelector('.app')).not.toBeNull();
  });

  it('shows header with title and Run button', () => {
    render(<App />);
    expect(screen.getByText('Faultline')).toBeDefined();
    expect(screen.getByLabelText('Run simulation')).toBeDefined();
  });

  it('shows empty state message', () => {
    render(<App />);
    expect(screen.getByText(/Add services and paths/)).toBeDefined();
  });
});

// ─── React Flow smoke test ───────────────────────────────────────────────────

describe('TopologyGraph smoke', () => {
  it('renders Add Service button', () => {
    render(<App />);
    expect(screen.getByLabelText('Add service')).toBeDefined();
  });
});
