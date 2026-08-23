# Kiro-Assisted Development — Faultline

This document describes how **Kiro** (AI development assistant) was used throughout the Faultline project — from requirements capture through implementation and continuous verification.

---

## 1. Requirements → Design → Tasks → Implementation Workflow

Kiro's spec-driven workflow decomposes a product idea into a layered chain of artefacts, each building on the previous:

```
product.md (problem & success criteria)
    → requirements.md (user stories & NFRs)
        → design.md (architecture & algorithms)
            → steering files (invariants, tech rules, structure)
                → tasks.md (15 milestones with dependency chains)
                    → implementation (guided by hooks & agents)
```

### 1.1 Product Definition (`product.md`)

Defines the **problem space**, target users, value proposition, and measurable success criteria:

```markdown
## Problem

Developers building distributed systems lack a fast, deterministic way to
visualize how failures cascade through service topologies and whether
resilience patterns actually protect correctness.

## Success Criteria

| Metric                 | Target                                                   |
| ---------------------- | -------------------------------------------------------- |
| Simulation correctness | Same seed always produces identical normalized event seq |
| Performance            | 100 in-flight × 3 retries < 2 s                          |
| Bundle                 | ≤ 500 KB gzip                                            |
| Test coverage          | ≥ 90% branch on engine + invariants                      |
```

### 1.2 Requirements (`requirements.md`)

Eight user stories (US-1 through US-8) with detailed acceptance criteria, plus nine non-functional requirements (NFR-1 through NFR-9). Each acceptance criterion is traceable forward to specific tasks and tests.

### 1.3 Design (`design.md`)

Specifies the architecture, data models, identity system, PRNG algorithm, event pipeline stages, and component interfaces — all derived from requirements.

### 1.4 Steering Files

Long-lived documents that constrain every code change (see Section 2 below).

### 1.5 Tasks (`tasks.md`)

Breaks the full implementation into **15 milestones** containing **70+ tasks**, each with:

- Traceability tags (e.g., `[US-4 Retries AC-3, AC-4]`, `[NFR-2, simulation-invariants]`)
- Dependency declarations (e.g., `Deps: 5.1, 5.3`)
- Concrete verification criteria

Critical path:

```
M1 → M2 → M3 → M4 → M5 → M6 → M7 → M8
                                  ↓
M1 → M9 ────────────────────→ M10 → M11 → M12
                                        ↓
                              M13 (E2E needs M11; properties need M6)
                                        ↓
                                  M14 → M15
```

---

## 2. Steering Files

Steering files live in `.kiro/steering/` and act as **persistent constraints** that Kiro references on every code change. They are not disposable specs — they are active governance.

| File                       | Purpose                                                                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `product.md`               | Problem statement, users, value proposition, success metrics, non-goals. Prevents scope creep.                                                                                  |
| `tech.md`                  | Approved technology stack (React, Vite, Vitest, fast-check, Playwright, Ajv), dependency rules, bundle budget, architectural boundaries.                                        |
| `structure.md`             | Repository layout with module ownership and import boundaries. Enforces that `src/engine/` remains self-contained.                                                              |
| `simulation-invariants.md` | Non-negotiable engine contracts: determinism rules, forbidden APIs, identity model, event ordering, safety limits, circuit-breaker generations, idempotency semantics.          |
| `testing.md`               | Complete testing strategy: unit test coverage per module, property test descriptions, golden-file protocol, E2E scenarios, accessibility audit requirements, CI pipeline order. |

### How steering files guide development

When Kiro modifies any file in `src/engine/`, it checks work against `simulation-invariants.md`. For example:

- Writing `prng.ts`? Kiro ensures single PRNG instance, `Uint32Array(4)` state, `Math.imul` arithmetic.
- Adding retry logic? Kiro verifies the backoff cap is `2³¹ − 1`, not `2⁵³ − 1`.
- Touching `event-loop.ts`? Kiro confirms FIFO ordering by `(timestamp, sequence)`.

The steering files also prevent introducing forbidden patterns — any use of `Math.random()` or `async/await` in `src/engine/` violates `simulation-invariants.md` and triggers immediate correction.

---

## 3. Milestone 14: Engine Verification Hooks

