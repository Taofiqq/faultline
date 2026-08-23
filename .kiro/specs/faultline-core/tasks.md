# Faultline Core — Implementation Tasks

## Milestone 1: Project Scaffold (P0)

- [ ] **1.1** Initialize Vite + React + TypeScript project with strict tsconfig. [NFR-3, NFR-6]
  - Deps: None
  - Verify: `npm run dev` serves empty page; `tsc --noEmit` passes.
- [ ] **1.2** Configure ESLint with `no-restricted-globals` banning `Math.random`, `Date.now`, `performance.now`, `crypto.getRandomValues`, `setTimeout`, `setInterval` inside `src/engine/`. [NFR-2, simulation-invariants]
  - Deps: 1.1
  - Verify: Lint rule triggers on forbidden API usage in `src/engine/`; passes elsewhere.
- [ ] **1.3** Configure Prettier and EditorConfig. [tech.md conventions]
  - Deps: 1.1
  - Verify: `npm run format:check` passes on scaffold.
- [ ] **1.4** Set up Vitest with v8 coverage provider; add `npm run test` and `npm run test:coverage`. [NFR-7, testing.md]
  - Deps: 1.1
  - Verify: `npm run test` exits 0 with placeholder test; coverage report generated.
- [ ] **1.5** Create approved folder structure (`src/engine/`, `src/scenario/`, `src/metrics/`, `src/invariants/`, `src/ui/`, `test/`). [structure.md]
  - Deps: 1.1
  - Verify: All directories exist with placeholder `index.ts` barrel files.
- [ ] **1.6** Add fast-check and Playwright as dev dependencies (pinned versions). [tech.md]
  - Deps: 1.1
  - Verify: `import { fc } from 'fast-check'` resolves; Playwright config present.
- [ ] **1.7** Add `npm run lint`, `npm run typecheck`, `npm run build` scripts; verify build produces output < 500 KB gzip (empty app). [NFR-4]
  - Deps: 1.1–1.6
  - Verify: All scripts pass; `dist/` output measured.

---

## Milestone 2: Scenario Types & Validation (P0)

- [ ] **2.1** Define `Scenario`, `ScenarioDraft`, `Service`, `Path`, `Invariant`, `ValidationError` types in `src/scenario/types.ts`. [design.md §Scenario Manager, US-1, US-6, US-7]
  - Deps: 1.5
  - Verify: Types compile; exported from barrel.
- [ ] **2.2** Write JSON Schema v1 (`src/scenario/schema-v1.json`) covering services, paths (with operation name, side-effect, deadline, failures, resilience), invariants, seed, maxSimulationTimeMs. [US-7, NFR-8]
  - Deps: 2.1
  - Verify: Schema validates a hand-written minimal scenario JSON.
- [ ] **2.3** Implement structural validation pass (Ajv, tree-shaken). [US-7, design.md §Import Validation]
  - Deps: 2.2
  - Verify: Unit test — valid JSON passes; invalid types rejected with `ValidationError[]`.
- [ ] **2.4** Implement semantic validation pass (referential integrity, no self-loops, no duplicate IDs, numeric ranges, maxSimulationTimeMs > 0). [US-7 AC-3]
  - Deps: 2.3
  - Verify: Unit tests for each invalid case; all errors returned atomically.
- [ ] **2.5** Implement `importer.ts` (JSON parse → validate → `Scenario`). [US-7]
  - Deps: 2.3, 2.4
  - Verify: Unit test — valid file returns `Scenario`; invalid file returns errors.
- [ ] **2.6** Implement `exporter.ts` (Scenario → JSON string). [US-7]
  - Deps: 2.1
  - Verify: Unit test — round-trip (export → import) produces identical `Scenario`.
- [ ] **2.7** Write `test/scenario/schema-validator.test.ts` covering all invalid cases from US-7 AC-3. [testing.md]
  - Deps: 2.3, 2.4
  - Verify: All tests pass; ≥ 90% branch on validator.

---

## Milestone 3: Deterministic Primitives (P0)

- [ ] **3.1** Implement xoshiro128** PRNG in `src/engine/prng.ts` using `Uint32Array(4)`, `Math.imul`, `>>> 0`. [design.md §PRNG, simulation-invariants]
  - Deps: 1.5
  - Verify: Unit test outputs match published reference vectors.
