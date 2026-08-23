# Testing Strategy — Faultline

## Unit Tests (Vitest)

Every module in `src/engine/`, `src/scenario/`, `src/metrics/`, and `src/invariants/` has a corresponding test file.

| Module                 | Key Assertions                                                                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `prng`                 | Output matches published xoshiro128** reference vectors. `nextFloat` ∈ [0,1). `nextRange` within bounds. Seeding produces expected state. |
| `event-loop`           | FIFO at same timestamp. Terminates on empty queue, time limit, event limit. `SimulationStopped` emitted correctly.                        |
| `failure-pipeline`     | Each transition (T1–T4) in isolation. Correct event types produced. Pipeline order enforced.                                              |
| `circuit-breaker`      | All state transitions. Generation tracking ignores stale responses. Half-open probe is first-by-sequence.                                 |
| `retry-scheduler`      | Formula matches spec. Cap at 2³¹−1. Zero retries = no retry event. Circuit-open not retried.                                              |
| `idempotency-registry` | Cache hit returns stored. Miss stores. Errors not cached. Scoped to (dest, op, key).                                                      |
| `schema-validator`     | Each invalid case returns correct `ValidationError`. Valid input passes both passes.                                                      |
| `metrics/compute`      | Correct counts, percentiles, durations from crafted event logs. Late responses excluded from latency stats.                               |
| `invariants/evaluator` | Each of 5 types: pass, fail, evidence correctness. Late and deduplicated responses excluded from success counts.                          |

## Property Tests (fast-check)

| Property       | Description                                                                           |
| -------------- | ------------------------------------------------------------------------------------- |
| Determinism    | Arbitrary valid scenario × same seed × 2 runs → identical normalized event sequences. |
| Backoff bounds | `computeDelay(n, config, prng)` ≥ `baseDelay` and ≤ 2³¹−1 for all `n` ∈ [0, 50].      |
| Circuit safety | Never > 1 request permitted in half-open state per generation.                        |
| Event ordering | `sequence[i] < sequence[i+1]` and `timestamp[i] <= timestamp[i+1]` for all `i`.       |
| Idempotency    | With idempotency enabled, side-effect count per operation ≤ 1.                        |
| Termination    | Simulation always terminates (event count ≤ 100,000).                                 |

## Golden-File Determinism Tests

- `test/golden/*.json` — committed normalized event sequences for known scenarios.
- CI runs each in **Node.js** AND **headless Chromium** (Playwright) and asserts deep-equality.
- Any event-output change requires explicit golden-file update (treated as a breaking change in PR review).

## End-to-End Tests (Playwright)

| Test File               | Coverage                                                                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- |
| `payment-demo.spec.ts`  | Load demo → run → invariant fails → toggle idempotency → re-run → invariant passes → timeline shows dedup. |
| `import-export.spec.ts` | Upload invalid JSON → errors shown. Configure → export → clear → import → run → same results.              |
| `accessibility.spec.ts` | Axe-core audit on all views. Colour contrast. ARIA labels present.                                         |
| `keyboard-nav.spec.ts`  | Tab through topology, timeline, event table, and invariant builder without mouse.                          |

## Cross-Browser

- Playwright matrix: **Chromium, Firefox, WebKit**.
- Golden-file determinism tests run in all three.
- E2E tests run in Chromium (primary) + WebKit (secondary).

## Accessibility

- Axe-core integrated into Playwright — zero violations at WCAG 2.1 AA.
- `prefers-reduced-motion` tested: graph animations disabled.
- Colour-independent indicators verified (shape/icon, not colour alone).
- Screen reader: ARIA labels on timeline spans, graph nodes, invariant results.

## Coverage

- **Tool:** Vitest v8 coverage provider.
- **Threshold:** 90% branch coverage on `src/engine/` and `src/invariants/`.
- **CI gate:** Build fails below threshold.
- **Exclusions:** UI components (`src/ui/`) tracked but not gated (covered by E2E instead).

## CI Pipeline Summary

```
lint (eslint + forbidden-api rules)
  → typecheck (tsc --noEmit)
  → unit + property tests (vitest)
  → coverage check (≥ 90% engine/invariants)
  → golden-file tests (Node + Chromium)
  → build (vite build)
  → bundle size check (≤ 500 KB gzip)
  → e2e tests (Playwright: Chromium, Firefox, WebKit)
  → accessibility audit (axe-core)
```
