export class CachedAsyncResolver<TKey, TValue> {
  private cache = new Map<TKey, TValue>();
  private pending = new Map<TKey, Promise<TValue>>();

  async resolve(key: TKey, resolver: (key: TKey) => Promise<TValue>): Promise<TValue> {
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const pending = this.pending.get(key);
    if (pending) {
      return pending;
    }

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

  clear(): void {
    this.cache.clear();
    this.pending.clear();
  }
}
