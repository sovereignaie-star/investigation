import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { manualClock, seededRandom, ulidFactory } from "@ir/core";
import { verify, verifyEvidence } from "@ir/ledger";
import {
  CASE_DB,
  LATEST_VERSION,
  migrate,
  MigrationError,
  MIGRATIONS,
  openCase,
  caseFingerprint,
  verifyCase,
  userVersion,
  type Migration,
} from "./index.ts";

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), "ir-case-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const CREATE = { title: "اختبار", purpose: "تحقق من بنية تحتية لنطاق", legalBasis: "due_diligence" } as const;
const clock = () => manualClock("2026-10-10T12:00:00.000Z");
/** Normalized schema (tables, indexes, triggers) for comparing databases migrated by different paths. */
const schemaOf = (db: DatabaseSync) =>
  (
    db.prepare("SELECT type, name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all() as {
      sql: string | null;
    }[]
  ).map((r) => ({ ...r, sql: (r.sql ?? "").replace(/\s+/g, " ").trim() }));

describe("case database migrations (P1-013)", () => {
  it("migrates an empty database to the latest version and records every step", () => {
    const db = new DatabaseSync(":memory:");
    expect(migrate(db, { clock: clock() })).toEqual(MIGRATIONS.map((m) => m.version));
    expect(userVersion(db)).toBe(LATEST_VERSION);
    const rows = db.prepare("SELECT version, name FROM schema_migrations ORDER BY version").all();
    expect(rows).toEqual(MIGRATIONS.map((m) => ({ version: m.version, name: m.name })));
    expect(migrate(db)).toEqual([]); // idempotent
  });

  it("every intermediate version upgrades to the same schema as a fresh database", () => {
    const fresh = new DatabaseSync(":memory:");
    migrate(fresh, { clock: clock() });
    for (let start = 0; start <= LATEST_VERSION; start++) {
      const db = new DatabaseSync(":memory:");
      migrate(db, { target: start, clock: clock() });
      expect(userVersion(db)).toBe(start);
      migrate(db, { clock: clock() });
      expect(schemaOf(db), `from v${start}`).toEqual(schemaOf(fresh));
    }
  });

  it("refuses a database from newer software, an edited migration, and a failed step rolls back", () => {
    const db = new DatabaseSync(":memory:");
    migrate(db, { clock: clock() });
    db.exec(`PRAGMA user_version = ${LATEST_VERSION + 1}`);
    expect(() => migrate(db)).toThrow(expect.objectContaining({ code: "newer" }));
    db.exec(`PRAGMA user_version = ${LATEST_VERSION}`);
    const edited: Migration[] = MIGRATIONS.map((m) => (m.version === 1 ? { ...m, sql: `${m.sql}\n-- edited` } : m));
    expect(() => migrate(db, { migrations: edited })).toThrow(expect.objectContaining({ code: "drift" }));
    const broken: Migration[] = [
      ...MIGRATIONS,
      { version: LATEST_VERSION + 1, name: "broken", sql: "CREATE TABLE x (a); SELECT nope FROM missing;" },
    ];
    expect(() => migrate(db, { migrations: broken })).toThrow(MigrationError);
    expect(userVersion(db)).toBe(LATEST_VERSION);
    expect(db.prepare("SELECT count(*) n FROM sqlite_schema WHERE name = 'x'").get()).toEqual({ n: 0 });
    expect(() => migrate(new DatabaseSync(":memory:"), { migrations: [{ version: 2, name: "gap", sql: "" }] })).toThrow(
      expect.objectContaining({ code: "gap" }),
    );
  });

  it("ledger, audit and evidence tables are append-only in the database itself", () => {
    const db = new DatabaseSync(":memory:");
    migrate(db, { clock: clock() });
    db.prepare("INSERT INTO ledger VALUES (0, NULL, ?, 'case.created', '2026-10-10T12:00:00.000Z', 'a', '{}')").run("a".repeat(64));
    expect(() => db.exec("UPDATE ledger SET actor = 'b'")).toThrow(/append-only/);
    expect(() => db.exec("DELETE FROM ledger")).toThrow(/append-only/);
    db.prepare(
      "INSERT INTO audit_events VALUES ('01J00000000000000000000001', 't', 'a', 'export', 'case', '01J00000000000000000000002', NULL)",
    ).run();
    expect(() => db.exec("DELETE FROM audit_events")).toThrow(/append-only/);
    expect(() => db.prepare("INSERT INTO ledger VALUES (1, NULL, ?, 'note.added', 't', 'a', '{}')").run("b".repeat(64))).toThrow(/CHECK/);
  });
});

