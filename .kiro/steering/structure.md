# Repository Structure — Faultline

## Layout

```
src/
├── engine/                    # Pure deterministic simulation
│   ├── event-loop.ts          # Min-heap event queue, main simulate() entry
│   ├── prng.ts                # xoshiro128** (Uint32Array state)
│   ├── failure-pipeline.ts    # Multi-event transitions T1–T4
│   ├── circuit-breaker.ts     # Per-path state machine, generation-tracked
│   ├── retry-scheduler.ts     # Exponential backoff + jitter, cap 2³¹−1
│   ├── idempotency-registry.ts # Success-only response cache
│   └── types.ts               # SimEvent union, engine interfaces
├── scenario/                  # Schema, validation, import/export
│   ├── schema-validator.ts    # Two-pass: Ajv structural + semantic
│   ├── importer.ts            # JSON → Scenario (atomic)
│   ├── exporter.ts            # Scenario → JSON download
│   ├── demo-loader.ts         # Payment double-charge scenario
│   ├── schema-v1.json         # JSON Schema definition
│   └── types.ts               # ScenarioDraft, Scenario, ValidationError
├── metrics/
│   └── compute.ts             # Derives metrics from EventLog
├── invariants/
│   ├── evaluator.ts           # 5 built-in invariant types
│   └── types.ts               # InvariantResult, InvariantConfig
├── ui/
│   ├── TopologyGraph.tsx       # React Flow node/edge editor
│   ├── TimelineView.tsx        # HTML/SVG swim-lane visualization
│   ├── EventTable.tsx          # Accessible table fallback
│   ├── MetricsPanel.tsx        # Summary statistics display
│   ├── ScenarioEditor.tsx      # Path/service/failure config forms
│   ├── InvariantBuilder.tsx    # Structured rule builder (5 types)
│   ├── ImportExportControls.tsx # File download/upload
│   └── DemoLauncher.tsx        # One-click payment demo
└── index.ts                   # App entry point

test/
├── engine/                    # Unit tests (Vitest)
│   ├── prng.test.ts
│   ├── event-loop.test.ts
│   ├── failure-pipeline.test.ts
│   ├── circuit-breaker.test.ts
│   ├── retry-scheduler.test.ts
│   └── idempotency-registry.test.ts
├── scenario/
│   ├── schema-validator.test.ts
│   └── round-trip.test.ts
├── metrics/
│   └── compute.test.ts
├── invariants/
│   └── evaluator.test.ts
├── properties/                # fast-check property tests
│   ├── determinism.prop.ts
│   ├── backoff.prop.ts
│   ├── circuit.prop.ts
│   └── termination.prop.ts
├── golden/                    # Committed reference event sequences
│   ├── payment-demo.json
│   └── complex-scenario.json
└── e2e/                       # Playwright
    ├── payment-demo.spec.ts
    ├── import-export.spec.ts
    ├── accessibility.spec.ts
    └── keyboard-nav.spec.ts
```

## Module Ownership

| Directory | Owner | Import Boundary |
|-----------|-------|------------------|
| `src/engine/` | Simulation team | Self-contained; no external imports |
| `src/scenario/` | Data team | May import `engine/types.ts` only |
| `src/metrics/` | Data team | May import `engine/types.ts` only |
| `src/invariants/` | Data team | May import `engine/types.ts` only |
| `src/ui/` | UI team | May import any `src/` module |
| `test/` | All | Mirrors `src/` structure |

## Conventions

- One exported concept per file (class, function set, or type set).
- Barrel exports (`index.ts`) at module boundaries only.
- Test files mirror source path: `src/engine/prng.ts` → `test/engine/prng.test.ts`.
- Golden files are checked in; changes require explicit update and PR review.
