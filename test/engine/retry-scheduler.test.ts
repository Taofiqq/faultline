import { describe, it, expect } from 'vitest';
import { computeRetryDelay } from '../../src/engine/retry-scheduler';
import { createPRNG } from '../../src/engine/prng';

describe('computeRetryDelay', () => {
  it('with jitterFactor=0, does not consume a PRNG draw', () => {
    const prng = createPRNG(42);
    const stateBefore = prng.getState();
    const delay = computeRetryDelay(0, { maxRetries: 3, baseDelay: 100, jitterFactor: 0 }, prng);
    const stateAfter = prng.getState();
    expect(delay).toBe(100); // baseDelay * 2^0 * 1 = 100
    expect(stateAfter).toEqual(stateBefore); // No PRNG draw consumed
  });

  it('with jitterFactor=0, computes exact powers of two', () => {
    const prng = createPRNG(0);
    const config = { maxRetries: 5, baseDelay: 100, jitterFactor: 0 };
    expect(computeRetryDelay(0, config, prng)).toBe(100); // 100 * 1
    expect(computeRetryDelay(1, config, prng)).toBe(200); // 100 * 2
    expect(computeRetryDelay(2, config, prng)).toBe(400); // 100 * 4
    expect(computeRetryDelay(3, config, prng)).toBe(800); // 100 * 8
  });

  it('with jitterFactor > 0, consumes a PRNG draw', () => {
    const prng = createPRNG(42);
    const stateBefore = prng.getState();
    computeRetryDelay(0, { maxRetries: 3, baseDelay: 100, jitterFactor: 0.5 }, prng);
    const stateAfter = prng.getState();
    expect(stateAfter).not.toEqual(stateBefore);
  });

  it('with jitterFactor=1, delay is between baseDelay and 2*baseDelay for attempt 0', () => {
    const prng = createPRNG(99);
    const delay = computeRetryDelay(0, { maxRetries: 3, baseDelay: 100, jitterFactor: 1.0 }, prng);
    expect(delay).toBeGreaterThanOrEqual(100);
    expect(delay).toBeLessThanOrEqual(200);
  });

  it('caps delay at 2^31 - 1 for large attempts', () => {
    const prng = createPRNG(0);
    const delay = computeRetryDelay(40, { maxRetries: 50, baseDelay: 1000, jitterFactor: 0 }, prng);
    expect(delay).toBe(0x7fffffff); // 2^31 - 1
  });

  it('is deterministic with same seed and attempt', () => {
    const prng1 = createPRNG(77);
    const prng2 = createPRNG(77);
    const config = { maxRetries: 3, baseDelay: 200, jitterFactor: 0.3 };
    expect(computeRetryDelay(0, config, prng1)).toBe(computeRetryDelay(0, config, prng2));
  });
});