- [ ] **3.2** Write `test/engine/prng.test.ts` — reference vectors, `nextFloat` ∈ [0,1), `nextRange` bounds, seed reproducibility. [testing.md]
  - Deps: 3.1
  - Verify: All tests pass.
- [ ] **3.3** Implement event types union in `src/engine/types.ts` (all 11 event types from design.md §Event Types). [design.md]
  - Deps: 1.5
  - Verify: Types compile.
- [ ] **3.4** Implement min-heap priority queue keyed by `(timestamp, sequence)` in `src/engine/event-loop.ts`. [design.md §Event Loop, simulation-invariants §Event Ordering]
  - Deps: 3.3
  - Verify: Unit test — events dequeued in correct (timestamp, sequence) order.
- [ ] **3.5** Implement `simulate()` entry point with global sequence counter, maxSimulationTimeMs check, 100K event limit, and `SimulationStopped` emission. [design.md §Event Loop, NFR-9]
  - Deps: 3.4
  - Verify: Unit test — empty scenario terminates immediately; time-limit scenario emits `SimulationStopped`.
- [ ] **3.6** Write `test/engine/event-loop.test.ts` — FIFO at same timestamp, termination conditions, sequence monotonicity. [testing.md]
  - Deps: 3.4, 3.5
  - Verify: All tests pass.

---

## Milestone 4: Minimal Pipeline — Vertical Slice (P0)

- [ ] **4.1** Implement T1 (RequestSent → RequestArrived): circuit check (stub: always closed), request latency (fixed only for now). [design.md §Multi-Event Pipeline T1]
  - Deps: 3.5, 3.1
  - Verify: Unit test — RequestSent produces RequestArrived at correct timestamp.
- [ ] **4.2** Implement T2 (RequestArrived → process): side-effect emission for successful non-deduplicated processing, ResponseSent. [design.md §Multi-Event Pipeline T2]
  - Deps: 4.1
  - Verify: Unit test — RequestArrived produces SideEffect + ResponseSent.
- [ ] **4.3** Implement T3 (ResponseSent → ResponseReceived): response latency, response loss. [design.md §Multi-Event Pipeline T3]
  - Deps: 4.2
  - Verify: Unit test — ResponseSent produces ResponseReceived or ResponseLost.
- [ ] **4.4** Implement T4 (ResponseReceived / Timeout): caller deadline timeout, TimeoutError emission, late-response handling (`late: true`). [design.md §Multi-Event Pipeline T4, US-2 lost response]
  - Deps: 4.3
  - Verify: Unit test — timeout fires at deadline; late response logged with `late: true`, no state change.
- [ ] **4.5** Implement `demo-loader.ts` with payment double-charge scenario (no resilience variant). [US-8]
  - Deps: 2.1, 4.1–4.4
  - Verify: `simulate(demoScenario)` produces event log with 2 SideEffect("charge") events.
- [ ] **4.6** Write `test/engine/failure-pipeline.test.ts` for T1–T4 in isolation. [testing.md]
  - Deps: 4.1–4.4
  - Verify: All tests pass.

---

## Milestone 5: Retries, Idempotency & Deterministic Replay (P0)

- [ ] **5.1** Implement retry scheduler (`src/engine/retry-scheduler.ts`): exponential backoff with PRNG jitter, cap at 2³¹−1, zero-retries = no retry. [US-4 Retries, US-4 Backoff, design.md §Retry Scheduler]
  - Deps: 3.1, 4.4
  - Verify: Unit test — delay formula correct for known PRNG outputs; cap enforced.
- [ ] **5.2** Integrate retry into T4: schedule RetryScheduled → new RequestSent on timeout/service-error; circuit-open not retried. [US-4 Retries AC-3, AC-4]
  - Deps: 5.1
  - Verify: Unit test — timeout triggers retry; circuit-open does not.
- [ ] **5.3** Implement idempotency registry (`src/engine/idempotency-registry.ts`): success-only cache, scoped to (dest, op, key). [US-4 Idempotency, design.md §Idempotency Registry]
  - Deps: 4.2
  - Verify: Unit test — first call stores; second returns cached; errors not cached.
