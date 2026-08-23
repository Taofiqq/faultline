# Faultline Core — Requirements

## Overview

Faultline is a browser-based deterministic distributed-systems failure simulator. Users model services and request paths, inject failures, enable resilience patterns, and replay seeded scenarios to verify system invariants such as "a customer is charged at most once."

---

## Simulation Model

The engine is a **discrete-event simulator** driven by a logical clock measured in **simulated milliseconds** from scenario start.

- Events sharing a timestamp are processed **FIFO** using a monotonically increasing sequence number assigned at event creation.
- The **seed** (unsigned 32-bit integer) controls all random choices (latency jitter, failure probability). It does not influence tie-breaking.
- A `maxSimulationTimeMs` (default 60,000 ms) caps scenario duration. A fixed 100,000-event safety limit also applies. When either limit is reached, a `SimulationStopped` event is logged and the simulation terminates.
- No use of `Math.random()`, `Date.now()`, or any non-deterministic API during simulation.

### Failure Pipeline

Each request traverses this pipeline in order:

1. **Circuit check** — if the circuit breaker is open, return an immediate circuit-open error (non-retryable).
2. **Request scheduling / latency** — apply configured fixed or random latency to the outbound request.
3. **Network duplication** — if triggered (per probability and PRNG), create additional copies of the request sharing the same idempotency key and logical operation ID.
4. **Destination processing & idempotency check** — the destination processes the request; if the idempotency key has been seen, return the cached original response.
5. **Response scheduling / latency** — apply configured latency to the response.
6. **Response loss** — if triggered, the response is dropped; the destination's side-effects persist.
7. **Caller timeout & retry scheduling** — if no response arrives before the caller's deadline, the caller observes a timeout error and schedules a retry (if budget remains).

---

## User Stories

### US-1: Model Services

**As a** user
**I want to** define a topology of named services and directed request paths between them
**So that** I can represent the architecture I want to simulate.

**Acceptance Criteria:**

- [ ] User can create, rename, and delete services.
- [ ] User can define directed request paths between any two distinct services (self-loops are disallowed).
- [ ] A request path specifies: source service, destination service, label, caller deadline (ms), operation name, and an optional named side-effect.
- [ ] Disconnected services (no paths) are permitted; the UI shows a warning icon.
- [ ] The topology is displayed as an interactive graph in the browser.
- [ ] At least 20 services and 50 request paths are supported without degradation.

---

### US-2: Inject Failures

**As a** user
**I want to** inject latency, lost responses, timeouts, and duplicate requests on any request path
**So that** I can simulate real-world distributed-systems failures.

**Acceptance Criteria:**

- [ ] User can add one or more failure injections to any request path.
- [ ] Supported failure types:
  - Fixed latency (ms, ≥ 0).
  - Random latency (min/max ms, min ≥ 0, max ≥ min); sampled from seeded PRNG.
  - Lost response — response is dropped; destination side-effects persist; caller observes timeout after its deadline. A late response (arriving after the caller has timed out) is recorded in the event log but ignored by the caller; it does not affect circuit-breaker state or success-count invariants.
  - Simulated service error — destination returns an error response.
  - Duplicate request (count ≥ 2) — network-level copies sharing the same idempotency key.
- [ ] Each injection has a probability ∈ [0, 1] evaluated per request via the seeded PRNG.
- [ ] Multiple failure types can be stacked; they apply in the pipeline order defined above.
- [ ] Failures are deterministic given the same seed.

---

### US-3: Observe Timelines and Metrics

**As a** user
**I want to** see a timeline visualisation of every request and response as the scenario executes
**So that** I can understand causality and diagnose failures.

**Acceptance Criteria:**

- [ ] A timeline view shows each request/response as a horizontal span on a per-service swim lane.
- [ ] Timestamps are simulated milliseconds from scenario start.
- [ ] Failed, timed-out, duplicated, and deduplicated requests are visually distinct (colour/icon).
- [ ] Hovering a span shows: simulated start/end time, latency, failure type, attempt number, delivery index, idempotency key, late flag.
- [ ] Summary metrics after execution: total requests, failures by type, p50/p95/p99 latency, duplicate deliveries, deduplications.
- [ ] The timeline remains scrollable and usable with up to 1,000 events.

