# Faultline Core — Design

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                      Browser (Client)                     │
├──────────┬──────────┬───────────────┬───────────────────┤
│  UI Layer│ Timeline │ Topology      │  Rule Builder     │
│ (React)  │ (SVG/HTML)│ (React Flow) │  (Invariants)     │
├──────────┴──────────┴───────────────┴───────────────────┤
│                    Scenario Manager                       │
│     (ScenarioDraft ↔ Scenario, validate, import/export) │
├─────────────────────────────────────────────────────────┤
│                  Simulation Engine                        │
│  ┌────────────┬────────────┬─────────────────────────┐  │
│  │ Event Loop │   PRNG     │  Multi-Event Pipeline   │  │
│  │ (min-heap) │ (xoshiro   │  (7 stages across       │  │
│  │            │  128**,    │   4 event transitions)  │  │
│  │            │  Uint32×4) │                         │  │
│  ├────────────┼────────────┼─────────────────────────┤  │
│  │ Circuit    │ Retry      │  Idempotency            │  │
│  │ Breakers   │ Scheduler  │  Registry               │  │
│  │ (per-path, │ (exp.      │  (success-only cache)   │  │
│  │  generatio │  backoff)  │                         │  │
│  │  n-tracked)│            │                         │  │
│  └────────────┴────────────┴─────────────────────────┘  │
├─────────────────────────────────────────────────────────┤
│               Metrics Module                             │
├─────────────────────────────────────────────────────────┤
│               Invariant Evaluator                        │
├─────────────────────────────────────────────────────────┤
│            Schema Validator (v1, two-pass)                │
└─────────────────────────────────────────────────────────┘
```

Three layers with strict dependencies flowing downward:

1. **Simulation Engine** — pure, deterministic, zero-DOM-dependency. Produces a normalized event log.
2. **Scenario Manager** — converts `ScenarioDraft` (UI state) → validated `Scenario` (engine input), runs simulation, evaluates invariants.
3. **UI Layer** — renders topology, timeline, metrics, and invariant results. Consumes the event log read-only.

---

## Numeric Representation

All logical-time values and event fields use JavaScript `number`. Constraints:

- All timestamps, delays, and counters must be ≤ `Number.MAX_SAFE_INTEGER` (2⁵³ − 1).
- Backoff delay is capped at 2³¹ − 1 ms (≈ 24.8 days simulated time).
- The seed is an unsigned 32-bit integer (0 – 4,294,967,295).
- No `BigInt` in v1.

---

## Identity Model

| Concept         | Generation                                                                            | Scope                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `operationId`   | Deterministic counter, incremented once per logical operation at first `RequestSent`. | Shared by all retries and network duplicates of the same operation.                                    |
| `attempt`       | 0 = original, incremented on each retry.                                              | Unique per retry within an operation. Network duplicates share the attempt.                            |
| `deliveryIndex` | 0 = original delivery, 1..N-1 for network duplicates.                                 | Distinguishes copies within the same attempt.                                                          |
| `sequence`      | Global monotonic counter, incremented on every event creation.                        | **Canonical unique event ID.** Used for tie-breaking, evidence references, and determinism comparison. |

---

## PRNG

- Algorithm: **xoshiro128**** (128-bit state, 32-bit output).
- State stored in `Uint32Array(4)`. All arithmetic uses `Math.imul()` and `>>> 0` for unsigned 32-bit correctness.
- Seeded via `SplitMix32` initialization from the scenario's u32 seed.
- Single instance per run. All random draws consumed in event-processing order (FIFO by sequence).
- Validated against published reference vectors in unit tests.

```typescript
interface PRNG {
  seed(value: number): void; // u32
  nextU32(): number;
  nextFloat(): number; // [0, 1)
  nextRange(min: number, max: number): number; // [min, max] integers
}
```

---

## Event Types

```typescript
type SimEvent =
  | {
      type: 'RequestSent';
      timestamp: number;
      sequence: number;
      pathId: string;
      operationId: number;
      idempotencyKey: string;
      attempt: number;
      deliveryIndex: number;
    }
  | {
      type: 'RequestArrived';
      timestamp: number;
      sequence: number;
      pathId: string;
      operationId: number;
      idempotencyKey: string;
      attempt: number;
      deliveryIndex: number;
      deduplicated: boolean;
    }
  | {
      type: 'SideEffect';
      timestamp: number;
      sequence: number;
      serviceId: string;
      effectName: string;
      operationId: number;
    }
  | {
      type: 'ResponseSent';
      timestamp: number;
      sequence: number;
      pathId: string;
      operationId: number;
      success: boolean;
      deduplicated: boolean;
    }
  | {
      type: 'ResponseReceived';
      timestamp: number;
      sequence: number;
      pathId: string;
      operationId: number;
      success: boolean;
      deduplicated: boolean;
      late: boolean;
      latency: number;
    }
  | {
      type: 'ResponseLost';
      timestamp: number;
      sequence: number;
      pathId: string;
      operationId: number;
    }
  | {
      type: 'TimeoutError';
      timestamp: number;
      sequence: number;
      pathId: string;
      operationId: number;
      attempt: number;
    }
  | {
      type: 'CircuitOpenError';
      timestamp: number;
      sequence: number;
      pathId: string;
      operationId: number;
    }
  | {
      type: 'CircuitStateChange';
      timestamp: number;
      sequence: number;
      pathId: string;
      newState: 'open' | 'half-open' | 'closed';
      generation: number;
    }
  | {
      type: 'RetryScheduled';
      timestamp: number;
      sequence: number;
      pathId: string;
      operationId: number;
      nextAttempt: number;
      delay: number;
    }
  | {
      type: 'SimulationStopped';
      timestamp: number;
      sequence: number;
      reason: 'time-limit' | 'event-limit';
    };