Milestone 14 introduces automated engine verification via Kiro's **agent hook system**. When Kiro (or any agent using the `engine-verify` configuration) writes a file in `src/engine/`, two postToolUse hooks fire automatically.

### 3.1 Agent Configuration

`.kiro/agents/engine-verify.json`:

```json
{
  "name": "engine-verify",
  "description": "Engine verification agent — runs engine unit tests, property tests, and golden-file checks whenever src/engine/ files are modified.",
  "hooks": {
    "postToolUse": [
      {
        "matcher": "write",
        "command": ".kiro/hooks/engine-tests.sh",
        "timeout_ms": 120000
      },
      {
        "matcher": "write",
        "command": ".kiro/hooks/golden-check.sh",
        "timeout_ms": 60000
      }
    ]
  }
}
```

The `matcher: "write"` means these hooks trigger on every file-write tool invocation. The scripts themselves filter to only act on `src/engine/` changes.

### 3.2 Engine Tests Hook

`.kiro/hooks/engine-tests.sh`:

```bash
#!/bin/bash
# Kiro postToolUse hook: runs engine unit tests and property tests
# when a file in src/engine/ is written.
set -euo pipefail

EVENT=$(cat)

# Extract the file path from the write tool's input
FILE_PATH=$(echo "$EVENT" | grep -o '"path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"path"[[:space:]]*:[[:space:]]*"//;s/"$//')

# Normalize to relative path
CWD=$(echo "$EVENT" | grep -o '"cwd"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"cwd"[[:space:]]*:[[:space:]]*"//;s/"$//')
REL_PATH="$FILE_PATH"
if [ -n "$CWD" ] && [[ "$FILE_PATH" == "$CWD"* ]]; then
  REL_PATH="${FILE_PATH#$CWD/}"
fi

# Only run if the file is in src/engine/
if [[ "$REL_PATH" != src/engine/* ]]; then
  exit 0
fi

echo "╔══════════════════════════════════════════════════════════╗"
echo "║  ENGINE VERIFICATION: file changed → $REL_PATH"
echo "╚══════════════════════════════════════════════════════════╝"

cd "$CWD"
npx vitest run test/engine/ test/properties/ --reporter=verbose 2>&1 || RESULT=$?

if [ $RESULT -eq 0 ]; then
  echo "✅ ENGINE TESTS PASSED — all engine unit and property tests green."
else
  echo "❌ ENGINE TESTS FAILED — review output above for failures."
fi
```

This runs all unit tests (`test/engine/`) **and** all property tests (`test/properties/`) — catching both localized regressions and cross-cutting invariant violations.

### 3.3 Golden-File Check Hook

`.kiro/hooks/golden-check.sh`:

```bash
#!/bin/bash
# Kiro postToolUse hook: runs golden-file determinism tests
# when a file in src/engine/ is written.
set -euo pipefail

EVENT=$(cat)
FILE_PATH=$(echo "$EVENT" | grep -o '"path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"path"[[:space:]]*:[[:space:]]*"//;s/"$//')
CWD=$(echo "$EVENT" | grep -o '"cwd"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"cwd"[[:space:]]*:[[:space:]]*"//;s/"$//')
REL_PATH="$FILE_PATH"
if [ -n "$CWD" ] && [[ "$FILE_PATH" == "$CWD"* ]]; then
  REL_PATH="${FILE_PATH#$CWD/}"
fi

if [[ "$REL_PATH" != src/engine/* ]]; then
  exit 0
fi

echo "╔══════════════════════════════════════════════════════════╗"
echo "║  GOLDEN-FILE CHECK: file changed → $REL_PATH"
echo "╚══════════════════════════════════════════════════════════╝"

cd "$CWD"
npx vitest run test/golden/golden.test.ts --reporter=verbose 2>&1 || RESULT=$?

if [ $RESULT -eq 0 ]; then
  echo "✅ GOLDEN-FILE TESTS PASSED — deterministic output unchanged."
else
  echo "❌ GOLDEN-FILE TESTS FAILED — engine output has diverged from golden files."
  echo "   If intentional, regenerate with: npm run generate:golden"
fi
```

### 3.4 Feedback Loop

The hook output is injected into the agent's context, so Kiro immediately sees test failures and can fix them in the same turn — no manual intervention required. This creates a tight **write → verify → fix** loop:

