import { describe, expect, it } from "vitest";

import {
  buildKeyRows,
  formatSaveOutcome,
  migrationComplete,
  migrationFailureNotice,
  migrationNotice,
  runReadCycle,
} from "./apiKeySettingsModel";
import type { ApiKeyDefinition, KeyStatus } from "./apiKeySettingsModel";

/**
 * P3-013: the pure model behind ApiKeySettings. The vault state (which providers
 * are configured) is merged with the provider definitions the web app knows,
 * save outcomes are formatted as honest Arabic messages (a failed key test is
 * stated — per P2-015 a failed test does NOT unsave the key, so the message
 * reports BOTH facts — never fabricated success), and the one-time legacy
 * localStorage migration reports exactly what it moved.
 */

const DEFS: ApiKeyDefinition[] = [
  {
    key: "resend",
    label: "Resend",
    labelAr: "مفتاح Resend",
    link: "https://resend.com/api-keys",
    description: "Sending email from the investigation inbox (notices).",
    placeholder: "re_xxx",
  },
  {
    key: "anthropic",
    label: "Anthropic",
    labelAr: "مفتاح Anthropic",
    link: "https://console.anthropic.com/settings/keys",
    description: "The LLM that drives the narrative engine.",
    placeholder: "sk-ant-xxx",
  },
];

const STATUS: KeyStatus[] = [
  { name: "anthropic", configured: true, updatedAt: "2026-10-19T10:00:00.000Z" },
  { name: "resend", configured: false, updatedAt: null },
];

describe("buildKeyRows (P3-013)", () => {
  it("merges definitions with vault statuses in definition order", () => {
    const rows = buildKeyRows(DEFS, STATUS);
    expect(rows.map((r) => r.key)).toEqual(["resend", "anthropic"]);
    const anthropic = rows.find((r) => r.key === "anthropic");
    expect(anthropic?.configured).toBe(true);
    expect(anthropic?.updatedAt).toBe("2026-10-19T10:00:00.000Z");
    const resend = rows.find((r) => r.key === "resend");
    expect(resend?.configured).toBe(false);
    expect(resend?.updatedAt).toBeNull();
  });

  it("appends vault providers the app does not define (the vault may know more)", () => {
    const rows = buildKeyRows(DEFS, [...STATUS, { name: "future-provider", configured: true, updatedAt: "2026-10-01T00:00:00.000Z" }]);
    expect(rows.map((r) => r.key)).toEqual(["resend", "anthropic", "future-provider"]);
    expect(rows[2].configured).toBe(true);
  });
});

