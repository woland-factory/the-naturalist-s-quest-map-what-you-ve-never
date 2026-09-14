// In-process TTL + LRU cache behind a tiny interface. EPIC 2 can swap the
// backing store (Redis, a DB table) without touching call sites, because
// every consumer talks to get/set only and every key comes from the
// builders below. Keep this interface small on purpose.

interface Entry<V> {
  value: V;
  expiresAt: number;
}

export interface Cache {
  get<V>(key: string): V | undefined;
  set<V>(key: string, value: V, ttlSeconds: number): void;
  has(key: string): boolean;
  delete(key: string): void;
  clear(): void;
  size(): number;
}

export function createCache(maxEntries: number, now: () => number = Date.now): Cache {
  // Map preserves insertion order, which we use for LRU: on read we move a
  // key to the newest position, on overflow we evict the oldest.
  const store = new Map<string, Entry<unknown>>();

  function evictIfNeeded() {
    while (store.size > maxEntries) {
      const oldest = store.keys().next().value;
      if (oldest === undefined) break;
      store.delete(oldest);
    }
  }

  return {
    get<V>(key: string): V | undefined {
      const entry = store.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= now()) {
        store.delete(key);
        return undefined;
      }
      // touch: move to newest position
      store.delete(key);
      store.set(key, entry);
      return entry.value as V;
    },
    set<V>(key: string, value: V, ttlSeconds: number): void {
      if (store.has(key)) store.delete(key);
      store.set(key, { value, expiresAt: now() + ttlSeconds * 1000 });
      evictIfNeeded();
    },
    has(key: string): boolean {
      const entry = store.get(key);
      if (!entry) return false;
      if (entry.expiresAt <= now()) {
        store.delete(key);
        return false;
      }
      return true;
    },
    delete(key: string): void {
      store.delete(key);
    },
    clear(): void {
      store.clear();
    },
    size(): number {
      return store.size;
    },
  };
}

// Key builders. The target-list key mirrors the plan's query_cache key
// (place_id, month, taxon_root_id, inat_user_id) so EPIC 2's persistent
// cache reuses it verbatim. EPIC 1 keys on login; swapping to iNat user id
// later is a one-line change here and nowhere else.
export function targetsKey(placeId: number, month: number, taxonRootId: number | undefined, login: string): string {
  return `targets:v1:${placeId}:${month}:${taxonRootId ?? "all"}:${login.toLowerCase()}`;
}

export function observersKey(taxonId: number, placeId: number, month: number): string {
  return `obs:v1:${taxonId}:${placeId}:${month}`;
}

export function userKey(login: string): string {
  return `user:v1:${login.toLowerCase()}`;
}

export function placeKey(q: string): string {
  return `place:v1:${q.trim().toLowerCase()}`;
}

export function placeDetailKey(placeId: number): string {
  return `placedetail:v1:${placeId}`;
}
