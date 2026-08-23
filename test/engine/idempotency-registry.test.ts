import { describe, it, expect } from 'vitest';
import { IdempotencyRegistry } from '../../src/engine/idempotency-registry';

describe('IdempotencyRegistry', () => {
  it('returns null for unknown keys', () => {
    const reg = new IdempotencyRegistry();
    expect(reg.lookup('dest:op:key-1')).toBeNull();
  });

  it('stores and retrieves a cached response', () => {
    const reg = new IdempotencyRegistry();
    const key = IdempotencyRegistry.buildKey('payment', 'charge', 'op-1');
    reg.store(key, { success: true });
    expect(reg.lookup(key)).toEqual({ success: true });
  });

  it('different keys do not collide', () => {
    const reg = new IdempotencyRegistry();
    const key1 = IdempotencyRegistry.buildKey('payment', 'charge', 'op-1');
    const key2 = IdempotencyRegistry.buildKey('payment', 'charge', 'op-2');
    reg.store(key1, { success: true });
    expect(reg.lookup(key1)).not.toBeNull();
    expect(reg.lookup(key2)).toBeNull();
  });

  it('scoping includes destination, operation, and idempotency key', () => {
    const reg = new IdempotencyRegistry();
    // Same key but different destination
    const k1 = IdempotencyRegistry.buildKey('dest-a', 'op', 'key');
    const k2 = IdempotencyRegistry.buildKey('dest-b', 'op', 'key');
    reg.store(k1, { success: true });
    expect(reg.lookup(k1)).not.toBeNull();
    expect(reg.lookup(k2)).toBeNull();
  });

  it('buildKey produces deterministic string', () => {
    const k1 = IdempotencyRegistry.buildKey('payment', 'charge', 'op-42');
    const k2 = IdempotencyRegistry.buildKey('payment', 'charge', 'op-42');
    expect(k1).toBe(k2);
    expect(k1).toBe('payment:charge:op-42');
  });

  it('size tracks entries', () => {
    const reg = new IdempotencyRegistry();
    expect(reg.size).toBe(0);
    reg.store('key-1', { success: true });
    expect(reg.size).toBe(1);
    reg.store('key-2', { success: true });
    expect(reg.size).toBe(2);
  });
});
