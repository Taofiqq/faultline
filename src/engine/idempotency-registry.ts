/**
 * Idempotency Registry — success-only response cache.
 *
 * - Key: `${destinationId}:${operationName}:${idempotencyKey}`
 * - Only successful responses are cached.
 * - Service errors are NOT cached.
 * - No TTL (keys live for the scenario run).
 */

export interface CachedResponse {
  success: true;
}

export class IdempotencyRegistry {
  private cache = new Map<string, CachedResponse>();

  /**
   * Build the dedup key scoped to (destination, operation, idempotencyKey).
   */
  static buildKey(destinationId: string, operationName: string, idempotencyKey: string): string {
    return `${destinationId}:${operationName}:${idempotencyKey}`;
  }

  /**
   * Check if a response is cached for this key.
   */
  lookup(key: string): CachedResponse | null {
    return this.cache.get(key) ?? null;
  }

  /**
   * Store a successful response for this key.
   */
  store(key: string, response: CachedResponse): void {
    this.cache.set(key, response);
  }

  /**
   * Number of cached entries (for testing).
   */
  get size(): number {
    return this.cache.size;
  }
}
