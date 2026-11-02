/** A tiny TTL + LRU cache that also de-duplicates concurrent in-flight requests. */
export class TtlCache<V> {
  private readonly entries = new Map<string, { expires: number; value: Promise<V> }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 2_000,
  ) {}

  async getOrLoad(key: string, load: () => Promise<V>): Promise<V> {
    if (this.ttlMs <= 0) return load();
    const now = Date.now();
    const hit = this.entries.get(key);
    if (hit && hit.expires > now) {
      // Refresh LRU position.
      this.entries.delete(key);
      this.entries.set(key, hit);
      return hit.value;
    }
    const value = load();
    this.entries.set(key, { expires: now + this.ttlMs, value });
    this.evict();
    try {
      return await value;
    } catch (error) {
      if (this.entries.get(key)?.value === value) this.entries.delete(key);
      throw error;
    }
  }

  get size(): number {
    return this.entries.size;
  }

  private evict(): void {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}
