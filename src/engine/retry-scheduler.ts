/**
 * Retry Scheduler — exponential backoff with optional seeded jitter.
 *
 * Formula: baseDelay × 2^attempt × (1 + prng(0, jitterFactor))
 * Cap: 2^31 - 1 ms
 *
 * When jitterFactor === 0, no PRNG draw is consumed (purely deterministic).
 */

import type { PRNG } from './prng';
import type { RetryConfig } from '../scenario/types';

const MAX_DELAY = 0x7fffffff; // 2^31 - 1

/**
 * Compute the retry delay for a given attempt.
 * @param attempt 0-indexed (first retry = attempt 0)
 */
export function computeRetryDelay(attempt: number, config: RetryConfig, prng: PRNG): number {
  let jitter = 1;
  if (config.jitterFactor > 0) {
    jitter = 1 + prng.nextFloat() * config.jitterFactor;
  }
  // No PRNG draw when jitterFactor === 0

  const raw = config.baseDelay * Math.pow(2, attempt) * jitter;
  return Math.min(Math.round(raw), MAX_DELAY);
}