---

### US-4: Enable Resilience Patterns

**As a** user
**I want to** enable idempotency, retry limits, exponential backoff, and circuit breakers on paths
**So that** I can test whether resilience patterns preserve invariants under failure.

**Acceptance Criteria:**

#### Idempotency

- [ ] One idempotency key is generated per logical operation.
- [ ] Retries and network duplicates of the same operation reuse the key.
- [ ] Deduplication is scoped to (destination service, operation, key).
- [ ] A deduplicated request returns the cached original response (not an error).
- [ ] Keys remain valid for the entire scenario duration (no TTL in v1).
- [ ] Deduplication applies only to successful processed responses. Service errors are not cached; a retried request after an error gets a fresh processing attempt.
- [ ] Side-effects are emitted only for successful, non-deduplicated processing.

#### Retries

- [ ] User sets max retries (0–50) on a path. Zero means no retries; N means up to N additional attempts after the original.
- [ ] Retries are initiated by the calling (source) service.
- [ ] Only timeout errors and simulated service errors are retryable.
- [ ] Circuit-open errors are **not** retryable and do not consume retry budget.
- [ ] Network-duplicate injections are independent of retries.

#### Exponential Backoff

- [ ] User configures base delay (ms, > 0) and optional jitter factor ∈ [0, 1].
- [ ] Delay for attempt `n` (0-indexed): `baseDelay × 2^n × (1 + prng(0, jitterFactor))`.
- [ ] Jitter is derived from the seeded PRNG; with jitter factor 0 the backoff is purely deterministic powers-of-two.

#### Circuit Breaker

- [ ] Configured per request path with: failure threshold (consecutive failures), cooldown (ms, simulated time), half-open probe count (always 1 in v1).
- [ ] Timeouts and simulated service errors count as failures; successes reset the counter.
- [ ] After threshold consecutive failures the circuit opens for the cooldown duration.
- [ ] After cooldown, one half-open probe is permitted. Success closes the circuit; failure reopens it for another cooldown.
- [ ] A request against an open circuit returns an immediate circuit-open error (non-retryable).

#### Determinism

- [ ] All resilience patterns produce identical behaviour given the same seed.

---

### US-5: Deterministic Seeded Replay

**As a** user
**I want to** assign a seed to a scenario and replay it for identical results every time
**So that** I can verify invariants reproducibly.

**Acceptance Criteria:**

- [ ] User can set or auto-generate an unsigned 32-bit integer seed (0 – 4,294,967,295).
- [ ] Running the same scenario with the same seed produces an identical **normalized event sequence** and identical metrics.
- [ ] "Identical" means the same ordered list of (timestamp, sequence, event-type, source, destination, metadata) tuples — not byte-level serialization.
- [ ] Each event carries a globally unique sequence number (canonical event ID), an operationId (deterministic counter), an attempt index, and (for network duplicates) a deliveryIndex.
- [ ] Changing the seed produces a statistically different execution.
- [ ] Determinism holds regardless of browser, OS, or host clock.

---

### US-6: Define and Verify Invariants

**As a** user
**I want to** define invariants on a scenario and have the simulator report pass/fail
**So that** I can confirm resilience patterns protect correctness.

**Acceptance Criteria:**

- [ ] User can add invariants to a scenario using a structured rule builder.
- [ ] Built-in invariant types (v1, exhaustive):
  - **Max side-effect count** — a named side-effect occurs at most N times (e.g., "charge ≤ 1").
  - **Max request count** — a path receives at most N requests.
  - **Required success count** — a path completes successfully at least N times.
  - **Max completion time** — scenario completes within T simulated ms.
  - **No pending requests** — all requests are resolved (no deadlocks/hangs) by scenario end.