```

The **normalized event sequence** is this array sorted by `(timestamp, sequence)`. Two runs with the same seed are deterministically identical when their normalized sequences are deep-equal.

---

## Multi-Event Pipeline

The failure pipeline is **not** a single synchronous function call. Each stage maps to an event transition processed by the event loop at distinct simulated times:

| Transition                | Input Event                         | Processing                                                                                                                                                                                                                                                                                                                               | Output Event(s)                                                   |
| ------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **T1: Send → Arrive**     | `RequestSent`                       | (1) Circuit check — if open, emit `CircuitOpenError`, stop. (2) Apply request latency. (3) Network duplication — fork N-1 copies.                                                                                                                                                                                                        | `RequestArrived` (one per delivery, scheduled at `now + latency`) |
| **T2: Arrive → Process**  | `RequestArrived`                    | (4a) Service error check (probability via PRNG) — if error, emit error `ResponseSent`, no side-effect, not cached. (4b) Idempotency check — if key seen, emit cached `ResponseSent` with `deduplicated: true`, no side-effect. (4c) Process: emit `SideEffect` (if configured), store success response in registry, emit `ResponseSent`. | `SideEffect` (conditional), `ResponseSent`                        |
| **T3: Respond → Receive** | `ResponseSent`                      | (5) Apply response latency. (6) Response loss — if triggered, emit `ResponseLost`, stop.                                                                                                                                                                                                                                                 | `ResponseReceived` (scheduled at `now + latency`)                 |
| **T4: Receive / Timeout** | `ResponseReceived` or timeout fires | (7) If `late: true`: log event, no state change. If `late: false`: update circuit breaker (success resets, failure increments). If timeout: emit `TimeoutError`, schedule retry if budget remains.                                                                                                                                       | `TimeoutError`, `RetryScheduled` (conditional)                    |

### Late-Response Handling

When a caller's deadline fires (timeout), the pending response event **remains** in the queue. When it is eventually dequeued:

- It is emitted as `ResponseReceived` with `late: true`.
- It does **not** update caller state, circuit-breaker state, or count toward success-count invariants.
- It is visible in the timeline for diagnostic purposes.

---

## Circuit Breaker

### State

```typescript
interface CircuitBreakerState {
  status: 'closed' | 'open' | 'half-open';
  consecutiveFailures: number;
  openedAt: number | null; // simulated ms
  generation: number; // incremented on each open transition
}
```

### Generation-Based Consistency

Each request stamps the circuit's `generation` at send time. When a response arrives:

- If the response's generation ≠ current generation → **ignore** (the circuit transitioned while the request was in flight).
- This prevents stale successes/failures from corrupting the current circuit state.

### Half-Open Probe Selection

After cooldown expires, the circuit transitions to `half-open`. The **first request by sequence number** at or after the cooldown-expiry timestamp becomes the probe. All other concurrent requests at the same timestamp receive `CircuitOpenError`.

### Transitions

- **Closed → Open:** `consecutiveFailures` reaches threshold.
- **Open → HalfOpen:** Cooldown duration elapses (logical time).
- **HalfOpen → Closed:** Probe succeeds.
- **HalfOpen → Open:** Probe fails (new generation, new cooldown).

Failure = timeout error or simulated service error. Success resets `consecutiveFailures` to 0.

---

## Retry Scheduler

```typescript
interface RetryConfig {
  maxRetries: number; // 0 = no retries
  baseDelay: number; // ms, > 0
  jitterFactor: number; // [0, 1]
}

