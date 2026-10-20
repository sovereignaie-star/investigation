import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiKeyManager } from "./apiKeyManager";
import { migrationComplete } from "../pages/settings/apiKeySettingsModel";

/**
 * P3-013: migrateLegacyKeys is now WIRED to the key-management surface, so its
 * behavior is part of UC-20's boundary. Three honest rules are proven here:
 *
 * 1. A legacy key whose provider is ALREADY configured in the vault is never
 *    silently overwritten by a mere read — the conflict is reported and the
 *    local copy is kept untouched (replacement stays an explicit manual save).
 * 2. A conflict is checked BEFORE any move: one conflict blocks the whole move,
 *    and the local copy is only ever REMOVED, never rewritten (P1-021: apps/web
 *    never writes browser storage). A partial PUT failure is reported per key
 *    (moved count + failed names) — there is NO all-or-nothing guarantee.
 * 3. A legacy key for an unconfigured provider moves to the vault and its
 *    local copy is removed.
 * 4. Unreadable (corrupt) legacy data is preserved, never destroyed.
 * 5. A failed HTTP response in test() is a failure — an error body (401/429)
 *    has no `tested` field and must never be reported as a successful
 *    «لم يُختبر» outcome.
 */

type FetchHandler = (url: string, init?: RequestInit) => { status: number; body: unknown };

/** A minimal localStorage for the Node test environment (the browser API is stubbed). */
function stubLocalStorage(): void {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => (store.has(k) ? String(store.get(k)) : null),
    setItem: (k: string, v: string) => store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
}

function stubFetch(handler: FetchHandler): { calls: Array<{ url: string; method: string; body?: string }> } {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : undefined });
      const r = handler(url, init);
      return {
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        json: async () => r.body,
      };
    }),
  );
  return { calls };
}

beforeEach(() => {
  stubLocalStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
  apiKeyManager.setAdminToken(null);
});