- [ ] Custom expression syntax is out of scope for v1.
- [ ] After execution, invariants report pass/fail with evidence: violating event IDs, timestamps, and counts.
- [ ] The payment demo (US-8) uses "max side-effect count: charge ≤ 1."

---

### US-7: Scenario Import/Export

**As a** user
**I want to** export a scenario to a portable JSON file and import it later or share it
**So that** scenarios are reproducible outside my session.

**Acceptance Criteria:**

- [ ] Export produces a single JSON file conforming to a documented **schema version 1**.
- [ ] Import validates the file and rejects unsupported schema versions or invalid input **atomically** with actionable error messages.
- [ ] Validation includes: JSON Schema structure, referential integrity (path references valid service IDs), no duplicate IDs, numeric ranges (probability ∈ [0,1], latency ≥ 0, retry ∈ [0,50], seed ∈ [0, 2³²−1], maxSimulationTimeMs > 0).
- [ ] Round-trip: export then import produces an identical scenario (verified by replaying with same seed and comparing normalized event sequences).
- [ ] Export is a file download; persistent scenario history is out of scope.
- [ ] File size < 1 MB for scenarios with up to 50 services and 200 paths.

---

### US-8: Built-in Payment Double-Charge Demonstration

**As a** user
**I want** a pre-loaded "Payment Double-Charge" demo scenario
**So that** I can immediately see how duplicate requests cause a double charge and how idempotency prevents it.

**Acceptance Criteria:**

- [ ] The demo is accessible from the home screen without user configuration.
- [ ] Topology: Client → API Gateway → Payment Service → Bank.
- [ ] Injected failure: duplicate request on API Gateway → Payment Service (probability 1.0, count 2).
- [ ] Invariant: "max side-effect count: charge ≤ 1."
- [ ] First run (no resilience): invariant fails; timeline shows two charge side-effects at Bank.
- [ ] Second run (idempotency enabled on Payment Service): invariant passes; timeline shows deduplication.
- [ ] Seed is fixed so the demo is byte-for-byte reproducible.

---

## Non-Functional Requirements

| ID | Category | Requirement |
|----|----------|-------------|
| NFR-1 | Performance | 100 concurrently in-flight requests, each with up to 3 retries, simulated in < 2 s excluding rendering (baseline: 4-core / 8 GB modern desktop, no CPU throttling). |
| NFR-2 | Determinism | All randomness derived from a seedable PRNG (unsigned 32-bit seed). No non-deterministic APIs during simulation. |
| NFR-3 | Portability | Runs entirely client-side; no server component for core simulation. |
| NFR-4 | Bundle Size | Initial JavaScript bundle ≤ 500 KB gzipped, excluding source maps. |
| NFR-5 | Accessibility | UI meets WCAG 2.1 AA; timeline and graph are keyboard-navigable with screen-reader descriptions. |
| NFR-6 | Browser Support | Latest two major versions of Chrome, Firefox, Safari, and Edge. |
| NFR-7 | Testability | Core simulation engine unit-testable independent of UI; ≥ 90 % branch coverage target. |
| NFR-8 | Schema | Exported JSON uses schema version 1 (semver). Only version 1 is supported in v1; future breaking changes increment the major version. |
| NFR-9 | Safety Limits | Simulation stops at maxSimulationTimeMs (default 60,000) or 100,000 events, whichever comes first. |

---

## Out of Scope (v1)

- Backend/server-side components (database, authentication, multi-user collaboration).
- Real network traffic generation or integration with live services.
- Custom scripting language or plugin system for user-defined failure types.
- Custom invariant expression syntax beyond the built-in types.
- Mobile-native applications (responsive web is acceptable).
- Historical scenario storage or cloud sync.
- Configurable idempotency-key TTL.
- Self-loop request paths.
- Performance profiling or flame-graph tooling.
- Formal verification or model checking beyond runtime invariant evaluation.
- Chaos-engineering agent deployment to production systems.
