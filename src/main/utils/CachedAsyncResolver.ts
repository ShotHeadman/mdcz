/**
 * Generic cached async resolver for deduplicating concurrent requests
 * and caching results
 */

export class CachedAsyncResolver<TKey, TValue> {
  private cache = new Map<TKey, TValue>();
  private pending = new Map<TKey, Promise<TValue>>();

  /**
   * Resolves a value for the given key, using cache if available,
   * or deduplicating concurrent requests for the same key
   *
   * @param key - The key to resolve
   * @param resolver - Function to resolve the value if not cached
   * @returns The resolved value
   */
  async resolve(key: TKey, resolver: (key: TKey) => Promise<TValue>): Promise<TValue> {
    // Check cache first
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    // Check if already pending
    const pending = this.pending.get(key);
    if (pending) {
      return pending;
    }

    // Create new pending request
    const promise = resolver(key);
    this.pending.set(key, promise);

    try {
      const value = await promise;
      this.cache.set(key, value);
      return value;
    } finally {
      this.pending.delete(key);
    }
  }

  /**
   * Clears the entire cache
   */
  clear(): void {
    this.cache.clear();
    this.pending.clear();
  }
}