function computeDelay(attempt: number, config: RetryConfig, prng: PRNG): number {
  const jitter = 1 + prng.nextFloat() * config.jitterFactor;
  const raw = config.baseDelay * Math.pow(2, attempt) * jitter;
  return Math.min(Math.round(raw), 0x7fffffff); // cap at 2^31 - 1
}
```

- `attempt` is 0-indexed (first retry = attempt 0, meaning `nextAttempt = 1` in the event).
- Circuit-open errors bypass retry logic entirely (not retryable, no budget consumed).
- Retries carry the same `operationId` and `idempotencyKey`; `attempt` is incremented.

---

## Idempotency Registry

```typescript
// Key: `${destinationId}:${operationId}:${idempotencyKey}`
interface IdempotencyRegistry {
  lookup(key: string): CachedResponse | null;
  store(key: string, response: SuccessResponse): void;
}
```

- **Only successful** processed responses are cached.
- Service errors are **not** cached — a retry after an error gets a fresh processing attempt (fresh PRNG roll for error probability).
- Duplicate hits return the cached response; no side-effects are re-emitted.
- No TTL — keys live for the scenario run.

---

## Event Loop

```
EventQueue: min-heap ordered by (timestamp, sequence)
let clock = 0;
let sequence = 0;
let eventCount = 0;
const maxTime = scenario.maxSimulationTimeMs ?? 60_000;
const maxEvents = 100_000;

while (!queue.isEmpty()) {
  const event = queue.peek();
  if (event.timestamp > maxTime || eventCount >= maxEvents) {
    log.append({ type: 'SimulationStopped', timestamp: clock, sequence: ++sequence,
                 reason: event.timestamp > maxTime ? 'time-limit' : 'event-limit' });
    break;
  }
  queue.pop();
  clock = event.timestamp;
  eventCount++;
  const produced = processEvent(event, state, prng);
  for (const e of produced) {
    e.sequence = ++sequence;
    queue.push(e);
  }
  log.append(event);
}
```

- `processEvent` dispatches based on event type to the appropriate transition (T1–T4).
- Simulation runs **synchronously on the main thread** in v1. Web Workers are out of scope unless benchmarks prove necessity.
- Terminates when: queue empty, time limit exceeded, or event limit reached.

---

## Scenario Manager

### Types

```typescript
// UI editing state — may be incomplete or invalid
interface ScenarioDraft {
  services: ServiceDraft[];
  paths: PathDraft[];
  invariants: InvariantDraft[];
  seed: number | null;
  maxSimulationTimeMs: number | null;
}