describe("migrationNotice (P3-013)", () => {
  it("says nothing when the legacy copy was absent — no invented work", () => {
    expect(migrationNotice({ moved: 0, conflicts: [], failed: [] })).toBeNull();
  });

  it("reports the moved count when old keys existed", () => {
    const notice = migrationNotice({ moved: 2, conflicts: [], failed: [] });
    expect(notice).toContain("2");
    expect(notice).toContain("الخزنة");
  });

  it("reports a conflict — nothing is moved or replaced, and no unfulfilled promise is made", () => {
    const notice = migrationNotice({ moved: 0, conflicts: ["shodan"], failed: [] });
    expect(notice).toContain("shodan");
    expect(notice).toContain("تعارض");
    expect(notice).toContain("لم يُنقل شيء");
    expect(notice).toContain("لم يُستبدل شيء");
    // the notice must NOT promise a resolution the code does not perform
    expect(notice).not.toContain("أعد القراءة");
  });

  it("reports a PARTIAL failure accurately — moved count kept, failed key named, local copy not deleted, no re-move promise", () => {
    const notice = migrationNotice({ moved: 1, conflicts: [], failed: ["whoisxml"] });
    expect(notice).toContain("1");
    expect(notice).toContain("whoisxml");
    expect(notice).toContain("لم تُحذف");
    // the next read RE-CHECKS (the moved key may then show as a conflict) — the notice
    // must not promise that the failed key will be re-moved
    expect(notice).toContain("إعادة الفحص");
    expect(notice).not.toContain("ستعاد المحاولة");
  });

  it("runReadCycle (the REAL read flow the component runs): a conflict keeps the migration retryable on the next read", async () => {
    const reads = [];
    const reader = {
      status: async () => [{ name: "shodan", configured: true, updatedAt: "2026-10-19T00:00:00.000Z" }],
      migrateLegacyKeys: async () => {
        reads.push(1);
        return { moved: 0, conflicts: ["shodan"], failed: [] };
      },
    };
    const first = await runReadCycle(reader, false);
    expect(first.report).toEqual({ moved: 0, conflicts: ["shodan"], failed: [] });
    expect(first.complete).toBe(false); // the flag must NOT be set — the conflict is unresolved
    expect(first.failed).toBe(false);
    const second = await runReadCycle(reader, first.complete);
    expect(reads.length).toBe(2); // the second read RE-ATTEMPTED the migration (flag not set)
    expect(second.complete).toBe(false);
  });

  it("runReadCycle: a corrupt copy (throw) is surfaced as failed and retried on the next read", async () => {
    const attempts = [];
    const reader = {
      status: async () => [],
      migrateLegacyKeys: async () => {
        attempts.push(1);
        throw new Error("legacy localStorage copy is unreadable");
      },
    };
    const first = await runReadCycle(reader, false);
    expect(first.failed).toBe(true);
    expect(first.complete).toBe(false);
    const second = await runReadCycle(reader, first.complete);
    expect(attempts.length).toBe(2); // retried — a corrupt copy never silently marks complete
    expect(second.failed).toBe(true);
  });

  it("runReadCycle: a PARTIAL failure re-CHECKS on the next read — it does NOT promise to re-move the failed key", async () => {
    // read 1: hunter moved, whoisxml failed → complete=false
    const reader = {
      status: async () => [
        { name: "hunter", configured: true, updatedAt: null },
        { name: "whoisxml", configured: false, updatedAt: null },
      ],
      migrateLegacyKeys: async () => ({ moved: 1, conflicts: [], failed: ["whoisxml"] }),
    };
    const first = await runReadCycle(reader, false);
    expect(first.complete).toBe(false);
    // read 2: the re-check sees the moved key as a CONFLICT (it is vault-configured now) —
    // the failed key is NOT re-moved; the conflict is what the next report shows
    const secondReader = {
      status: async () => [{ name: "hunter", configured: true, updatedAt: null }],
      migrateLegacyKeys: async () => ({ moved: 0, conflicts: ["hunter"], failed: [] }),
    };
    const second = await runReadCycle(secondReader, first.complete);
    expect(second.report).toEqual({ moved: 0, conflicts: ["hunter"], failed: [] });
    expect(second.complete).toBe(false); // still retryable, still surfaced
    expect(second.failed).toBe(false);
  });

  it("runReadCycle: a complete migration sets the one-time flag and the next read skips it entirely", async () => {
    const attempts = [];
    const reader = {
      status: async () => [{ name: "hunter", configured: true, updatedAt: null }],
      migrateLegacyKeys: async () => {
        attempts.push(1);
        return { moved: 1, conflicts: [], failed: [] };
      },
    };
    const first = await runReadCycle(reader, false);
    expect(first.complete).toBe(true);
    const second = await runReadCycle(reader, first.complete);
    expect(attempts.length).toBe(1); // NOT re-run — the flag is set for a complete report
    expect(second.report).toBeNull(); // no stale report on the second read
    expect(second.complete).toBe(true);
  });

  it("runReadCycle: a status error is surfaced while the migration outcome is still reported", async () => {
    const reader = {
      status: async () => {
        throw new Error("network down");
      },
      migrateLegacyKeys: async () => ({ moved: 1, conflicts: [], failed: [] }),
    };
    const outcome = await runReadCycle(reader, false);
    expect(outcome.complete).toBe(true);
    expect(outcome.report).toEqual({ moved: 1, conflicts: [], failed: [] });
    expect(outcome.statuses).toBeNull();
    expect(outcome.error).toBe("network down");
  });

  it("migrationComplete: only a conflict-free, failure-free report is complete — anything else retries", () => {
    expect(migrationComplete({ moved: 2, conflicts: [], failed: [] })).toBe(true);
    expect(migrationComplete({ moved: 0, conflicts: [], failed: [] })).toBe(true); // nothing to do IS complete
    expect(migrationComplete({ moved: 0, conflicts: ["shodan"], failed: [] })).toBe(false); // conflict → retryable
    expect(migrationComplete({ moved: 1, conflicts: [], failed: ["whoisxml"] })).toBe(false); // partial → retryable
  });

  it("reports a FAILED migration honestly — a retry is promised, completion is never claimed", () => {
    const notice = migrationFailureNotice();
    expect(notice).toContain("فشل نقل");
    expect(notice).toContain("ستعاد المحاولة");
  });
});

describe("formatSaveOutcome (P3-013 — P2-015: save carries the test result)", () => {
  it("reports saved AND tested-OK as one honest message", () => {
    const r = formatSaveOutcome({ name: "anthropic", configured: true, updatedAt: "2026-10-19T10:00:00.000Z", ok: true, tested: true });
    expect(r.success).toBe(true);
    expect(r.message).toContain("حُفظ");
    expect(r.message).toContain("صحيح");
  });

  it("reports BOTH facts when the key saved but the test failed — a failed test never unsaves", () => {
    const r = formatSaveOutcome({ name: "resend", configured: true, updatedAt: "2026-10-19T10:00:00.000Z", ok: false, tested: true });
    expect(r.success).toBe(false);
    expect(r.message).toContain("حُفظ");
    expect(r.message).toContain("فشل اختبار");
  });

  it("states honestly when no test was possible — never fabricated ok", () => {
    const r = formatSaveOutcome({
      name: "whois",
      configured: true,
      updatedAt: "2026-10-19T10:00:00.000Z",
      ok: false,
      tested: false,
      reason: "transport_not_configured",
    });
    expect(r.success).toBe(true);
    expect(r.message).toContain("لم يُختبر");
  });

  it("keeps the 80%-quota alert in the save message when the provider reports it", () => {
    const r = formatSaveOutcome({
      name: "anthropic",
      configured: true,
      updatedAt: "2026-10-19T10:00:00.000Z",
      ok: true,
      tested: true,
      quota: { supported: true, usedPct: 85, alert80: true, window: "month", action: "requests" },
    });
    expect(r.message).toContain("85%");
  });
});