- [ ] **5.4** Integrate idempotency into T2: deduplicated requests return cached response, no side-effect. [US-4 Idempotency AC-4, AC side-effects]
  - Deps: 5.3
  - Verify: Unit test — duplicate key produces `deduplicated: true` response, no SideEffect.
- [ ] **5.5** Verify deterministic replay: same seed × 2 runs → identical normalized event sequence. [US-5]
  - Deps: 5.1–5.4
  - Verify: Integration test — deep-equal assertion on two runs of demo scenario.
- [ ] **5.6** Run payment demo with idempotency enabled: verify single SideEffect("charge"). [US-8 AC-6]
  - Deps: 5.4, 4.5
  - Verify: Integration test — exactly 1 charge side-effect with idempotency on.
- [ ] **5.7** Write `test/engine/retry-scheduler.test.ts` and `test/engine/idempotency-registry.test.ts`. [testing.md]
  - Deps: 5.1, 5.3
  - Verify: All tests pass.

---

## Milestone 6: Duplication, Service Errors & Circuit Breakers (P0)

- [ ] **6.1** Implement network duplication in T1: fork N-1 copies with same idempotency key, shared attempt, distinct deliveryIndex. [US-2 duplicate, design.md §Pipeline T1]
  - Deps: 4.1, 5.3
  - Verify: Unit test — count 2 produces 1 additional RequestArrived with deliveryIndex=1.
- [ ] **6.2** Implement simulated service error in T2: probability-based error, not cached, triggers retry. [US-2 service error, design.md §Pipeline T2]
  - Deps: 4.2, 5.2
  - Verify: Unit test — error response returned; idempotency registry not populated; retry scheduled.
- [ ] **6.3** Implement random latency (min/max, PRNG-sampled) in T1. [US-2 random latency]
  - Deps: 4.1, 3.1
  - Verify: Unit test — sampled latency ∈ [min, max] for known PRNG state.
- [ ] **6.4** Implement circuit breaker state machine (`src/engine/circuit-breaker.ts`): consecutive failures, open/half-open/closed, generation tracking. [US-4 Circuit Breaker, design.md §Circuit Breaker]
  - Deps: 4.4
  - Verify: Unit test — all transitions; stale-generation responses ignored.
- [ ] **6.5** Integrate circuit breaker into T1 (CircuitOpenError) and T4 (state updates). [design.md §Pipeline]
  - Deps: 6.4
  - Verify: Unit test — open circuit rejects; half-open permits one probe.
- [ ] **6.6** Verify circuit-open errors are non-retryable and don't consume budget. [US-4 Retries AC-4]
  - Deps: 6.5, 5.2
  - Verify: Integration test.
- [ ] **6.7** Write `test/engine/circuit-breaker.test.ts` — all transitions, generation, half-open probe selection (first by sequence). [testing.md]
  - Deps: 6.4, 6.5
  - Verify: All tests pass.

---

## Milestone 7: Invariants & Metrics (P0)

- [ ] **7.1** Implement invariant evaluator (`src/invariants/evaluator.ts`): all 5 built-in types, evidence collection. [US-6, design.md §Invariant Evaluator]
  - Deps: 3.3
  - Verify: Unit test — each type pass/fail with crafted event logs.
- [ ] **7.2** Implement metrics module (`src/metrics/compute.ts`): counts, percentiles, durations from EventLog; exclude late responses from latency stats. [US-3 metrics, design.md §Metrics Module]
  - Deps: 3.3
  - Verify: Unit test — correct values from crafted log.
- [ ] **7.3** Write `test/invariants/evaluator.test.ts` — each invariant type, evidence correctness, late/dedup exclusions. [testing.md]
  - Deps: 7.1
  - Verify: All tests pass.
- [ ] **7.4** Write `test/metrics/compute.test.ts`. [testing.md]
  - Deps: 7.2
  - Verify: All tests pass.
- [ ] **7.5** Integration: run full payment demo → evaluate invariant → verify fail (no resilience) and pass (with idempotency). [US-8 AC-5, AC-6]
  - Deps: 7.1, 5.6
  - Verify: Integration test asserts invariant results.

---

## Milestone 8: Import/Export (P0)