// Validated, engine-ready
interface Scenario {
  schemaVersion: 1;
  seed: number; // u32
  maxSimulationTimeMs: number; // > 0, default 60000
  services: Service[];
  paths: Path[];
  invariants: Invariant[];
}
```

### Import Validation (Two-Pass, Atomic)

**Pass 1 — Structural (Ajv, JSON Schema draft-07):**

- Validates types, required fields, enum values, numeric bounds.

**Pass 2 — Semantic:**

- Referential integrity: path source/destination reference existing service IDs.
- No self-loops: `source ≠ destination`.
- No duplicate IDs across services and paths.
- Range enforcement: probability ∈ [0,1], latency ≥ 0, retry ∈ [0,50], deadline > 0, seed ∈ [0, 2³²−1], maxSimulationTimeMs > 0, duplicate count ≥ 2, circuit threshold ≥ 1, cooldown > 0.

Both passes must succeed. On failure, return all errors:

```typescript
interface ValidationError {
  path: string; // JSON pointer to invalid field
  code: string; // machine-readable error code
  message: string; // human-readable explanation
  actual?: unknown;
  expected?: unknown;
}
```

### Demo Loader

Provides **one** hardcoded `Scenario` for the payment double-charge demo:

- Topology: Client → API Gateway → Payment Service → Bank.
- Failure: duplicate request on Gateway → Payment Service (probability 1.0, count 2).
- Side-effect: "charge" on Bank.
- Invariant: max side-effect count ("charge" ≤ 1).
- Fixed seed.

The user runs the demo, observes failure, toggles idempotency on Payment Service via the UI, and re-runs with the same seed.

---

## Metrics Module

Derives all metrics **solely** from the normalized event log. No hidden state.

```typescript
interface SimulationMetrics {
  totalRequests: number;
  failuresByType: Record<string, number>; // timeout, serviceError, circuitOpen
  p50Latency: number;
  p95Latency: number;
  p99Latency: number;
  duplicateDeliveries: number;
  deduplications: number;
  sideEffectCounts: Record<string, number>;
  totalEvents: number;
  simulatedDuration: number; // final event timestamp
}

function computeMetrics(log: SimEvent[]): SimulationMetrics;
```

Latency percentiles computed from `ResponseReceived` events where `late === false`.

---

## Invariant Evaluator

Runs after simulation, consuming the event log.

| Invariant Type         | Evaluation Logic                                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| Max side-effect count  | Count `SideEffect` events matching `effectName` ≤ N.                                                       |
| Max request count      | Count `RequestArrived` events on path (all deliveries) ≤ N.                                                |
| Required success count | Count `ResponseReceived` where `success === true && late === false && deduplicated === false` on path ≥ N. |
| Max completion time    | Final event timestamp ≤ T ms.                                                                              |
| No pending requests    | Every `RequestSent` has a corresponding `ResponseReceived` (any), `TimeoutError`, or `CircuitOpenError`.   |

```typescript
interface InvariantResult {
  invariantId: string;
  passed: boolean;
  actual: number;
  threshold: number;
  evidence: Array<{ sequence: number; timestamp: number; description: string }>;
}
```

---

## UI Layer

### Technology

| Component         | Technology                           | Rationale                                             |
| ----------------- | ------------------------------------ | ----------------------------------------------------- |
| Topology editor   | **React Flow**                       | Built-in node/edge editing, accessible, React-native. |
| Timeline          | **HTML/SVG** with virtualized rows   | Accessible to screen readers (unlike canvas).         |
| Event table       | **HTML table** (accessible fallback) | Keyboard-navigable, screen-reader compatible.         |
| Metrics           | React components                     | Simple data display.                                  |
| Invariant builder | Structured form (dropdowns + inputs) | Five built-in types only.                             |

### Accessibility (WCAG 2.1 AA)

- **No canvas-only views.** Timeline uses HTML/SVG; event table provides an equivalent accessible view.
- **Colour-independent indicators:** Events distinguished by shape, icon, and label — not colour alone.
- **Keyboard navigation:** Tab between services/paths in topology; arrow keys traverse edges; Enter inspects. Timeline rows focusable.
- **Reduced motion:** Respects `prefers-reduced-motion`. Graph layout transitions disabled when active.
- **Screen readers:** ARIA labels on timeline spans, graph nodes, and invariant results.

### ScenarioDraft → Scenario Boundary

The `ScenarioEditor` works with `ScenarioDraft`. A "Run Simulation" action triggers validation:

- If valid → produce `Scenario` → run engine.
- If invalid → display validation errors inline (no partial run).

---

## Data Flow

```
User edits ScenarioDraft (UI)
         │
         ▼ "Run"
   validate(draft) → Scenario | ValidationError[]
         │ valid
         ▼
   simulate(scenario) → EventLog
         │
    ┌────┴────────────┬──────────────┐
    │                  │              │
    ▼                  ▼              ▼