describe("case directory (P1-013)", () => {
  it("persists the ledger and evidence across reopen; verify and verifyEvidence pass", () => {
    const dir = tmp();
    const c = clock();
    const newId = ulidFactory(c, seededRandom(3));
    const a = openCase(dir, { actor: "analyst", clock: c, create: CREATE });
    const ev = a.addEvidence(
      {
        bytes: new TextEncoder().encode('{"ns":["a.iana-servers.net"]}'),
        mime: "application/json",
        request: { method: "DNS", url: "dns:example.com/NS" },
        transformId: "tr-dns",
        version: "1.0.0",
      },
      { newId },
    );
    a.ledger.append("observation.added", { evidence: ev.id, value: "a.iana-servers.net" });
    const head = a.ledger.head();
    a.close();

    const b = openCase(dir, { actor: "analyst", clock: c });
    expect(b.ledger.length).toBe(5); // created, audit, evidence, audit, observation
    expect(b.ledger.head()).toBe(head);
    expect(verify(b.ledger.entries()).ok).toBe(true);
    expect(verifyEvidence(b.ledger.entries(), b.blobs)).toEqual([]);
    expect(b.db.prepare("SELECT id, ledger_seq FROM evidence").all()).toEqual([{ id: ev.id, ledger_seq: 2 }]);
    b.close();

    const ro = openCase(dir, { actor: "verifier", readOnly: true });
    expect(ro.ledger.head()).toBe(head);
    expect(() => ro.ledger.append("note.added", {})).toThrow();
    ro.close();
  });

  it("a case whose ledger was edited behind the triggers' back is refused on open", () => {
    const dir = tmp();
    const c = clock();
    const a = openCase(dir, { actor: "analyst", clock: c, create: CREATE });
    a.ledger.append("note.added", { text: "original" });
    a.close();
    const raw = new DatabaseSync(path.join(dir, CASE_DB));
    raw.exec("DROP TRIGGER ledger_no_update");
    raw.exec(`UPDATE ledger SET payload = '{"text":"forged"}' WHERE seq = 2`);
    raw.close();
    expect(() => openCase(dir, { actor: "analyst", clock: c })).toThrow(/corrupt/);
  });
});

// P3-003 (طلب أ): the J-17 listing primitive and the J-16 archive field at the store level.
describe("appendIfSeq (P4-005 — one atomic write scope)", () => {
  it("two handles on one head version: one append wins, the other is refused with NO extra event, chain stays valid", () => {
    const dir = tmp();
    const c = clock();
    const a = openCase(dir, { actor: "analyst", clock: c, create: CREATE });
    const b = openCase(dir, { actor: "analyst", clock: c });
    // both handles see the SAME head (the case-created chain) and both carry a
    // payload validated against that head — the merge-accept race in miniature.
    const head = a.entries().at(-1)?.seq ?? -1;
    expect(b.entries().at(-1)?.seq).toBe(head); // both handles see the same chain head
    const first = a.appendIfSeq("note.added", { text: "الفائز" }, head);
    expect(first).not.toBeNull();
    // the second writer's expected seq is now stale: the head moved when the
    // first transaction committed. The head is re-read INSIDE the write
    // transaction (never a value cached at open), so this is a clean null —
    // not a duplicate event and not a corrupted chain.
    const second = b.appendIfSeq("note.added", { text: "الخاسر" }, head);
    expect(second).toBeNull();
    b.close();
    a.close();
    // exactly one note event was appended; the chain is still valid.
    const after = openCase(dir, { actor: "verifier", readOnly: true });
    try {
      const notes = after.entries().filter((e) => e.kind === "note.added");
      expect(notes).toHaveLength(1);
      expect((notes[0].payload as { text?: string }).text).toBe("الفائز");
      expect(verify(after.ledger.entries()).ok).toBe(true);
    } finally {
      after.close();
    }
  });
});