- [ ] **8.1** Wire importer + exporter with demo scenario; verify round-trip. [US-7 AC-4]
  - Deps: 2.5, 2.6, 4.5
  - Verify: Export demo → import → simulate → identical normalized event sequence.
- [ ] **8.2** Write `test/scenario/round-trip.test.ts`. [testing.md]
  - Deps: 8.1
  - Verify: Test passes.
- [ ] **8.3** Verify file size constraint (< 1 MB for 50 services / 200 paths). [US-7 AC-6]
  - Deps: 2.6
  - Verify: Unit test generates max-size scenario, checks output bytes.

---

## Milestone 9: App Shell, Topology & Controls (P0)

- [ ] **9.1** Create React app shell with routing: Home, Editor, Results views. [NFR-3]
  - Deps: 1.1
  - Verify: App renders in browser; navigation works.
- [ ] **9.2** Implement `TopologyGraph.tsx` with React Flow: add/remove/rename services, add/remove paths, no self-loops enforced. [US-1 AC-1–3]
  - Deps: 9.1, 2.1
  - Verify: Manual test — create services and paths; self-loop attempt rejected.
- [ ] **9.3** Show warning icon on disconnected services. [US-1 AC-4]
  - Deps: 9.2
  - Verify: Manual test — disconnected node shows warning.
- [ ] **9.4** Implement `ScenarioEditor.tsx`: failure injection forms (latency, lost response, service error, duplicate), resilience forms (retries, backoff, idempotency, circuit breaker), caller deadline, operation name, side-effect name. [US-2, US-4]
  - Deps: 9.2, 2.1
  - Verify: Manual test — configure all fields; ScenarioDraft updates correctly.
- [ ] **9.5** Implement `InvariantBuilder.tsx`: structured rule builder for 5 built-in types. [US-6 AC-1]
  - Deps: 9.1, 2.1
  - Verify: Manual test — add/remove invariants; output matches expected InvariantConfig.
- [ ] **9.6** Implement ScenarioDraft → Scenario validation on "Run" button; display inline errors on invalid draft. [design.md §ScenarioDraft → Scenario Boundary]
  - Deps: 9.4, 2.3, 2.4
  - Verify: Manual test — invalid config shows errors; valid config triggers simulation.
- [ ] **9.7** Wire "Run" button: validate → simulate → pass EventLog to results view. [design.md §Data Flow]
  - Deps: 9.6, 3.5
  - Verify: Manual test — simulation runs; results render (placeholder OK).

---

## Milestone 10: Timeline, Event Table & Results (P0)

- [ ] **10.1** Implement `TimelineView.tsx`: HTML/SVG swim lanes per service, colour-coded spans by event type, virtualized scrolling for 1,000+ events. [US-3 AC-1–3, NFR-5]
  - Deps: 9.7
  - Verify: Manual test — spans render on correct lanes; visually distinct.
- [ ] **10.2** Implement hover metadata on timeline spans: start/end time, latency, failure type, attempt, deliveryIndex, idempotency key, late flag. [US-3 AC-4]
  - Deps: 10.1
  - Verify: Manual test — hover shows all fields.
- [ ] **10.3** Implement `EventTable.tsx`: accessible HTML table of all events, sortable, keyboard-navigable. [NFR-5, design.md §UI Accessibility]
  - Deps: 9.7
  - Verify: Manual test — table renders; Tab/arrow keys navigate; screen reader announces rows.
- [ ] **10.4** Implement `MetricsPanel.tsx`: total requests, failures by type, p50/p95/p99 latency, duplicates, deduplications. [US-3 AC-5]
  - Deps: 7.2, 9.7
  - Verify: Manual test — metrics match expected values for demo scenario.
- [ ] **10.5** Display invariant results (pass/fail, evidence) in results view. [US-6 AC-4]
  - Deps: 7.1, 9.7
  - Verify: Manual test — invariant failure shows evidence; pass shows green.

---

## Milestone 11: Demo Workflow & Resilience UI (P0)

- [ ] **11.1** Implement `DemoLauncher.tsx`: one-click load of payment demo from home screen. [US-8 AC-1]
  - Deps: 4.5, 9.1
  - Verify: Manual test — button loads demo scenario into editor.