computeMetrics    evaluateInvariants   TimelineView
    │                  │
    ▼                  ▼
MetricsPanel      InvariantResults
```

---

## Key Design Decisions

| Decision                                       | Rationale                                                                                                        |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Synchronous main-thread simulation             | < 2 s for target workload; avoids async non-determinism. Web Workers out of scope for v1.                        |
| Single PRNG stream (xoshiro128**, Uint32Array) | Deterministic, fast, cross-browser identical with `Math.imul` + `>>> 0`.                                         |
| Generation-tracked circuit breakers            | Prevents stale in-flight responses from corrupting state after transitions.                                      |
| Errors not cached in idempotency registry      | Retries after transient errors get a fresh attempt — matches real-world retry semantics.                         |
| Late responses recorded, not cancelled         | Keeps the event queue simple (no cancellation); provides diagnostic value in timeline.                           |
| Multi-event pipeline (not single-pass)         | Each stage produces events at distinct timestamps; natural fit for discrete-event simulation.                    |
| ScenarioDraft / Scenario split                 | UI can hold invalid state without corrupting engine expectations.                                                |
| HTML/SVG timeline, not canvas                  | Accessible by default; screen readers can traverse elements.                                                     |
| maxSimulationTimeMs + 100K event cap           | Prevents infinite loops from misconfigured retries.                                                              |
| Two-pass atomic validation                     | Structured errors for every failure; no partial scenario construction.                                           |
| One demo scenario with UI toggle               | Simpler than two hardcoded variants; demonstrates the same seed producing different results when config changes. |

---

## Bundle Budget Estimate

| Dependency                       | Estimated gzip size |
| -------------------------------- | ------------------- |
| React + ReactDOM                 | ~45 KB              |
| React Flow                       | ~40 KB              |
| Ajv (tree-shaken, draft-07 only) | ~25 KB              |
| Engine + Invariants + Metrics    | ~10 KB              |
| UI components                    | ~40 KB              |
| **Total**                        | **~160 KB**         |

Well within the 500 KB gzip budget (NFR-4). Leaves headroom for future additions.

---

## Testing Strategy

### Unit Tests (Vitest)

| Module                 | Key Tests                                                                                                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prng`                 | Output matches published xoshiro128** reference vectors. Seeding produces expected state. `nextFloat` ∈ [0,1). `nextRange` within bounds.                                        |
| `event-loop`           | FIFO ordering at same timestamp. Terminates on empty queue, time limit, event limit. `SimulationStopped` emitted.                                                                |
| `failure-pipeline`     | Each transition (T1–T4) tested in isolation with known inputs/outputs.                                                                                                           |
| `circuit-breaker`      | State transitions: closed→open at threshold, open→half-open after cooldown, half-open→closed on success, half-open→open on failure. Generation tracking ignores stale responses. |
| `retry-scheduler`      | `computeDelay` matches formula. Cap at 2³¹−1. Zero retries = no retry. Circuit-open not retried.                                                                                 |
| `idempotency-registry` | Cache hit returns stored response. Miss stores. Errors not cached. Scope is (dest, op, key).                                                                                     |
| `metrics`              | Correct counts, percentiles, and durations from crafted event logs.                                                                                                              |
| `schema-validator`     | Each invalid case (bad version, missing refs, self-loop, out-of-range, duplicate IDs) returns correct `ValidationError`. Valid input passes.                                     |
| `invariant-evaluator`  | Each of 5 invariant types: pass case, fail case, evidence correctness. Late responses excluded from success counts.                                                              |

