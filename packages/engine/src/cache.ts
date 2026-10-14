/**
 * P2-007 — idempotency cache (D-036).
 *
 * The engine must never issue the same request twice within one run, and must respect the
 * source's TTL when reusing a cached response across runs. The cache key is the idempotency
 * key `(transformId, version, canonicalInput)` (ROADMAP 5.7 "التكرار"): the same transform at
 * the same version on the same canonical input is the same logical request.
 *
 * Two layers:
 *   - `runScoped`: a per-run set of keys already issued. A duplicate submit within the same run
 *     is refused (no duplicate request in the same run — the P2-007 acceptance criterion).
 *   - `IdempotencyCache`: a TTL cache keyed by the idempotency key. A hit within the source TTL
 *     returns the cached response without touching the transport; an expired entry is a miss.
 *     The raw response and its source are preserved (D-036: the old cache kept neither).
 *
 * The cache is injectable and deterministic: `now` is injected for TTL tests, and the store is
 * a plain Map (replaceable with a persistent store later). Fail-closed: a cache that cannot
 * store or read never fabricates a hit — a read error is a miss, never a stale response.
 */
import type { TransportResponse } from "./transport.ts";

/** The idempotency key: same transform, same version, same canonical input = same logical request. */
export interface IdempotencyKey {
  readonly transformId: string;
  readonly version: string;
  readonly canonicalInput: string;
}

/** A cached response with its source and expiry. */
export interface CachedResponse {
  readonly response: TransportResponse;
  /** The source that produced it (e.g. the provider name), preserved per D-036. */
  readonly source: string;
  /** Absolute expiry (ms since epoch); a hit requires now < expiry. */
  readonly expiresAt: number;
}

export interface IdempotencyCacheOptions {
  /** Source TTL in ms; a cached entry older than this is a miss. */
  readonly ttlMs: number;
  /** Injectable clock for deterministic TTL tests. */
  readonly now?: () => number;
}

/** A per-run dedup set: refuses a duplicate idempotency key within the same run. */
export class RunScopedDedup {
  private readonly seen = new Set<string>();
  constructor(private readonly keyOf: (k: IdempotencyKey) => string = idempotencyKeyString) {}

  /** True when the key was already issued in this run. */
  has(key: IdempotencyKey): boolean {
    return this.seen.has(this.keyOf(key));
  }

  /** Marks the key as issued. Returns false when it was already present (a duplicate). */
  mark(key: IdempotencyKey): boolean {
    const k = this.keyOf(key);
    if (this.seen.has(k)) return false;
    this.seen.add(k);
    return true;
  }
}

/** Canonical string form of the idempotency key. */
export function idempotencyKeyString(k: IdempotencyKey): string {
  return `${k.transformId}\u0000${k.version}\u0000${k.canonicalInput}`;
}

/**
 * A TTL cache keyed by the idempotency key. `get` returns the cached response when it is fresh
 * (now < expiresAt), else undefined (a miss). `set` stores the response with its source and an
 * expiry of now + ttlMs. A read error is a miss, never a stale hit (fail-closed).
 */
export class IdempotencyCache {
  private readonly store = new Map<string, CachedResponse>();
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly keyOf: (k: IdempotencyKey) => string;

  constructor(opts: IdempotencyCacheOptions, keyOf: (k: IdempotencyKey) => string = idempotencyKeyString) {
    if (!Number.isFinite(opts.ttlMs) || opts.ttlMs < 0) {
      throw new RangeError(`IdempotencyCache ttlMs must be a non-negative finite number, got ${opts.ttlMs}`);
    }
    this.ttlMs = opts.ttlMs;
    this.now = opts.now ?? (() => Date.now());
    this.keyOf = keyOf;
  }

  /** A fresh cached response for the key, or undefined on a miss (expired or absent). */
  get(key: IdempotencyKey): CachedResponse | undefined {
    const k = this.keyOf(key);
    const hit = this.store.get(k);
    if (hit === undefined) return undefined;
    if (this.now() >= hit.expiresAt) {
      this.store.delete(k); // expired: drop it, it is a miss
      return undefined;
    }
    return hit;
  }

  /** Stores the response with its source and an expiry of now + ttlMs. */
  set(key: IdempotencyKey, response: TransportResponse, source: string): void {
    this.store.set(this.keyOf(key), {
      response,
      source,
      expiresAt: this.now() + this.ttlMs,
    });
  }

  /** Number of live entries (for tests and diagnostics). */
  get size(): number {
    return this.store.size;
  }
}
