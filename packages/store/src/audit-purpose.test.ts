import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { manualClock } from "@ir/core";
import { CASE_DB, NoCaseError, openCase, verifyCase } from "./index.ts";

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), "ir-audit-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const CREATE = { title: "مورّد جديد", purpose: "العناية الواجبة قبل التعاقد مع مورّد", legalBasis: "due_diligence" } as const;
const FAST = { memoryKiB: 256, passes: 1, parallelism: 1 };

describe("case purpose (P1-018)", () => {
  it("no case without a purpose: a new directory needs create, and a short purpose or unknown basis is refused", () => {
    const dir = tmp();
    expect(() => openCase(dir, { actor: "a" })).toThrow(NoCaseError);
    expect(() => openCase(tmp(), { actor: "a", create: { ...CREATE, purpose: "short" } })).toThrow(/E-01/);
    expect(() => openCase(tmp(), { actor: "a", create: { ...CREATE, legalBasis: "curiosity" as never } })).toThrow();
    // a refused case leaves no key file and no meta behind
    const enc = tmp();
    expect(() => openCase(enc, { actor: "a", passphrase: "long passphrase", kdf: FAST, create: { ...CREATE, purpose: "" } })).toThrow();
    expect(readdirSync(enc).filter((f) => f.endsWith(".json"))).toEqual([]);
    expect(existsSync(path.join(dir, "case.key.json"))).toBe(false);
  });

  it("records the purpose as the first chain entry, with defaults, and updates it with a reason", () => {
    const dir = tmp();
    const clock = manualClock("2026-10-10T15:00:00.000Z");
    const c = openCase(dir, { actor: "analyst", clock, create: CREATE });
    const info = c.info();
    expect(info).toMatchObject({ ...CREATE, ownerId: "analyst", sensitivity: "standard", tags: [], createdAt: "2026-10-10T15:00:00.000Z" });
    expect(info.id).toBe(c.meta("case_id"));
    expect(c.ledger.entries()[0]?.kind).toBe("case.created");
    const next = c.update({ legalBasis: "fraud_investigation", retention: { mode: "days", days: 365 } }, "ظهرت مؤشرات احتيال");
    expect(next).toMatchObject({ legalBasis: "fraud_investigation", retention: { mode: "days", days: 365 } });
    expect(() => c.update({ purpose: "x" }, "reason")).toThrow(/E-01/);
    expect(() => c.update({ title: "new" }, "")).toThrow(/reason/);
    expect(c.update({ ownerId: "someone-else", id: "x" } as never, "attempt").ownerId).toBe("analyst");
    c.close();
    const r = openCase(dir, { actor: "analyst", clock });
    expect(r.info().legalBasis).toBe("fraud_investigation");
    r.close();
  });
});

describe("audit log (P1-017)", () => {
  it("every sensitive action is in the chain and the index, tied to the case purpose", () => {
    const dir = tmp();
    const clock = manualClock("2026-10-10T15:00:00.000Z");
    const c = openCase(dir, { actor: "analyst", clock, create: CREATE });
    const ev = c.addEvidence({
      bytes: new TextEncoder().encode("x"),
      mime: "text/plain",
      request: { method: "LOCAL", url: "file:x" },
      transformId: "tr-local",
      version: "1.0.0",
    });
    c.update({ title: "مورّد (محدّث)" }, "تصحيح الاسم");
    c.audit("export.created", "report-1", { format: "pdf" });
    const trail = c.auditTrail();
    expect(trail.map((a) => [a.action, a.target])).toEqual([
      ["case.created", c.info().id],
      ["evidence.stored", ev.id],
      ["case.updated", c.info().id],
      ["export.created", "report-1"],
    ]);
    expect(trail.every((a) => a.purposeRef === c.info().id && a.actor === "analyst")).toBe(true);
    const rows = c.db.prepare("SELECT action, detail FROM audit_events ORDER BY rowid").all() as {
      action: string;
      detail: string | null;
    }[];
    expect(rows.map((r) => r.action)).toEqual(trail.map((a) => a.action));
    expect(JSON.parse(rows[3]?.detail ?? "{}")).toEqual({ format: "pdf" });
    expect(() => c.audit("Not A Slug", "x")).toThrow();
    c.close();
    expect(verifyCase(dir).audit).toEqual({ events: 4, problems: [] });
  });

  it("encrypted cases audit unlocks and passphrase changes, keep detail sealed, and verify the index without the key", () => {
    const dir = tmp();
    const c = openCase(dir, { actor: "analyst", passphrase: "first passphrase", kdf: FAST, create: CREATE });
    c.audit("gate.confirmed", "entity-1", { note: "سري" });
    c.changePassphrase("first passphrase", "second passphrase");
    c.close();
    expect(() => openCase(dir, { actor: "x", passphrase: "first passphrase" })).toThrow();
    const d = openCase(dir, { actor: "reviewer", passphrase: "second passphrase" });
    expect(d.auditTrail().map((a) => a.action)).toEqual(["case.created", "gate.confirmed", "case.passphrase_changed", "case.unlocked"]);
    expect(d.db.prepare("SELECT count(*) n FROM audit_events WHERE detail IS NOT NULL").get()).toEqual({ n: 0 });
    d.close();
    expect(verifyCase(dir).audit).toEqual({ events: 4, problems: [] });
    expect(verifyCase(dir, { passphrase: "second passphrase" }).audit.problems).toEqual([]);
  });

  it("an audit row removed behind the triggers' back is reported by verification", () => {
    const dir = tmp();
    const c = openCase(dir, { actor: "analyst", create: CREATE });
    c.audit("export.created", "r");
    c.close();
    const db = new DatabaseSync(path.join(dir, CASE_DB));
    db.exec("DROP TRIGGER audit_events_no_delete");
    db.exec("DELETE FROM audit_events WHERE action = 'export.created'");
    db.close();
    const r = verifyCase(dir);
    expect(r.ok).toBe(false);
    expect(r.audit.problems.join("\n")).toMatch(/index has 1 rows, chain has 2|missing from the index/);
  });
});