### Property Tests (fast-check)

| Property       | Description                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------------- |
| Determinism    | Any arbitrary valid scenario run twice with same seed → identical normalized event sequences.      |
| Backoff bounds | `computeDelay(n, config, prng) ≥ config.baseDelay` and `≤ 2^31 - 1` for all n ∈ [0, 50].           |
| Circuit safety | Circuit breaker never permits > 1 request in half-open state.                                      |
| Event ordering | All events in log satisfy `sequence[i] < sequence[i+1]` and `timestamp[i] <= timestamp[i+1]`.      |
| Idempotency    | With idempotency enabled, side-effect count for an operation ≤ 1 regardless of duplicates/retries. |
| Termination    | Simulation always terminates (event count ≤ 100,000).                                              |

### Golden-File Determinism Tests

- Known scenarios with fixed seeds produce event sequences committed to the repo as `.json` golden files.
- CI runs these in Node.js AND headless Chromium (via Playwright) and asserts identical output.
- Any change to event output requires explicit golden-file update (breaking change signal).

### End-to-End Tests (Playwright)

| Test                            | Coverage                                                                               |
| ------------------------------- | -------------------------------------------------------------------------------------- |
| Payment demo — no resilience    | Load demo → run → verify invariant failure displayed → timeline shows 2 charge events. |
| Payment demo — with idempotency | Toggle idempotency → re-run → verify invariant passes → timeline shows deduplication.  |
| Import invalid file             | Upload malformed JSON → verify error messages displayed.                               |
| Export and re-import            | Configure scenario → export → clear → import → run → same results.                     |
| Accessibility audit             | Axe-core integration on all views.                                                     |
| Keyboard navigation             | Tab through topology, timeline, and invariant builder without mouse.                   |

### Cross-Browser

- Playwright test matrix: Chromium, Firefox, WebKit.
- Golden-file determinism tests run in all three browsers.

### Coverage

- Vitest coverage plugin (`v8` provider).
- **90% branch coverage** enforced on `engine/` and `invariants/` directories.
- CI fails below threshold.

---

## Requirement-to-Component-and-Test Traceability