- [ ] **11.2** Wire complete payment demo workflow: load → run (invariant fails) → toggle idempotency → re-run (invariant passes). [US-8 AC-5, AC-6]
  - Deps: 11.1, 9.7, 7.1
  - Verify: Manual test — full flow works end-to-end.
- [ ] **11.3** Implement `ImportExportControls.tsx`: file download (export), file picker (import) with validation error display. [US-7 AC-1, AC-2]
  - Deps: 2.5, 2.6, 9.1
  - Verify: Manual test — export downloads JSON; import of invalid file shows errors.
- [ ] **11.4** Seed input: user can set/auto-generate u32 seed; re-run with same seed produces same results. [US-5 AC-1]
  - Deps: 9.4
  - Verify: Manual test — two runs same seed → identical timeline.
- [ ] **11.5** Error states: display clear feedback for simulation-stopped (time/event limit), validation failures, import errors. [NFR-9, US-7]
  - Deps: 9.7, 11.3
  - Verify: Manual test — each error state renders correctly.

---

## Milestone 12: Accessibility, Responsiveness & Performance (P1)

- [ ] **12.1** Add ARIA labels to timeline spans, graph nodes/edges, invariant results. [NFR-5]
  - Deps: 10.1, 9.2, 10.5
  - Verify: axe-core audit returns 0 violations.
- [ ] **12.2** Implement colour-independent indicators: shapes/icons distinguish event types, not colour alone. [NFR-5, design.md §Accessibility]
  - Deps: 10.1
  - Verify: Visual inspection with simulated colour-blindness filter; shapes/icons identifiable.
- [ ] **12.3** Implement `prefers-reduced-motion` support: disable graph layout animations. [design.md §Accessibility]
  - Deps: 9.2
  - Verify: Manual test with `prefers-reduced-motion: reduce` — no animations.
- [ ] **12.4** Keyboard navigation: Tab between topology nodes, arrow-key edge traversal, Enter to inspect; timeline rows focusable. [NFR-5, design.md §Accessibility]
  - Deps: 9.2, 10.1, 10.3
  - Verify: Manual test — complete workflow without mouse.
- [ ] **12.5** Responsive layout: usable at 1024px+ viewport. [NFR-6]
  - Deps: 9.1
  - Verify: Manual test at 1024px — no horizontal scroll; all controls reachable.
- [ ] **12.6** Performance: verify 20 services / 50 paths topology renders without jank; timeline scrolls 1,000 events at 30+ fps. [US-1 AC-6, US-3 AC-6]
  - Deps: 10.1, 9.2
  - Verify: Chrome DevTools performance trace — no frames > 33ms.
- [ ] **12.7** Performance: verify simulation benchmark (100 in-flight × 3 retries) < 2 s in Node.js. [NFR-1]
  - Deps: 6.5, 5.2
  - Verify: Benchmark script asserts < 2000ms.

---

## Milestone 13: Property Tests, Golden Files, E2E & CI (P0)

- [ ] **13.1** Write `test/properties/determinism.prop.ts`: arbitrary valid scenario × same seed × 2 runs → identical. [testing.md §Property Tests]
  - Deps: 6.5
  - Verify: fast-check passes 1000 iterations.
- [ ] **13.2** Write `test/properties/backoff.prop.ts`: delay ≥ baseDelay, ≤ 2³¹−1. [testing.md]
  - Deps: 5.1
  - Verify: fast-check passes.
- [ ] **13.3** Write `test/properties/circuit.prop.ts`: never > 1 half-open probe per generation. [testing.md]
  - Deps: 6.4
  - Verify: fast-check passes.
- [ ] **13.4** Write `test/properties/termination.prop.ts`: simulation always terminates (≤ 100K events). [testing.md]
  - Deps: 3.5
  - Verify: fast-check passes.
- [ ] **13.5** Create `test/golden/payment-demo.json` — committed normalized event sequence for demo scenario. [testing.md §Golden-File]
  - Deps: 5.6
  - Verify: Test asserts deep-equality with `simulate()` output.
- [ ] **13.6** Create `test/golden/complex-scenario.json` — multi-path scenario with retries + circuit breakers. [testing.md §Golden-File]
  - Deps: 6.5
  - Verify: Test passes.
