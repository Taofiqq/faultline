import { describe, it, expect } from 'vitest';
import { createPRNG } from '../../src/engine/prng';

/**
 * Reference vectors generated from the canonical xoshiro128** 1.1 algorithm
 * by David Blackman and Sebastiano Vigna (https://prng.di.unimi.it/xoshiro128starstar.c).
 *
 * SplitMix32 is used to expand the u32 seed into a 4-word state, then
 * xoshiro128** is run to produce the output sequence.
 */

describe('PRNG (xoshiro128**)', () => {
  describe('seeding via SplitMix32', () => {
    it('seed=0 produces expected non-zero state', () => {
      const prng = createPRNG(0);
      // SplitMix32(0) → [3653269916, 2939563536, 2141751570, 3295091513]
      expect(prng.getState()).toEqual([3653269916, 2939563536, 2141751570, 3295091513]);
    });

    it('seed=42 produces expected state', () => {
      const prng = createPRNG(42);
      expect(prng.getState()).toEqual([144025891, 322543647, 3034809370, 908029994]);
    });

    it('seed=0 produces non-zero state (handles zero-seed edge case)', () => {
      const prng = createPRNG(0);
      const [s0, s1, s2, s3] = prng.getState();
      expect(s0 | s1 | s2 | s3).not.toBe(0);
    });

    it('seed=4294967295 (max u32) does not throw', () => {
      expect(() => createPRNG(4294967295)).not.toThrow();
    });

    it('rejects negative seed', () => {
      expect(() => createPRNG(-1)).toThrow(RangeError);
    });

    it('rejects seed > 2^32 - 1', () => {
      expect(() => createPRNG(4294967296)).toThrow(RangeError);
    });

    it('rejects non-integer seed', () => {
      expect(() => createPRNG(3.14)).toThrow(RangeError);
    });
  });

  describe('reference vectors (seed=42)', () => {
    // These vectors are produced by running xoshiro128** with
    // state initialized from SplitMix32(42) = [144025891, 322543647, 3034809370, 908029994]
    const expectedOutputs = [
      2425535280, 2112346342, 1431194834, 2444987418, 4027475985, 2044429801, 84073171, 3133034899,
      1414915361, 1457899092,
    ];

    it('first 10 outputs match reference', () => {
      const prng = createPRNG(42);
      const outputs: number[] = [];
      for (let i = 0; i < 10; i++) {
        outputs.push(prng.nextU32());
      }
      expect(outputs).toEqual(expectedOutputs);
    });

    it('re-seeding with same seed produces identical sequence', () => {
      const prng = createPRNG(42);
      const first = prng.nextU32();
      prng.seed(42);
      const second = prng.nextU32();
      expect(first).toBe(second);
    });

    it('different seeds produce different sequences', () => {
      const prng1 = createPRNG(42);
      const prng2 = createPRNG(43);
      const out1 = prng1.nextU32();
      const out2 = prng2.nextU32();
      expect(out1).not.toBe(out2);
    });
  });

  describe('nextFloat', () => {
    it('returns values in [0, 1)', () => {
      const prng = createPRNG(1);
      for (let i = 0; i < 1000; i++) {
        const f = prng.nextFloat();
        expect(f).toBeGreaterThanOrEqual(0);
        expect(f).toBeLessThan(1);
      }
    });

    it('is deterministic', () => {
      const prng1 = createPRNG(99);
      const prng2 = createPRNG(99);
      for (let i = 0; i < 100; i++) {
        expect(prng1.nextFloat()).toBe(prng2.nextFloat());
      }
    });
  });

  describe('nextRange', () => {
    it('returns values within [min, max]', () => {
      const prng = createPRNG(7);
      for (let i = 0; i < 1000; i++) {
        const r = prng.nextRange(5, 15);
        expect(r).toBeGreaterThanOrEqual(5);
        expect(r).toBeLessThanOrEqual(15);
        expect(Number.isInteger(r)).toBe(true);
      }
    });

    it('returns min when min === max', () => {
      const prng = createPRNG(0);
      expect(prng.nextRange(42, 42)).toBe(42);
    });

    it('is deterministic', () => {
      const prng1 = createPRNG(123);
      const prng2 = createPRNG(123);
      for (let i = 0; i < 100; i++) {
        expect(prng1.nextRange(0, 1000)).toBe(prng2.nextRange(0, 1000));
      }
    });

    it('handles large ranges (> 2^32)', () => {
      const prng = createPRNG(55);
      const r = prng.nextRange(0, Number.MAX_SAFE_INTEGER - 1);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER - 1);
    });

    it('throws on invalid range (min > max)', () => {
      const prng = createPRNG(0);
      expect(() => prng.nextRange(10, 5)).toThrow(RangeError);
    });

    it('throws on non-safe-integer min', () => {
      const prng = createPRNG(0);
      expect(() => prng.nextRange(1.5, 10)).toThrow(RangeError);
    });

    it('regression: range of size 2 does not infinite-loop', () => {
      const prng = createPRNG(77);
      for (let i = 0; i < 100; i++) {
        const r = prng.nextRange(0, 1);
        expect(r === 0 || r === 1).toBe(true);
      }
    });

    it('regression: range of size 4 does not infinite-loop', () => {
      const prng = createPRNG(88);
      for (let i = 0; i < 100; i++) {
        const r = prng.nextRange(0, 3);
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThanOrEqual(3);
      }
    });

    it('regression: range of size 8 does not infinite-loop', () => {
      const prng = createPRNG(99);
      for (let i = 0; i < 100; i++) {
        const r = prng.nextRange(0, 7);
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThanOrEqual(7);
      }
    });

    it('regression: range of size 256 does not infinite-loop', () => {
      const prng = createPRNG(111);
      for (let i = 0; i < 100; i++) {
        const r = prng.nextRange(0, 255);
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThanOrEqual(255);
      }
    });

    it('regression: range of size 2^32 (full u32 range) does not infinite-loop', () => {
      const prng = createPRNG(222);
      for (let i = 0; i < 100; i++) {
        const r = prng.nextRange(0, 0xffffffff);
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThanOrEqual(0xffffffff);
        expect(Number.isInteger(r)).toBe(true);
      }
    });
  });

  describe('state integrity (Uint32Array)', () => {
    it('all state values are unsigned 32-bit integers after many iterations', () => {
      const prng = createPRNG(0);
      for (let i = 0; i < 10000; i++) {
        prng.nextU32();
      }
      const state = prng.getState();
      for (const s of state) {
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(0xffffffff);
        expect(Number.isInteger(s)).toBe(true);
      }
    });

    it('output values are always unsigned 32-bit integers', () => {
      const prng = createPRNG(12345);
      for (let i = 0; i < 10000; i++) {
        const v = prng.nextU32();
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(0xffffffff);
      }
    });
  });
});