1. Kiro writes `src/engine/circuit-breaker.ts`
2. Hook runs all engine + property tests → reports results
3. Hook runs golden-file comparison → reports results
4. If failures exist, Kiro reads the output and makes corrections
5. Next write triggers hooks again until green

---

## 4. Design Ambiguities and Bugs Kiro Helped Resolve

The intersection of determinism, distributed-system semantics, and browser portability produced numerous subtle design decisions. The steering files codify the resolutions.

### 4.1 Determinism: Single PRNG Stream

**Problem:** Multiple components need randomness (latency sampling, failure probability, jitter). If each maintained its own PRNG instance, the draw order would depend on initialization order, breaking determinism when topology changes.

**Resolution (from `simulation-invariants.md`):**

> **Single PRNG instance** (xoshiro128**, `Uint32Array(4)` state, `Math.imul` + `>>> 0`).
> **All randomness** drawn from the PRNG in event-processing order.

One PRNG, consumed in strict FIFO order by the event loop. The event-processing order is deterministic (min-heap keyed by timestamp + sequence), so the PRNG draw sequence is deterministic.

### 4.2 Event Ordering: FIFO via Sequence Counter

**Problem:** When two events share the same timestamp, what breaks the tie? Using random tie-breaking would make the simulation non-deterministic. Using insertion order alone is fragile if the heap implementation is unstable.

**Resolution:**

```
Event queue: min-heap keyed by (timestamp, sequence).
Events at the same timestamp processed FIFO by sequence (insertion order).
The seed controls random choices only — never tie-breaking.
Sequence is assigned at event creation, before queue insertion.
```

The global monotonic `sequence` counter guarantees a total order independent of PRNG state.

### 4.3 Circuit Breaker Generations

**Problem:** When a circuit breaker opens, in-flight requests from the previous "generation" will eventually return responses. Should those responses affect the breaker's state in the new generation?

**Resolution:**

> Each open transition increments `generation`.
> Responses stamped with the generation at send-time.
> Responses from earlier generations are ignored (do not affect current circuit state).
> In half-open: first request by sequence after cooldown is the probe.

This prevents stale success responses from prematurely closing a newly-opened breaker.

### 4.4 Idempotency: Success-Only Caching

**Problem:** Should error responses be cached? If yes, a transient failure would permanently poison the idempotency key.

**Resolution:**

> Only **successful** responses are cached.
> Service errors are **not** cached — retries get fresh processing (fresh PRNG roll).
> Side-effects emitted only for successful, non-deduplicated processing.

