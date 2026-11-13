/** Tiny TTL cache with in-flight de-duplication (concurrent requests for the same key share one chain read). */
import "./guard";

interface Entry<T> { value?: T; expires: number; inflight?: Promise<T> }

export class TtlCache<T> {
  private m = new Map<string, Entry<T>>();
  constructor(private ttlMs: number, private max = 1000) {}

  async get(key: string, load: () => Promise<T>, now = Date.now()): Promise<{ value: T; cached: boolean }> {
    const e = this.m.get(key);
    if (e?.value !== undefined && e.expires > now) return { value: e.value, cached: true };
    if (e?.inflight) return { value: await e.inflight, cached: true };
    const inflight = load();
    this.m.set(key, { expires: 0, inflight });
    try {
      const value = await inflight;
      if (this.m.size > this.max) this.m.clear();
      this.m.set(key, { value, expires: Date.now() + this.ttlMs });
      return { value, cached: false };
    } catch (err) {
      this.m.delete(key);
      throw err;
    }
  }

  clear() {
    this.m.clear();
  }
}