- [ ] **13.7** Write `test/e2e/payment-demo.spec.ts` (Playwright): load → run → invariant fails → toggle idempotency → re-run → passes → timeline shows dedup. [testing.md §E2E]
  - Deps: 11.2
  - Verify: Playwright test passes in Chromium.
- [ ] **13.8** Write `test/e2e/import-export.spec.ts` (Playwright): upload invalid → errors; configure → export → import → same results. [testing.md §E2E]
  - Deps: 11.3
  - Verify: Playwright test passes.
- [ ] **13.9** Write `test/e2e/accessibility.spec.ts`: axe-core integration on all views. [testing.md §Accessibility]
  - Deps: 12.1
  - Verify: Zero WCAG 2.1 AA violations.
- [ ] **13.10** Write `test/e2e/keyboard-nav.spec.ts`: full workflow without mouse. [testing.md §E2E]
  - Deps: 12.4
  - Verify: Playwright test passes.
- [ ] **13.11** Run golden-file tests in Playwright headless Chromium, Firefox, WebKit — assert identical output across all three. [testing.md §Cross-Browser]
  - Deps: 13.5, 13.6
  - Verify: All three browsers produce identical event sequences.
- [ ] **13.12** Configure CI pipeline: lint → typecheck → unit/property → coverage (≥ 90% engine/invariants) → golden → build → bundle check (≤ 500 KB) → E2E → accessibility. [testing.md §CI Pipeline]
  - Deps: 13.1–13.11
  - Verify: CI pipeline passes end-to-end.

---

## Milestone 14: Kiro Development Hook (P1)

- [ ] **14.1** Create `.kiro/hooks/engine-tests.md` — Kiro hook that runs `vitest run src/engine` and related property tests when any file in `src/engine/` changes. [Kiro hooks]
  - Deps: 1.4, 3.1
  - Verify: Editing an engine file triggers the hook; test results reported.
- [ ] **14.2** Add hook for golden-file comparison on engine changes.
  - Deps: 13.5, 14.1
  - Verify: Engine change triggers golden-file check.

---

## Milestone 15: Documentation & Deployment (P1)

- [ ] **15.1** Write `README.md`: project overview, quick-start, architecture diagram, tech stack, development commands. [product.md]
  - Deps: 11.2
  - Verify: README renders correctly on GitHub; commands work.
- [ ] **15.2** Document the payment demo walkthrough with screenshots/descriptions. [US-8]
  - Deps: 11.2
  - Verify: Walkthrough matches live app behaviour.
- [ ] **15.3** Add Kiro development evidence: steering files, spec flow, hook usage documented. [judge-ready]
  - Deps: 14.1
  - Verify: Evidence folder/section complete.
- [ ] **15.4** Add attribution for dependencies (React, React Flow, Ajv, xoshiro128** algorithm). [legal]
  - Deps: 1.1
  - Verify: ATTRIBUTION.md or LICENSE section present.
- [ ] **15.5** Configure static deployment (Vite build → dist/). [NFR-3]
  - Deps: 1.7
  - Verify: `npm run build` produces deployable static assets; app loads from `dist/`.
- [ ] **15.6** Final verification: payment demo works end-to-end, all CI checks pass, bundle ≤ 500 KB, coverage ≥ 90%. [Success Criteria]
  - Deps: All
  - Verify: CI green; manual walkthrough of payment demo succeeds.

---

## Priority Summary

| Priority | Milestones | Purpose |
|----------|-----------|---------|
| **P0** | 1–11, 13 | Core working product + payment demo + test coverage |
| **P1** | 12, 14, 15 | Accessibility polish, dev hooks, documentation |
| **P2** | (none defined) | Future: Web Workers, streaming render, additional demos |

## Dependency Graph (Critical Path)

```
M1 → M2 → M3 → M4 → M5 → M6 → M7 → M8
                                  ↓
M1 → M9 ────────────────────→ M10 → M11 → M12
                                        ↓
                              M13 (E2E needs M11; properties need M6)
                                        ↓
                                  M14 → M15
```

The payment demo (M11) is the convergence point — engine (M4–M7) and UI (M9–M10) must both be complete. All E2E tests (M13) depend on the working demo.
