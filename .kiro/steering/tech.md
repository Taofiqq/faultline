# Technology & Architecture — Faultline

## Approved Stack

| Layer | Technology | Version Policy |
|-------|-----------|----------------|
| Language | TypeScript (strict mode) | Latest stable |
| Build | Vite | Latest stable |
| UI Framework | React 18+ | Latest stable |
| Topology Editor | React Flow | Latest stable |
| Schema Validation | Ajv (JSON Schema draft-07, tree-shaken) | Pinned |
| PRNG | Custom xoshiro128** (Uint32Array, no external dep) | Internal |
| Testing | Vitest + fast-check + Playwright | Latest stable |
| Coverage | Vitest v8 provider | — |

## Architectural Boundaries

```
UI Layer  →  Scenario Manager  →  Simulation Engine
(React)      (validate/import)     (pure, deterministic)
                    ↓
              Metrics Module  ←  EventLog
                    ↓
           Invariant Evaluator
```

### Rules

1. **Engine has zero DOM/browser dependencies.** It must run identically in Node.js and all supported browsers.
2. **Engine is synchronous.** No async, no callbacks, no Web Workers in v1.
3. **UI never mutates the EventLog.** It consumes it read-only after simulation completes.
4. **ScenarioDraft (UI) ≠ Scenario (engine).** Validation is the boundary; invalid drafts never reach the engine.
5. **Single PRNG stream per simulation run.** All randomness consumed in event-processing (FIFO) order.
6. **No canvas-only views.** Timeline uses HTML/SVG; accessible EventTable provides equivalent content.

## Dependency Rules

- Engine (`src/engine/`) may import only from `src/engine/` — no React, no DOM, no Node.js APIs.
- Scenario (`src/scenario/`) may import from `src/engine/types.ts` only.
- Invariants (`src/invariants/`) may import from `src/engine/types.ts` only.
- Metrics (`src/metrics/`) may import from `src/engine/types.ts` only.
- UI (`src/ui/`) may import from any `src/` module.
- External dependencies limited to the approved stack table above. New deps require explicit approval.

## Bundle Budget

| Component | Budget (gzip) |
|-----------|---------------|
| React + ReactDOM | ~45 KB |
| React Flow | ~40 KB |
| Ajv (tree-shaken) | ~25 KB |
| Engine + Invariants + Metrics | ~10 KB |
| UI components | ~40 KB |
| **Total** | **~160 KB** (headroom to 500 KB) |

CI fails the build if total gzip exceeds 500 KB.