describe("migrateLegacyKeys (P3-013 — no silent overwrite, honest conflicts)", () => {
  it("moves a legacy key for an unconfigured provider and removes the local copy", async () => {
    localStorage.setItem("investigation_api_keys", JSON.stringify({ hunter: "legacy-hunter-key" }));
    const { calls } = stubFetch((url) => {
      if (url === "/api/vault") return { status: 200, body: { entries: [{ name: "hunter", configured: false, updatedAt: null }] } };
      return { status: 200, body: { name: "hunter", configured: true, updatedAt: "2026-10-20T00:00:00.000Z" } };
    });
    const report = await apiKeyManager.migrateLegacyKeys();
    expect(report.moved).toBe(1);
    expect(report.conflicts).toEqual([]);
    expect(report.failed).toEqual([]);
    expect(calls.some((c) => c.method === "PUT" && c.url === "/api/vault/hunter" && c.body?.includes("legacy-hunter-key"))).toBe(true);
    expect(localStorage.getItem("investigation_api_keys")).toBeNull();
  });

  it("never overwrites a vault-configured provider from localStorage — the conflict is reported and the local key kept", async () => {
    localStorage.setItem("investigation_api_keys", JSON.stringify({ shodan: "stale-legacy-key" }));
    const { calls } = stubFetch((url) => {
      if (url === "/api/vault")
        return { status: 200, body: { entries: [{ name: "shodan", configured: true, updatedAt: "2026-10-19T00:00:00.000Z" }] } };
      return { status: 500, body: { error: "unexpected" } };
    });
    const report = await apiKeyManager.migrateLegacyKeys();
    expect(report.moved).toBe(0);
    expect(report.conflicts).toEqual(["shodan"]);
    expect(report.failed).toEqual([]);
    expect(calls.some((c) => c.method === "PUT")).toBe(false); // no overwrite attempt at all
    // The conflicting key stays locally — nothing is silently lost.
    expect(localStorage.getItem("investigation_api_keys")).toContain("stale-legacy-key");
  });

  it("mixed legacy keys: one conflict blocks the WHOLE move — nothing moved, nothing overwritten, local copy preserved as-is", async () => {
    localStorage.setItem("investigation_api_keys", JSON.stringify({ hunter: "legacy-hunter", shodan: "stale-legacy" }));
    const { calls } = stubFetch((url) => {
      if (url === "/api/vault")
        return {
          status: 200,
          body: {
            entries: [
              { name: "hunter", configured: false, updatedAt: null },
              { name: "shodan", configured: true, updatedAt: "2026-10-19T00:00:00.000Z" },
            ],
          },
        };
      return { status: 200, body: {} };
    });
    const report = await apiKeyManager.migrateLegacyKeys();
    expect(report.moved).toBe(0);
    expect(report.conflicts).toEqual(["shodan"]);
    expect(report.failed).toEqual([]);
    // no PUT ever reached the vault — no move, no overwrite
    expect(calls.filter((c) => c.method === "PUT")).toEqual([]);
    // the local copy is untouched — BOTH keys are still there (never rewritten, never lost)
    expect(JSON.parse(localStorage.getItem("investigation_api_keys") ?? "{}")).toEqual({
      hunter: "legacy-hunter",
      shodan: "stale-legacy",
    });
  });

  it("unreadable (corrupt) legacy data is preserved AND the failure is surfaced — never silently «complete»", async () => {
    localStorage.setItem("investigation_api_keys", "not-json-at-all{{{");
    stubFetch(() => ({ status: 200, body: { entries: [] } }));
    // a corrupt copy is a FAILED migration (retried on the next read), not a silent nothing
    await expect(apiKeyManager.migrateLegacyKeys()).rejects.toThrow();
    // the corrupt blob is still there — nothing was destroyed
    expect(localStorage.getItem("investigation_api_keys")).toBe("not-json-at-all{{{");
  });

  it("the REAL two-read cycle after a partial failure: the next read RE-CHECKS — the moved key shows up as a conflict BEFORE any second PUT for the failed key", async () => {
    localStorage.setItem("investigation_api_keys", JSON.stringify({ hunter: "legacy-hunter", whoisxml: "legacy-whois" }));
    const puts = [];
    let hunterConfigured = false; // the vault's memory persists across the two reads
    stubFetch((url) => {
      if (url === "/api/vault")
        return {
          status: 200,
          body: {
            entries: [
              { name: "hunter", configured: hunterConfigured, updatedAt: null },
              { name: "whoisxml", configured: false, updatedAt: null },
            ],
          },
        };
      if (url === "/api/vault/hunter") {
        puts.push(url);
        hunterConfigured = true;
        return { status: 200, body: { name: "hunter", configured: true } };
      }
      puts.push(url);
      return { status: 500, body: { error: "boom" } }; // whoisxml PUT fails
    });
    // read 1: hunter moves, whoisxml fails — the flag must NOT be set
    const r1 = await apiKeyManager.migrateLegacyKeys();
    expect(r1).toEqual({ moved: 1, conflicts: [], failed: ["whoisxml"] });
    expect(migrationComplete(r1)).toBe(false);
    // read 2 (flag not set → re-check): hunter is vault-configured now → CONFLICT, and
    // the whoisxml key is NOT re-moved (no second PUT for it)
    const r2 = await apiKeyManager.migrateLegacyKeys();
    expect(r2).toEqual({ moved: 0, conflicts: ["hunter"], failed: [] });
    expect(migrationComplete(r2)).toBe(false);
    expect(puts.filter((u) => u === "/api/vault/whoisxml")).toHaveLength(1); // only the first attempt
    // the local copy is still fully intact (kept on the partial failure, kept on the conflict)
    expect(JSON.parse(localStorage.getItem("investigation_api_keys") ?? "{}")).toEqual({
      hunter: "legacy-hunter",
      whoisxml: "legacy-whois",
    });
  });

  it("partial PUT failure: the moved count is reported accurately, the failed key is named, and the local copy is kept", async () => {
    localStorage.setItem("investigation_api_keys", JSON.stringify({ hunter: "legacy-hunter", whoisxml: "legacy-whois" }));
    const { calls } = stubFetch((url) => {
      if (url === "/api/vault")
        return {
          status: 200,
          body: {
            entries: [
              { name: "hunter", configured: false, updatedAt: null },
              { name: "whoisxml", configured: false, updatedAt: null },
            ],
          },
        };
      if (url === "/api/vault/hunter") return { status: 200, body: { name: "hunter", configured: true } };
      return { status: 500, body: { error: "boom" } }; // whoisxml PUT fails
    });
    const report = await apiKeyManager.migrateLegacyKeys();
    expect(report.moved).toBe(1);
    expect(report.failed).toEqual(["whoisxml"]);
    expect(report.conflicts).toEqual([]);
    // the local copy is KEPT on a partial failure — nothing is half-deleted
    expect(JSON.parse(localStorage.getItem("investigation_api_keys") ?? "{}")).toEqual({
      hunter: "legacy-hunter",
      whoisxml: "legacy-whois",
    });
    expect(calls.filter((c) => c.method === "PUT").length).toBe(2);
  });
});

describe("apiKeyManager.test HTTP failures (P3-013)", () => {
  it("an HTTP error (401) is a failure — never a «لم يُختبر» success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 401, json: async () => ({ error: "unauthorized" }) })),
    );
    const r = await apiKeyManager.test("shodan");
    expect(r.success).toBe(false);
    expect(r.message).not.toContain("لم يُختبر");
    expect(r.message).toContain("unauthorized");
  });
});
