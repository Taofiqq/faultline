import { useState, useCallback } from 'react';
import type {
  ScenarioDraft,
  ServiceDraft,
  PathDraft,
  InvariantDraft,
  Scenario,
  ValidationError,
  FailureInjection,
  ResilienceConfig,
} from '../../scenario/types';
import { validateStructural, validateSemantic } from '../../scenario/schema-validator';
import { simulateScenario } from '../../engine/simulate-scenario';
import { evaluateInvariants } from '../../invariants/evaluator';
import { computeMetrics } from '../../metrics/compute';
import { createPaymentDoubleChargeScenario } from '../../scenario/demo-loader';
import type { SimulationResult } from '../../engine/types';
import type { InvariantResult } from '../../invariants/evaluator';
import type { SimulationMetrics } from '../../metrics/compute';

import type { DemoSnapshot } from '../DemoLauncher';

export type AppStatus = 'empty' | 'editing' | 'invalid' | 'ready' | 'completed';

export interface AppState {
  draft: ScenarioDraft;
  status: AppStatus;
  validationErrors: ValidationError[];
  importErrors: ValidationError[];
  simulationResult: SimulationResult | null;
  invariantResults: InvariantResult[] | null;
  metrics: SimulationMetrics | null;
  selectedServiceId: string | null;
  selectedPathId: string | null;
  // Demo mode
  isDemoMode: boolean;
  baselineSnapshot: DemoSnapshot | null;
  isIdempotencyEnabled: boolean;
  // Error state
  runtimeError: string | null;
}

let nextId = 1;
function generateId(prefix: string): string {
  return `${prefix}-${nextId++}`;
}

export function resetIdCounter(value = 1): void {
  nextId = value;
}

function createEmptyDraft(): ScenarioDraft {
  return {
    services: [],
    paths: [],
    invariants: [],
    seed: 42,
    maxSimulationTimeMs: 60000,
  };
}

function draftToScenario(draft: ScenarioDraft): Scenario | null {
  const candidate = {
    schemaVersion: 1 as const,
    seed: draft.seed ?? 42,
    maxSimulationTimeMs: draft.maxSimulationTimeMs ?? 60000,
    services: draft.services.map((s) => ({ id: s.id, name: s.name })),
    paths: draft.paths.map((p) => ({
      id: p.id,
      source: p.source,
      destination: p.destination,
      label: p.label,
      deadlineMs: p.deadlineMs ?? 5000,
      operationName: p.operationName,
      sideEffect: p.sideEffect,
      failures: p.failures,
      resilience: {
        idempotencyEnabled: p.resilience.idempotencyEnabled ?? false,
        ...(p.resilience.retry ? { retry: p.resilience.retry } : {}),
        ...(p.resilience.circuitBreaker ? { circuitBreaker: p.resilience.circuitBreaker } : {}),
      } as ResilienceConfig,
    })),
    invariants: draft.invariants as unknown as Scenario['invariants'],
  };
  return candidate as Scenario;
}

export function validateDraft(draft: ScenarioDraft): ValidationError[] {
  const candidate = draftToScenario(draft);
  if (!candidate) return [{ path: '/', code: 'draft.invalid', message: 'Draft is incomplete' }];

  const json = JSON.stringify(candidate);
  const parsed = JSON.parse(json);
  const structural = validateStructural(parsed);
  if (structural.length > 0) return structural;
  return validateSemantic(candidate);
}