| Requirement                                                           | Component(s)                                              | Test Type                                                                             |
| --------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| US-1: Create/rename/delete services                                   | `ui/ScenarioEditor`, `scenario/schema-v1.json`            | Unit: schema validation. E2E: editor CRUD.                                            |
| US-1: No self-loops                                                   | `scenario/schema-validator`                               | Unit: reject self-loop. Import: file with self-loop rejected.                         |
| US-1: Caller deadline on path                                         | `scenario/schema-v1.json`, `engine/failure-pipeline` (T4) | Unit: timeout fires at deadline.                                                      |
| US-1: Operation name + side-effect                                    | `scenario/schema-v1.json`, `engine/failure-pipeline` (T2) | Unit: side-effect emitted for configured paths.                                       |
| US-1: Disconnected service warning                                    | `ui/TopologyGraph`                                        | E2E: warning icon shown.                                                              |
| US-1: 20 services/50 paths                                            | `engine/event-loop`                                       | Perf: benchmark completes under budget.                                               |
| US-2: Fixed/random latency                                            | `engine/failure-pipeline` (T1)                            | Unit: fixed adds exact ms. Property: random ∈ [min, max].                             |
| US-2: Lost response                                                   | `engine/failure-pipeline` (T3, T4)                        | Unit: response dropped, side-effects persist, caller times out, late response logged. |
| US-2: Simulated service error                                         | `engine/failure-pipeline` (T2)                            | Unit: error returned, not cached, triggers retry.                                     |
| US-2: Duplicate request                                               | `engine/failure-pipeline` (T1)                            | Unit: N-1 copies with same key, different deliveryIndex.                              |
| US-2: Probability range                                               | `scenario/schema-validator`                               | Unit: reject < 0 or > 1.                                                              |
| US-2: Pipeline order                                                  | `engine/failure-pipeline`                                 | Integration: stacked failures in correct order.                                       |
| US-3: Timeline swim lanes                                             | `ui/TimelineView`                                         | E2E: spans on correct lane.                                                           |
| US-3: Visual distinction                                              | `ui/TimelineView`                                         | E2E: icon/shape differs by type. Axe: colour-independent.                             |
| US-3: Hover metadata (inc. late flag)                                 | `ui/TimelineView`                                         | E2E: hover shows all fields.                                                          |
| US-3: Summary metrics                                                 | `metrics/computeMetrics`, `ui/MetricsPanel`               | Unit: correct from crafted log. E2E: displayed.                                       |
| US-3: 1,000 events usable                                             | `ui/TimelineView` (virtualized)                           | Perf: render 1,000 spans, interaction responsive.                                     |
| US-4: Idempotency key per operation                                   | `engine/idempotency-registry`                             | Unit: same key → cached. Different key → fresh.                                       |
| US-4: Errors not cached                                               | `engine/idempotency-registry`                             | Unit: error response not stored. Retry gets fresh roll.                               |
| US-4: Side-effect on success only                                     | `engine/failure-pipeline` (T2)                            | Unit: no SideEffect on dedup or error.                                                |
| US-4: Retry limit 0–50                                                | `engine/retry-scheduler`                                  | Unit: 0 = no retry. N = N attempts.                                                   |
| US-4: Only timeout/service-error retryable                            | `engine/retry-scheduler`                                  | Unit: circuit-open not retried.                                                       |
| US-4: Backoff formula + cap                                           | `engine/retry-scheduler`                                  | Unit: exact values. Property: ≥ baseDelay, ≤ 2³¹−1.                                   |
| US-4: Circuit breaker threshold                                       | `engine/circuit-breaker`                                  | Unit: transitions at threshold. Success resets.                                       |
| US-4: Generation tracking                                             | `engine/circuit-breaker`                                  | Unit: stale-generation responses ignored.                                             |
| US-4: Half-open probe (first by sequence)                             | `engine/circuit-breaker`                                  | Unit: only first request is probe; others rejected.                                   |
| US-4: Cooldown in logical time                                        | `engine/circuit-breaker`                                  | Unit: opens after cooldown elapses.                                                   |
| US-5: u32 seed                                                        | `engine/prng`, `scenario/schema-validator`                | Unit: range enforced. PRNG reproducible.                                              |
| US-5: Identical normalized event sequence                             | `engine/event-loop`                                       | Determinism: same-seed × 2 → deep-equal. Golden files.                                |
| US-5: Cross-environment determinism                                   | `engine/event-loop`, `engine/prng`                        | CI: Node + Chromium + Firefox + WebKit golden-file comparison.                        |
| US-5: Identity fields (operationId, attempt, deliveryIndex, sequence) | `engine/event-loop`, `engine/failure-pipeline`            | Unit: correct assignment per identity model.                                          |
| US-6: Max side-effect count                                           | `invariants/evaluator`                                    | Unit: pass/fail + evidence.                                                           |
| US-6: Max request count                                               | `invariants/evaluator`                                    | Unit: counts RequestArrived.                                                          |
| US-6: Required success count                                          | `invariants/evaluator`                                    | Unit: counts success && !late && !deduplicated.                                       |
| US-6: Max completion time                                             | `invariants/evaluator`                                    | Unit: final timestamp vs threshold.                                                   |
| US-6: No pending requests                                             | `invariants/evaluator`                                    | Unit: unresolved RequestSent → fail.                                                  |
| US-7: Schema v1 export                                                | `scenario/exporter`                                       | Unit: matches schema. Round-trip test.                                                |
| US-7: Atomic reject                                                   | `scenario/importer`, `scenario/schema-validator`          | Unit: each invalid case. No partial state.                                            |
| US-7: Referential integrity                                           | `scenario/schema-validator`                               | Unit: path → nonexistent service rejected.                                            |
| US-7: Duplicate IDs                                                   | `scenario/schema-validator`                               | Unit: rejected.                                                                       |
| US-7: Numeric ranges + maxSimulationTimeMs                            | `scenario/schema-validator`                               | Unit: out-of-range rejected.                                                          |
| US-7: Round-trip equality                                             | `scenario/exporter` + `scenario/importer`                 | Integration: export → import → re-export identical.                                   |
| US-8: Demo accessible                                                 | `ui/DemoLauncher`                                         | E2E: button visible, loads scenario.                                                  |
| US-8: Demo invariant fails                                            | `scenario/demo-loader` + engine + evaluator               | Integration: charge > 1.                                                              |
| US-8: Demo invariant passes with idempotency                          | Engine + evaluator (toggled scenario)                     | Integration: charge ≤ 1.                                                              |
| US-8: Fixed seed reproducible                                         | Engine + PRNG                                             | Determinism: golden-file for demo.                                                    |
| NFR-1: < 2 s, 100 in-flight × 3 retries                               | `engine/event-loop`                                       | Perf benchmark in CI (Node.js).                                                       |
| NFR-2: No non-deterministic APIs                                      | `engine/*`                                                | Lint rule (eslint no-restricted-globals). Property tests.                             |
| NFR-3: Client-side only                                               | Architecture                                              | No server code.                                                                       |
| NFR-4: ≤ 500 KB gzip                                                  | Build output                                              | CI: `vite build` → measure → fail if exceeded.                                        |
| NFR-5: WCAG 2.1 AA                                                    | `ui/*`                                                    | Playwright axe-core audit. Keyboard nav E2E. Reduced-motion.                          |
| NFR-6: Browser support                                                | All                                                       | Playwright matrix (Chromium, Firefox, WebKit).                                        |
| NFR-7: 90% branch coverage                                            | `engine/*`, `invariants/*`                                | CI coverage gate (Vitest v8 provider).                                                |
| NFR-8: Schema versioned                                               | `scenario/schema-v1.json`                                 | Unit: version field enforced.                                                         |
| NFR-9: Safety limits                                                  | `engine/event-loop`                                       | Unit: SimulationStopped at time/event limit.                                          |

