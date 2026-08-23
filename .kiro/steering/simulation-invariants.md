# Simulation Invariants — Faultline Engine

These invariants are non-negotiable. Any code change to `src/engine/` must preserve all of them.

## Determinism Rules

1. **Single PRNG instance** (xoshiro128**, `Uint32Array(4)` state, `Math.imul` + `>>> 0`).
2. **All randomness** (failure probability, latency sampling, jitter) drawn from the PRNG in event-processing order.
3. **Same seed + same scenario = identical normalized event sequence** across runs, browsers, and OS.
4. **Normalized event sequence** = array of events sorted by `(timestamp, sequence)`. Deep-equality is the determinism contract — not byte serialization.

## Forbidden APIs Inside `src/engine/`

| API                                             | Reason                        |
| ----------------------------------------------- | ----------------------------- |
| `Math.random()`                                 | Non-deterministic             |
| `Date.now()` / `new Date()`                     | Wall-clock dependent          |
| `performance.now()`                             | Wall-clock dependent          |
| `setTimeout` / `setInterval` / `queueMicrotask` | Async scheduling              |
| `crypto.getRandomValues()`                      | Non-deterministic             |
| `Promise` / `async` / `await`                   | Non-deterministic ordering    |
| Any DOM API                                     | Browser-specific side-effects |

Enforced via ESLint `no-restricted-globals` / `no-restricted-syntax` rules.

## Identity Model

| Field           | Type     | Generation                                          | Scope                                                |
| --------------- | -------- | --------------------------------------------------- | ---------------------------------------------------- |
| `sequence`      | `number` | Global monotonic counter, +1 per event created      | Canonical unique event ID; used for tie-breaking     |
| `operationId`   | `number` | Deterministic counter, +1 per new logical operation | Shared across retries + network duplicates           |
| `attempt`       | `number` | 0 = original, +1 per retry                          | Shared across network duplicates of the same attempt |
| `deliveryIndex` | `number` | 0 = original delivery, 1..N-1 for duplicates        | Unique within an attempt                             |

## Event Ordering

- Event queue: min-heap keyed by `(timestamp, sequence)`.
- Events at the same timestamp processed **FIFO by sequence** (insertion order).
- The seed controls random choices only — never tie-breaking.
- Sequence is assigned at event creation, before queue insertion.

## Safety Limits

| Limit                 | Default | Behaviour                                                                |
| --------------------- | ------- | ------------------------------------------------------------------------ |
| `maxSimulationTimeMs` | 60,000  | Simulation stops; `SimulationStopped { reason: 'time-limit' }` emitted.  |
| Max events            | 100,000 | Simulation stops; `SimulationStopped { reason: 'event-limit' }` emitted. |

Both checked before processing each event. Whichever fires first terminates the run.

## Numeric Constraints

- All time values and counters are JavaScript `number` (IEEE 754 double).
- All values must stay ≤ `Number.MAX_SAFE_INTEGER` (2⁵³ − 1).
- Backoff delay capped at 2³¹ − 1 ms.
- Seed is unsigned 32-bit integer (0 – 4,294,967,295).
- No `BigInt` in v1.

## Late-Response Handling

- Timed-out responses remain in the queue (no cancellation).
- When dequeued: emitted as `ResponseReceived { late: true }`.
- Late responses do NOT update: caller state, circuit-breaker state, success-count invariants.

## Circuit-Breaker Generations

- Each open transition increments `generation`.
- Responses stamped with the generation at send-time.
- Responses from earlier generations are ignored (do not affect current circuit state).
- In half-open: first request by sequence after cooldown is the probe; all others get `CircuitOpenError`.

## Idempotency

- Only **successful** responses are cached.
- Service errors are **not** cached — retries get fresh processing (fresh PRNG roll).
- Side-effects emitted only for successful, non-deduplicated processing.