export function useAppState() {
  const [state, setState] = useState<AppState>({
    draft: createEmptyDraft(),
    status: 'empty',
    validationErrors: [],
    importErrors: [],
    simulationResult: null,
    invariantResults: null,
    metrics: null,
    selectedServiceId: null,
    selectedPathId: null,
    isDemoMode: false,
    baselineSnapshot: null,
    isIdempotencyEnabled: false,
    runtimeError: null,
  });

  const updateDraft = useCallback((updater: (draft: ScenarioDraft) => ScenarioDraft) => {
    setState((prev) => {
      const newDraft = updater(prev.draft);
      return {
        ...prev,
        draft: newDraft,
        status: 'editing',
        simulationResult: null,
        invariantResults: null,
        metrics: null,
      };
    });
  }, []);

  const addService = useCallback(
    (name: string) => {
      const id = generateId('svc');
      const service: ServiceDraft = { id, name };
      updateDraft((d) => ({ ...d, services: [...d.services, service] }));
      return id;
    },
    [updateDraft],
  );

  const renameService = useCallback(
    (id: string, name: string) => {
      updateDraft((d) => ({
        ...d,
        services: d.services.map((s) => (s.id === id ? { ...s, name } : s)),
      }));
    },
    [updateDraft],
  );

  const deleteService = useCallback(
    (id: string) => {
      updateDraft((d) => ({
        ...d,
        services: d.services.filter((s) => s.id !== id),
        paths: d.paths.filter((p) => p.source !== id && p.destination !== id),
      }));
      setState((prev) => ({
        ...prev,
        selectedServiceId: prev.selectedServiceId === id ? null : prev.selectedServiceId,
      }));
    },
    [updateDraft],
  );

  const addPath = useCallback(
    (source: string, destination: string): string | null => {
      if (source === destination) return null; // prevent self-loop
      const id = generateId('path');
      const path: PathDraft = {
        id,
        source,
        destination,
        label: 'request',
        deadlineMs: 5000,
        operationName: 'operation',
        failures: [],
        resilience: { idempotencyEnabled: false },
      };
      updateDraft((d) => ({ ...d, paths: [...d.paths, path] }));
      return id;
    },
    [updateDraft],
  );

  const deletePath = useCallback(
    (id: string) => {
      updateDraft((d) => ({ ...d, paths: d.paths.filter((p) => p.id !== id) }));
      setState((prev) => ({
        ...prev,
        selectedPathId: prev.selectedPathId === id ? null : prev.selectedPathId,
      }));
    },
    [updateDraft],
  );

  const updatePath = useCallback(
    (id: string, updates: Partial<PathDraft>) => {
      updateDraft((d) => ({
        ...d,
        paths: d.paths.map((p) => (p.id === id ? { ...p, ...updates } : p)),
      }));
    },
    [updateDraft],
  );

  const updatePathFailures = useCallback(
    (id: string, failures: FailureInjection[]) => {
      updateDraft((d) => ({
        ...d,
        paths: d.paths.map((p) => (p.id === id ? { ...p, failures } : p)),
      }));
    },
    [updateDraft],
  );

  const updatePathResilience = useCallback(
    (id: string, resilience: Partial<ResilienceConfig>) => {
      updateDraft((d) => ({
        ...d,
        paths: d.paths.map((p) =>
          p.id === id ? { ...p, resilience: { ...p.resilience, ...resilience } } : p,
        ),
      }));
    },
    [updateDraft],
  );

  const setSeed = useCallback(
    (seed: number | null) => {
      updateDraft((d) => ({ ...d, seed }));
    },
    [updateDraft],
  );

  const setMaxSimTime = useCallback(
    (ms: number | null) => {
      updateDraft((d) => ({ ...d, maxSimulationTimeMs: ms }));
    },
    [updateDraft],
  );

  const updateInvariants = useCallback(
    (invariants: InvariantDraft[]) => {
      updateDraft((d) => ({ ...d, invariants }));
    },
    [updateDraft],
  );

  const selectService = useCallback((id: string | null) => {
    setState((prev) => ({ ...prev, selectedServiceId: id, selectedPathId: null }));
  }, []);

  const selectPath = useCallback((id: string | null) => {
    setState((prev) => ({ ...prev, selectedPathId: id, selectedServiceId: null }));
  }, []);

  const runSimulation = useCallback(() => {
    try {
      const errors = validateDraft(state.draft);
      if (errors.length > 0) {
        setState((prev) => ({
          ...prev,
          validationErrors: errors,
          status: 'invalid',
          runtimeError: null,
        }));
        return;
      }

      const scenario = draftToScenario(state.draft)!;
      const result = simulateScenario(scenario);
      const invResults = evaluateInvariants(result.events, scenario.invariants);
      const metricsResult = computeMetrics(result.events);

      setState((prev) => ({
        ...prev,
        validationErrors: [],
        importErrors: [],
        status: 'completed',
        simulationResult: result,
        invariantResults: invResults,
        metrics: metricsResult,
        runtimeError: null,
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        runtimeError: err instanceof Error ? err.message : 'An unexpected error occurred',
        status: 'editing',
      }));
    }
  }, [state.draft]);

  const handleImportError = useCallback((errors: ValidationError[]) => {
    setState((prev) => ({ ...prev, importErrors: errors }));
  }, []);

  const handleImportSuccess = useCallback((scenario: Scenario) => {
    const draft: ScenarioDraft = {
      services: scenario.services.map((s) => ({ ...s })),
      paths: scenario.paths.map((p) => ({ ...p, resilience: { ...p.resilience } })),
      invariants: scenario.invariants.map((inv) => ({ ...inv }) as unknown as InvariantDraft),
      seed: scenario.seed,
      maxSimulationTimeMs: scenario.maxSimulationTimeMs,
    };
    setState((prev) => ({
      ...prev,
      draft,
      status: 'editing',
      validationErrors: [],
      importErrors: [],
      simulationResult: null,
      invariantResults: null,
      metrics: null,
      isDemoMode: false,
      baselineSnapshot: null,
      isIdempotencyEnabled: false,
      runtimeError: null,
    }));
  }, []);

  const loadScenario = useCallback((scenario: Scenario) => {
    const draft: ScenarioDraft = {
      services: scenario.services.map((s) => ({ ...s })),
      paths: scenario.paths.map((p) => ({
        ...p,
        resilience: { ...p.resilience },
      })),
      invariants: scenario.invariants.map((inv) => ({ ...inv }) as unknown as InvariantDraft),
      seed: scenario.seed,
      maxSimulationTimeMs: scenario.maxSimulationTimeMs,
    };
    setState({
      draft,
      status: 'editing',
      validationErrors: [],
      simulationResult: null,
      invariantResults: null,
      metrics: null,
      selectedServiceId: null,
      selectedPathId: null,
      isDemoMode: false,
      baselineSnapshot: null,
      isIdempotencyEnabled: false,
      importErrors: [],
      runtimeError: null,
    });
  }, []);

  const loadDemo = useCallback(() => {
    const scenario = createPaymentDoubleChargeScenario();
    const draft: ScenarioDraft = {
      services: scenario.services.map((s) => ({ ...s })),
      paths: scenario.paths.map((p) => ({ ...p, resilience: { ...p.resilience } })),
      invariants: scenario.invariants.map((inv) => ({ ...inv }) as unknown as InvariantDraft),
      seed: scenario.seed,
      maxSimulationTimeMs: scenario.maxSimulationTimeMs,
    };
    setState({
      draft,
      status: 'editing',
      validationErrors: [],
      simulationResult: null,
      invariantResults: null,
      metrics: null,
      selectedServiceId: null,
      selectedPathId: null,
      isDemoMode: true,
      baselineSnapshot: null,
      isIdempotencyEnabled: false,
      importErrors: [],
      runtimeError: null,
    });
  }, []);

  const enableIdempotencyAndReplay = useCallback(() => {
    setState((prev) => {
      // Save baseline snapshot
      const baseline: DemoSnapshot | null =
        prev.simulationResult && prev.invariantResults && prev.metrics
          ? {
              simulationResult: prev.simulationResult,
              invariantResults: prev.invariantResults,
              metrics: prev.metrics,
              idempotencyEnabled: false,
            }
          : prev.baselineSnapshot;

      // Enable idempotency on all paths
      const newDraft: ScenarioDraft = {
        ...prev.draft,
        paths: prev.draft.paths.map((p) => ({
          ...p,
          resilience: { ...p.resilience, idempotencyEnabled: true },
        })),
      };

      // Auto-run simulation with the new draft
      try {
        const errors = validateDraft(newDraft);
        if (errors.length > 0) {
          return {
            ...prev,
            draft: newDraft,
            baselineSnapshot: baseline,
            isIdempotencyEnabled: true,
            validationErrors: errors,
            status: 'invalid' as AppStatus,
          };
        }

        const scenario = draftToScenario(newDraft)!;
        const result = simulateScenario(scenario);
        const invResults = evaluateInvariants(result.events, scenario.invariants);
        const metricsResult = computeMetrics(result.events);

        return {
          ...prev,
          draft: newDraft,
          baselineSnapshot: baseline,
          isIdempotencyEnabled: true,
          status: 'completed' as AppStatus,
          simulationResult: result,
          invariantResults: invResults,
          metrics: metricsResult,
          validationErrors: [],
          runtimeError: null,
        };
      } catch (err) {
        return {
          ...prev,
          draft: newDraft,
          baselineSnapshot: baseline,
          isIdempotencyEnabled: true,
          runtimeError: err instanceof Error ? err.message : 'An unexpected error occurred',
          status: 'editing' as AppStatus,
        };
      }
    });
  }, []);

  const resetDemo = useCallback(() => {
    loadDemo();
  }, [loadDemo]);

  return {
    state,
    addService,
    renameService,
    deleteService,
    addPath,
    deletePath,
    updatePath,
    updatePathFailures,
    updatePathResilience,
    setSeed,
    setMaxSimTime,
    updateInvariants,
    selectService,
    selectPath,
    runSimulation,
    loadScenario,
    loadDemo,
    enableIdempotencyAndReplay,
    resetDemo,
    handleImportError,
    handleImportSuccess,
    updateDraft,
  };
}