describe("caseFingerprint (P3-003, J-17)", () => {
  it("reads identifier and timestamps from a locked case without a passphrase — and nothing more", () => {
    const dir = tmp();
    const c = openCase(dir, { actor: "analyst", clock: clock(), create: CREATE, passphrase: "سر-قوي-جدا" });
    c.close();
    const fp = caseFingerprint(dir);
    expect(fp?.caseId).toBeTruthy();
    expect(fp?.createdAt).toBe("2026-10-10T12:00:00.000Z");
    expect(fp?.encrypted).toBe(true);
    expect(fp?.lastActivityAt).toBeTruthy(); // the audit index is plain — the timestamp is readable
  });

  it("returns null for a directory with no complete case (an abandoned staging dir)", () => {
    const dir = tmp();
    expect(caseFingerprint(dir)).toBeNull();
    expect(caseFingerprint(path.join(dir, "nope"))).toBeNull();
  });

  it("J-16: archivedAt is null on create, set by update, and the chain keeps the reason", () => {
    const dir = tmp();
    const c = openCase(dir, { actor: "analyst", create: CREATE });
    expect(c.info().archivedAt).toBeNull();
    const archived = c.update({ archivedAt: "2026-10-19T00:00:00.000Z" }, "اكتمل التحقيق");
    expect(archived.archivedAt).toBe("2026-10-19T00:00:00.000Z");
    const reopened = c.update({ archivedAt: null }, "إعادة فتح — تأكيد غرض موثق");
    expect(reopened.archivedAt).toBeNull();
    c.close();
    // reopened read-only: the record round-trips through the chain
    const ro = openCase(dir, { actor: "verifier", readOnly: true });
    expect(ro.info().archivedAt).toBeNull();
    ro.close();
  });
});

// P4-009: the atomic audit claim — an audit.event appended ONLY if the head seq still matches,
// with the audit index row written in the SAME transaction (the index must mirror the chain, P1-017).
describe("auditIfSeq (P4-009 — one atomic audit write scope)", () => {
  it("appends the audit event and its index row when the head matches, and the trail sees it", () => {
    const dir = tmp();
    const c = clock();
    const a = openCase(dir, { actor: "analyst", clock: c, create: CREATE });
    const head = a.entries().at(-1)?.seq ?? -1;
    const ev = a.auditIfSeq("monitor.check.started", "m-x#1", { monitorId: "m-x" }, head);
    expect(ev).not.toBeNull();
    expect(ev?.action).toBe("monitor.check.started");
    a.close();
    const after = openCase(dir, { actor: "verifier", readOnly: true });
    try {
      expect(after.auditTrail().filter((e) => e.action === "monitor.check.started")).toHaveLength(1);
      // the index mirrors the chain: the P1-017 check in verifyCase sees no mismatch
      const report = verifyCase(dir);
      expect(report.audit.problems).toHaveLength(0);
    } finally {
      after.close();
    }
  });

  it("two handles on one head: one audit wins, the other gets null with NO event and NO index row", () => {
    const dir = tmp();
    const c = clock();
    const a = openCase(dir, { actor: "analyst", clock: c, create: CREATE });
    const b = openCase(dir, { actor: "analyst", clock: c });
    const head = a.entries().at(-1)?.seq ?? -1;
    expect(b.entries().at(-1)?.seq).toBe(head);
    const first = a.auditIfSeq("monitor.scheduled", "m-x", { monitorId: "m-x" }, head);
    expect(first).not.toBeNull();
    const second = b.auditIfSeq("monitor.scheduled", "m-y", { monitorId: "m-y" }, head);
    expect(second).toBeNull();
    b.close();
    a.close();
    const after = openCase(dir, { actor: "verifier", readOnly: true });
    try {
      expect(after.auditTrail().filter((e) => e.action === "monitor.scheduled")).toHaveLength(1);
      const report = verifyCase(dir);
      expect(report.audit.problems).toHaveLength(0);
    } finally {
      after.close();
    }
  });
});