---

## File Structure

```
src/
├── engine/
│   ├── event-loop.ts
│   ├── prng.ts
│   ├── failure-pipeline.ts
│   ├── circuit-breaker.ts
│   ├── retry-scheduler.ts
│   ├── idempotency-registry.ts
│   └── types.ts
├── scenario/
│   ├── schema-validator.ts
│   ├── importer.ts
│   ├── exporter.ts
│   ├── demo-loader.ts
│   ├── schema-v1.json
│   └── types.ts            (ScenarioDraft, Scenario, ValidationError)
├── metrics/
│   └── compute.ts
├── invariants/
│   ├── evaluator.ts
│   └── types.ts
├── ui/
│   ├── TopologyGraph.tsx
│   ├── TimelineView.tsx
│   ├── EventTable.tsx      (accessible fallback)
│   ├── MetricsPanel.tsx
│   ├── ScenarioEditor.tsx
│   ├── InvariantBuilder.tsx
│   ├── ImportExportControls.tsx
│   └── DemoLauncher.tsx
├── index.ts
test/
├── engine/
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
├── properties/
│   ├── determinism.prop.ts
│   ├── backoff.prop.ts
│   ├── circuit.prop.ts
│   └── termination.prop.ts
├── golden/
│   ├── payment-demo.json
│   └── complex-scenario.json
└── e2e/
    ├── payment-demo.spec.ts
    ├── import-export.spec.ts
    ├── accessibility.spec.ts
    └── keyboard-nav.spec.ts
```
