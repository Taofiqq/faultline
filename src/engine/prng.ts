/**
 * xoshiro128** 1.1 — 32-bit all-purpose PRNG.
 *
 * Reference: David Blackman and Sebastiano Vigna (2018)
 * https://prng.di.unimi.it/xoshiro128starstar.c
 *
 * State stored in Uint32Array(4). All arithmetic uses Math.imul and >>> 0
 * to guarantee unsigned 32-bit correctness across all JavaScript engines.
 */

const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

/**
 * SplitMix32: Used to expand a single u32 seed into the 4-word state.
 * Guarantees non-zero state even when seed === 0.
 */
function splitmix32(seed: number): () => number {
  let z = (seed >>> 0) + 0x9e3779b9;
  return () => {
    z = (z + 0x9e3779b9) >>> 0;
    let t = z ^ (z >>> 16);
    t = Math.imul(t, 0x21f0aaad) >>> 0;
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97) >>> 0;
    t = t ^ (t >>> 15);
    return t >>> 0;
  };
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

export interface PRNG {
  /** Re-seed the PRNG from a u32 seed. */
  seed(value: number): void;

  /** Return the next u32 output. */
  nextU32(): number;

  /** Return a float in [0, 1). */
  nextFloat(): number;

  /** Return an integer in [min, max] inclusive. */
  nextRange(min: number, max: number): number;

  /** Get a snapshot of the current state (for debugging/testing). */
  getState(): [number, number, number, number];
}

export function createPRNG(initialSeed: number): PRNG {
  const s = new Uint32Array(4);

  function seedState(value: number): void {
    if (value < 0 || value > 0xffffffff || !Number.isInteger(value)) {
      throw new RangeError(`Seed must be an unsigned 32-bit integer, got: ${value}`);
    }
    const mix = splitmix32(value);
    s[0] = mix();
    s[1] = mix();
    s[2] = mix();
    s[3] = mix();

    // Safety: ensure state is not all-zero (should never happen with splitmix32, but guard)
    if (s[0] === 0 && s[1] === 0 && s[2] === 0 && s[3] === 0) {
      s[0] = 1;
    }
  }

  function nextU32(): number {
    // result = rotl(s[1] * 5, 7) * 9
    const result = Math.imul(rotl(Math.imul(s[1]!, 5) >>> 0, 7), 9) >>> 0;

    const t = (s[1]! << 9) >>> 0;

    s[2] = (s[2]! ^ s[0]!) >>> 0;
    s[3] = (s[3]! ^ s[1]!) >>> 0;
    s[1] = (s[1]! ^ s[2]!) >>> 0;
    s[0] = (s[0]! ^ s[3]!) >>> 0;

    s[2] = (s[2]! ^ t) >>> 0;
    s[3] = rotl(s[3]!, 11);

    return result;
  }

  function nextFloat(): number {
    // Divide by 2^32 to get [0, 1)
    return nextU32() / 0x100000000;
  }

  function nextRange(min: number, max: number): number {
    if (min > max) {
      throw new RangeError(`min (${min}) must be <= max (${max})`);
    }
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max)) {
      throw new RangeError('min and max must be safe integers');
    }
    if (min === max) return min;

    const range = max - min + 1;
    if (range > MAX_SAFE_INTEGER) {
      throw new RangeError('Range too large for safe integer arithmetic');
    }

    // For ranges that fit in 32 bits, use rejection sampling to avoid bias
    if (range <= 0x100000000) {
      const limit = 0x100000000 - (0x100000000 % range);
      let r: number;
      do {
        r = nextU32();
      } while (r >= limit);
      return min + (r % range);
    }

    // For larger ranges, combine two u32 values
    const hi = nextU32();
    const lo = nextU32();
    const combined = hi * 0x100000000 + lo;
    return min + (combined % range);
  }

  function getState(): [number, number, number, number] {
    return [s[0]!, s[1]!, s[2]!, s[3]!];
  }

  // Initialize
  seedState(initialSeed);

  return {
    seed: seedState,
    nextU32,
    nextFloat,
    nextRange,
    getState,
  };
}
