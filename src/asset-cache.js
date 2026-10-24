/** An LRU budget for decoded assets; active scenes retain their own references. */
export class AssetCache {
  constructor({ maxEntries = 64, maxBytes = 24 * 1024 * 1024 } = {}) {
    this.maxEntries = maxEntries; this.maxBytes = maxBytes;
    this.entries = new Map(); this.pending = new Map(); this.bytes = 0;
  }
  async load(key, loader) {
    if (this.entries.has(key)) {
      const entry = this.entries.get(key); this.entries.delete(key); this.entries.set(key, entry); return entry.value;
    }
    if (this.pending.has(key)) return this.pending.get(key);
    const job = Promise.resolve().then(loader).then(value => {
      // Account conservatively for JSON strings and decoded object overhead.
      const bytes = JSON.stringify(value)?.length * 4 || 0;
      if (bytes <= this.maxBytes) {
        this.entries.set(key, { value, bytes }); this.bytes += bytes;
        while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
          const oldest = this.entries.keys().next().value;
          this.bytes -= this.entries.get(oldest).bytes; this.entries.delete(oldest);
        }
      }
      return value;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, job); return job;
  }
}