This matches real-world idempotency implementations (e.g., Stripe's).

### 4.5 Late Responses

**Problem:** When a caller times out and retries, the original response may still arrive later. Should it be silently dropped, or should it exist in the event log?

**Resolution:**

> Timed-out responses remain in the queue (no cancellation).
> When dequeued: emitted as `ResponseReceived { late: true }`.
> Late responses do NOT update: caller state, circuit-breaker state, success-count invariants.

Late responses are observable (for debugging) but inert (for correctness). This prevents non-deterministic state updates from racing responses.

### 4.6 Network Duplication Identity

**Problem:** How do you distinguish a retry from a network duplicate? Both arrive at the same destination with the same intent.

**Resolution (Identity Model):**

| Field           | Shared across...                                    | Distinguishes...                                |
| --------------- | --------------------------------------------------- | ----------------------------------------------- |
| `operationId`   | All retries and duplicates of one logical operation | Different logical operations                    |
| `attempt`       | Network duplicates of the same retry attempt        | Different retry attempts                        |
| `deliveryIndex` | Nothing — unique per copy                           | Individual network duplicates within an attempt |

```
operationId=1, attempt=0, deliveryIndex=0  → original request
operationId=1, attempt=0, deliveryIndex=1  → network duplicate of original
operationId=1, attempt=1, deliveryIndex=0  → first retry
```

### 4.7 Backoff Cap: 2³¹ − 1

**Problem:** Exponential backoff grows as `baseDelay × 2^n`. With 50 retries allowed, `2^50` overflows safe integer range.

**Resolution:**

> Backoff delay capped at 2³¹ − 1 ms (≈ 24.8 days simulated time).

This stays within 32-bit signed integer range, avoids floating-point precision loss in delay calculations, and is enforced by the property test:

```
// test/properties/backoff.prop.ts
// Property: delay ≥ baseDelay, ≤ 2³¹−1 for all n ∈ [0, 50]
```

### 4.8 Forbidden APIs: ESLint Enforcement

**Problem:** A single accidental `Math.random()` call deep in the engine breaks cross-browser determinism silently.

**Resolution (from task 1.2):**

> Configure ESLint with `no-restricted-globals` banning `Math.random`, `Date.now`,
> `performance.now`, `crypto.getRandomValues`, `setTimeout`, `setInterval` inside `src/engine/`.

Forbidden API table from `simulation-invariants.md`:

| API                                             | Reason                        |
| ----------------------------------------------- | ----------------------------- |
| `Math.random()`                                 | Non-deterministic             |
| `Date.now()` / `new Date()`                     | Wall-clock dependent          |
| `performance.now()`                             | Wall-clock dependent          |
| `setTimeout` / `setInterval` / `queueMicrotask` | Async scheduling              |
| `crypto.getRandomValues()`                      | Non-deterministic             |
| `Promise` / `async` / `await`                   | Non-deterministic ordering    |
| Any DOM API                                     | Browser-specific side-effects |

This is a compile-time gate — code review and tests are the backup, not the primary defense.

---

## 5. Requirement-to-Test Traceability

Every test in the project traces back to a specific requirement, and every requirement traces forward to at least one test.

### 5.1 Task-to-User-Story Mapping

Each task in `tasks.md` carries explicit traceability tags:

```markdown
- [x] **5.1** Implement retry scheduler: exponential backoff with PRNG jitter,
      cap at 2³¹−1. [US-4 Retries, US-4 Backoff, design.md §Retry Scheduler]
- [x] **5.2** Integrate retry into T4: schedule RetryScheduled → new RequestSent
      on timeout/service-error; circuit-open not retried. [US-4 Retries AC-3, AC-4]
- [x] **6.1** Implement network duplication in T1: fork N-1 copies with same
      idempotency key, shared attempt, distinct deliveryIndex. [US-2 duplicate]
- [x] **1.2** Configure ESLint banning Math.random, Date.now inside src/engine/.
      [NFR-2, simulation-invariants]
```

### 5.2 Test File → Source Module Mapping

From `testing.md`, each test file directly mirrors its source:

| Test File                                  | Source Module                        | Key Assertions                                               |
| ------------------------------------------ | ------------------------------------ | ------------------------------------------------------------ |
| `test/engine/prng.test.ts`                 | `src/engine/prng.ts`                 | Reference vectors, `nextFloat` ∈ [0,1), seed reproducibility |
| `test/engine/event-loop.test.ts`           | `src/engine/event-loop.ts`           | FIFO at same timestamp, termination, sequence monotonicity   |
| `test/engine/failure-pipeline.test.ts`     | `src/engine/failure-pipeline.ts`     | T1–T4 transitions in isolation                               |
| `test/engine/circuit-breaker.test.ts`      | `src/engine/circuit-breaker.ts`      | All state transitions, generation tracking, half-open probe  |
| `test/engine/retry-scheduler.test.ts`      | `src/engine/retry-scheduler.ts`      | Backoff formula, cap at 2³¹−1, zero retries = no event       |
| `test/engine/idempotency-registry.test.ts` | `src/engine/idempotency-registry.ts` | Cache hit/miss, errors not cached, scoping                   |
| `test/scenario/schema-validator.test.ts`   | `src/scenario/schema-validator.ts`   | Each invalid case returns correct `ValidationError`          |
| `test/metrics/compute.test.ts`             | `src/metrics/compute.ts`             | Counts, percentiles, late-response exclusion                 |
| `test/invariants/evaluator.test.ts`        | `src/invariants/evaluator.ts`        | 5 invariant types pass/fail with evidence                    |

### 5.3 Property Tests: Cross-Cutting Invariant Verification

Property tests don't map to a single module — they verify system-wide contracts:

| Property Test         | Invariant Verified                                                          | Requirement          |
| --------------------- | --------------------------------------------------------------------------- | -------------------- |
| `determinism.prop.ts` | Same seed × same scenario × 2 runs → identical normalized event sequence    | US-5, NFR-2          |
| `backoff.prop.ts`     | `computeDelay(n, config, prng)` ≥ baseDelay and ≤ 2³¹−1 for all n ∈ [0, 50] | US-4 Backoff         |
| `circuit.prop.ts`     | Never > 1 request in half-open state per generation                         | US-4 Circuit Breaker |
| `termination.prop.ts` | Simulation always terminates (event count ≤ 100,000)                        | NFR-9                |

### 5.4 Golden Files: Regression Anchors

Golden files serve as **committed contracts** for simulation output:

- `test/golden/payment-demo.json` — the normalized event sequence of the payment demo scenario
- `test/golden/complex-scenario.json` — multi-path scenario with retries + circuit breakers

Protocol:

1. CI runs each golden test in **Node.js AND headless Chromium** (and Firefox + WebKit)
2. Asserts deep-equality between `simulate()` output and committed JSON
3. Any divergence fails the build
4. Intentional changes require explicit golden-file regeneration (`npm run generate:golden`) and PR review

This catches silent determinism regressions that unit tests might miss — a changed PRNG draw order that still passes isolated tests but produces different global output.

### 5.5 E2E Tests: User Workflow Verification

End-to-end tests verify the **complete user journey**, not individual modules:

| E2E Test                | Workflow Verified                                                                             | Requirements   |
| ----------------------- | --------------------------------------------------------------------------------------------- | -------------- |
| `payment-demo.spec.ts`  | Load → run → invariant fails → toggle idempotency → re-run → passes → timeline shows dedup    | US-8 (all ACs) |
| `import-export.spec.ts` | Upload invalid JSON → errors shown → configure → export → clear → import → run → same results | US-7 AC-1–4    |
| `accessibility.spec.ts` | Axe-core audit on all views, colour contrast, ARIA labels                                     | NFR-5          |
| `keyboard-nav.spec.ts`  | Tab through topology, timeline, event table, invariant builder without mouse                  | NFR-5          |

### 5.6 Traceability Matrix (Summary)

```
US-1 (Model Services)     → Tasks 9.2–9.3   → Manual tests + e2e/keyboard-nav
US-2 (Inject Failures)    → Tasks 6.1–6.3   → unit/failure-pipeline + props/determinism
US-3 (Timelines/Metrics)  → Tasks 10.1–10.5 → unit/compute + e2e/payment-demo
US-4 (Resilience)         → Tasks 5.1–6.7   → unit/retry + unit/circuit + props/backoff + props/circuit
US-5 (Deterministic Seed) → Tasks 3.1–5.5   → unit/prng + props/determinism + golden files
US-6 (Invariants)         → Tasks 7.1–7.5   → unit/evaluator + e2e/payment-demo
US-7 (Import/Export)      → Tasks 2.1–8.3   → unit/schema-validator + e2e/import-export
US-8 (Payment Demo)       → Tasks 4.5, 11.1–11.2 → e2e/payment-demo

NFR-1 (Performance)       → Task 12.7       → Benchmark script
NFR-2 (Determinism)       → Tasks 1.2, 3.1  → ESLint rules + props/determinism + golden files
NFR-4 (Bundle)            → Task 1.7        → CI bundle check ≤ 500 KB
NFR-5 (Accessibility)     → Tasks 12.1–12.4 → e2e/accessibility + e2e/keyboard-nav
NFR-7 (Testability)       → Task 1.4        → ≥ 90% branch coverage gate
NFR-9 (Safety Limits)     → Task 3.5        → props/termination
```

---

## 6. Summary: How Kiro Shaped the Project

| Aspect               | Kiro's Contribution                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| **Specification**    | Generated layered artefacts (product → requirements → design → tasks) with explicit traceability  |
| **Architecture**     | Enforced via steering files — module boundaries, forbidden APIs, dependency rules                 |
| **Determinism**      | Codified as invariants; verified by property tests + golden files on every engine change          |
| **Testing**          | Comprehensive strategy defined upfront; hooks ensure tests run continuously during development    |
| **Automation**       | postToolUse hooks create instant feedback loops — no waiting for CI to catch regressions          |
| **Design decisions** | Steering files preserve resolutions to subtle distributed-systems ambiguities across all sessions |

The `.kiro/` directory is not just configuration — it's the project's **institutional memory**, ensuring consistent, high-quality implementation regardless of which session or context window is active.
