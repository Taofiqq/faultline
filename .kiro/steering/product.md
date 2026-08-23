# Product — Faultline

## Problem

Developers building distributed systems lack a fast, deterministic way to visualize how failures (latency, lost responses, timeouts, duplicates) cascade through service topologies and whether resilience patterns (retries, idempotency, circuit breakers) actually protect correctness.

## Target Users

- Backend and platform engineers designing retry/idempotency strategies.
- Educators teaching distributed-systems failure modes.
- Teams performing pre-production "what-if" analysis on service interactions.

## Value Proposition

Browser-based, zero-install, deterministic simulation. Model a topology, inject failures, enable resilience patterns, and replay the identical scenario to prove invariants like "a customer is charged at most once."

## Winning Demo

The built-in **Payment Double-Charge** scenario:

1. Load demo (Client → API Gateway → Payment Service → Bank).
2. Run — duplicate request causes two charges; invariant "charge ≤ 1" fails.
3. Toggle idempotency on Payment Service.
4. Re-run with same seed — invariant passes; timeline shows deduplication.

Time-to-insight: < 30 seconds from page load.

## Success Criteria

| Metric                 | Target                                                                         |
| ---------------------- | ------------------------------------------------------------------------------ |
| Simulation correctness | Same seed always produces identical normalized event sequence (cross-browser). |
| Performance            | 100 in-flight requests × 3 retries simulated in < 2 s (excluding render).      |
| Usability              | Payment demo completes in ≤ 3 user actions.                                    |
| Accessibility          | WCAG 2.1 AA; timeline keyboard-navigable; colour-independent indicators.       |
| Bundle                 | ≤ 500 KB gzip initial load.                                                    |
| Test coverage          | ≥ 90% branch on engine + invariants.                                           |

## Non-Goals (v1)

- Server-side components, auth, multi-user collaboration.
- Real network traffic or live-service integration.
- Custom scripting, plugin systems, or custom invariant expressions.
- Mobile-native apps.
- Cloud sync or persistent history.
- Chaos-engineering deployment to production.
