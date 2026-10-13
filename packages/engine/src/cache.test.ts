import { describe, expect, it } from "vitest";
import { IdempotencyCache, RunScopedDedup, idempotencyKeyString } from "./cache.ts";

const key = (
  transformId = "tr-dns",
  version = "1.0.0",
  canonicalInput = "example.com",
): {
  transformId: string;
  version: string;
  canonicalInput: string;
} => ({ transformId, version, canonicalInput });

const resp = (body: string): { status: number; body: string } => ({ status: 200, body });

function fakeNow() {
  let t = 0;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("idempotency key (P2-007)", () => {
  it("the key is (transformId, version, canonicalInput) — distinct on each part", () => {
    const a = idempotencyKeyString(key("tr-dns", "1.0.0", "example.com"));
    expect(a).toBe(idempotencyKeyString(key("tr-dns", "1.0.0", "example.com")));
    expect(a).not.toBe(idempotencyKeyString(key("tr-whois", "1.0.0", "example.com")));
    expect(a).not.toBe(idempotencyKeyString(key("tr-dns", "2.0.0", "example.com")));
    expect(a).not.toBe(idempotencyKeyString(key("tr-dns", "1.0.0", "other.com")));
  });
});

describe("RunScopedDedup (P2-007)", () => {
  it("marks a key once and refuses a duplicate within the same run", () => {
    const d = new RunScopedDedup();
    const k = key();
    expect(d.has(k)).toBe(false);
    expect(d.mark(k)).toBe(true);
    expect(d.has(k)).toBe(true);
    expect(d.mark(k)).toBe(false); // duplicate refused
  });

  it("distinct keys are independent", () => {
    const d = new RunScopedDedup();
    expect(d.mark(key("tr-dns", "1.0.0", "a.com"))).toBe(true);
    expect(d.mark(key("tr-dns", "1.0.0", "b.com"))).toBe(true);
    expect(d.mark(key("tr-dns", "2.0.0", "a.com"))).toBe(true);
  });
});

describe("IdempotencyCache (P2-007 / D-036)", () => {
  it("a fresh entry is a hit; the response and source are preserved (D-036)", () => {
    const t = fakeNow();
    const c = new IdempotencyCache({ ttlMs: 1000, now: t.now });
    c.set(key(), resp("ok"), "dns.google");
    const hit = c.get(key());
    expect(hit).toBeDefined();
    expect(hit?.response).toEqual({ status: 200, body: "ok" });
    expect(hit?.source).toBe("dns.google");
  });

  it("an absent key is a miss", () => {
    const c = new IdempotencyCache({ ttlMs: 1000 });
    expect(c.get(key())).toBeUndefined();
  });

  it("an expired entry is a miss and is dropped (source TTL respected)", () => {
    const t = fakeNow();
    const c = new IdempotencyCache({ ttlMs: 1000, now: t.now });
    c.set(key(), resp("ok"), "dns.google");
    expect(c.get(key())).toBeDefined();
    t.advance(1001);
    expect(c.get(key())).toBeUndefined();
    expect(c.size).toBe(0); // dropped, not kept stale
  });

  it("a hit within TTL is returned even after time passes (but before expiry)", () => {
    const t = fakeNow();
    const c = new IdempotencyCache({ ttlMs: 5000, now: t.now });
    c.set(key(), resp("ok"), "dns.google");
    t.advance(4999);
    expect(c.get(key())?.response.body).toBe("ok");
  });

  it("distinct keys do not collide", () => {
    const c = new IdempotencyCache({ ttlMs: 1000 });
    c.set(key("tr-dns", "1.0.0", "a.com"), resp("a"), "s1");
    c.set(key("tr-dns", "1.0.0", "b.com"), resp("b"), "s2");
    expect(c.get(key("tr-dns", "1.0.0", "a.com"))?.response.body).toBe("a");
    expect(c.get(key("tr-dns", "1.0.0", "b.com"))?.response.body).toBe("b");
  });

  it("rejects an invalid TTL (fail-closed)", () => {
    expect(() => new IdempotencyCache({ ttlMs: -1 })).toThrow(RangeError);
    expect(() => new IdempotencyCache({ ttlMs: Number.NaN })).toThrow(RangeError);
  });
});
