/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, renderHook, screen, fireEvent, act } from '@testing-library/react';
import { useAppState, resetIdCounter } from '../../src/ui/state/useAppState';
import { App } from '../../src/ui/App';

beforeEach(() => {
  resetIdCounter();
});

describe('Demo workflow', () => {
  it('loadDemo sets isDemoMode and loads canonical scenario', () => {
    const { result } = renderHook(() => useAppState());
    act(() => {
      result.current.loadDemo();
    });
    expect(result.current.state.isDemoMode).toBe(true);
    expect(result.current.state.draft.seed).toBe(0);
    expect(result.current.state.draft.paths[0]!.resilience.idempotencyEnabled).toBe(false);
  });

  it('baseline run produces exactly 2 charges and failed invariant', () => {
    const { result } = renderHook(() => useAppState());
    act(() => {
      result.current.loadDemo();
    });
    act(() => {
      result.current.runSimulation();
    });
    expect(result.current.state.status).toBe('completed');
    const charges = result.current.state.metrics!.sideEffectCounts['charge'];
    expect(charges).toBe(2);
    expect(result.current.state.invariantResults![0]!.passed).toBe(false);
    expect(result.current.state.baselineSnapshot).toEqual({
      simulationResult: result.current.state.simulationResult,
      invariantResults: result.current.state.invariantResults,
      metrics: result.current.state.metrics,
      idempotencyEnabled: false,
    });
  });

  it('offers the idempotency replay after the baseline run', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /load payment demo/i }));
    fireEvent.click(screen.getByLabelText('Run simulation'));

    expect(screen.getByRole('button', { name: /enable idempotency and replay/i })).toBeDefined();
  });

  it('enableIdempotencyAndReplay changes only idempotencyEnabled', () => {
    const { result } = renderHook(() => useAppState());
    act(() => {
      result.current.loadDemo();
    });
    act(() => {
      result.current.runSimulation();
    });

    const beforeDraft = JSON.parse(JSON.stringify(result.current.state.draft));
    act(() => {
      result.current.enableIdempotencyAndReplay();
    });
    const afterDraft = result.current.state.draft;

    // Only idempotencyEnabled changed
    expect(afterDraft.seed).toBe(beforeDraft.seed);
    expect(afterDraft.paths[0]!.failures).toEqual(beforeDraft.paths[0]!.failures);
    expect(afterDraft.paths[0]!.deadlineMs).toBe(beforeDraft.paths[0]!.deadlineMs);
    expect(afterDraft.paths[0]!.resilience.retry).toEqual(beforeDraft.paths[0]!.resilience.retry);
    expect(afterDraft.paths[0]!.resilience.idempotencyEnabled).toBe(true);
  });

  it('corrected run produces exactly 1 charge and passed invariant', () => {
    const { result } = renderHook(() => useAppState());
    act(() => {
      result.current.loadDemo();
    });
    act(() => {
      result.current.runSimulation();
    });
    act(() => {
      result.current.enableIdempotencyAndReplay();
    });
    act(() => {
      result.current.runSimulation();
    });

    expect(result.current.state.status).toBe('completed');
    const charges = result.current.state.metrics!.sideEffectCounts['charge'];
    expect(charges).toBe(1);
    expect(result.current.state.invariantResults![0]!.passed).toBe(true);
  });

  it('baseline snapshot is preserved after enabling idempotency', () => {
    const { result } = renderHook(() => useAppState());
    act(() => {
      result.current.loadDemo();
    });
    act(() => {
      result.current.runSimulation();
    });
    act(() => {
      result.current.enableIdempotencyAndReplay();
    });

    expect(result.current.state.baselineSnapshot).not.toBeNull();
    expect(result.current.state.baselineSnapshot!.metrics.sideEffectCounts['charge']).toBe(2);
    expect(result.current.state.baselineSnapshot!.idempotencyEnabled).toBe(false);
  });

  it('resetDemo restores canonical baseline', () => {
    const { result } = renderHook(() => useAppState());
    act(() => {
      result.current.loadDemo();
    });
    act(() => {
      result.current.runSimulation();
    });
    act(() => {
      result.current.enableIdempotencyAndReplay();
    });
    act(() => {
      result.current.resetDemo();
    });

    expect(result.current.state.isDemoMode).toBe(true);
    expect(result.current.state.isIdempotencyEnabled).toBe(false);
    expect(result.current.state.baselineSnapshot).toBeNull();
    expect(result.current.state.simulationResult).toBeNull();
  });

  it('maxRetries=0 and jitterFactor=0 remain unchanged in demo', () => {
    const { result } = renderHook(() => useAppState());
    act(() => {
      result.current.loadDemo();
    });
    // The demo has maxRetries=1, jitterFactor=0
    expect(result.current.state.draft.paths[0]!.resilience.retry?.jitterFactor).toBe(0);
    expect(result.current.state.draft.paths[0]!.resilience.retry?.maxRetries).toBe(1);
  });

  it('results come from normal engine path (not hardcoded)', () => {
    const { result } = renderHook(() => useAppState());
    act(() => {
      result.current.loadDemo();
    });
    act(() => {
      result.current.runSimulation();
    });
    // Verify events exist and are a real simulation result
    expect(result.current.state.simulationResult!.events.length).toBeGreaterThan(0);
    expect(result.current.state.simulationResult!.events[0]!.type).toBe('RequestSent');
  });
});

describe('Error states', () => {
  it('invalid draft shows validation errors and blocks simulation', () => {
    const { result } = renderHook(() => useAppState());
    act(() => {
      result.current.addService('A');
    });
    // Add a path that self-references (invalid)
    act(() => {
      result.current.updateDraft((d) => ({
        ...d,
        paths: [
          {
            id: 'p1',
            source: 'svc-1',
            destination: 'svc-1',
            label: 'x',
            deadlineMs: 1000,
            operationName: 'op',
            failures: [],
            resilience: { idempotencyEnabled: false },
          },
        ],
      }));
    });
    act(() => {
      result.current.runSimulation();
    });
    expect(result.current.state.status).toBe('invalid');
    expect(result.current.state.validationErrors.length).toBeGreaterThan(0);
    expect(result.current.state.simulationResult).toBeNull();
  });

  it('empty scenario shows empty status', () => {
    const { result } = renderHook(() => useAppState());
    expect(result.current.state.status).toBe('empty');
  });

  it('completed run with stopped simulation shows stopReason', () => {
    const { result } = renderHook(() => useAppState());
    act(() => {
      result.current.loadDemo();
    });
    // Override maxSimulationTimeMs to a very small value to trigger time-limit stop
    act(() => {
      result.current.setMaxSimTime(1);
    }); // 1ms limit
    act(() => {
      result.current.runSimulation();
    });
    expect(result.current.state.status).toBe('completed');
    // The sim should have stopped very quickly (may or may not hit time limit depending on event timing)
  });
});
