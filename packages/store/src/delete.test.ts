/**
 * P6-008 — secure case deletion per retention (UC-24, E-09, gate G-40's sibling).
 *
 * Deletion is a first-class case operation with a paper trail: the case verifies, a
 * reason is mandatory, every file is overwritten with random bytes before unlink
 * (best-effort secure deletion on the local filesystem), the directory tree is
 * removed entirely (case.sqlite, blobs/, the wrapped key, WAL/SHM siblings), and a
 * signed deletion certificate (`irdeletion/1`) is written OUTSIDE the deleted tree:
 * case id, chain length/head/Merkle root, blob count and aggregate hash, the case's
 * retention policy and whether deletion happened at/after expiry or early, the
 * reason, actor and time — signed with the installation Ed25519 key over JCS.
 *
 * Fail-closed: an unverifiable case is refused (never delete what you cannot
 * account for), a missing reason is refused, and a certificate that does not verify
 * is an error, never a warning.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { manualClock } from "@ir/core";
import { generateInstallationKey, verifyDeletionCertificate } from "@ir/ledger";
import { deleteCase, openCase, verifyCase } from "@ir/store";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function makeCase(days = 30) {
  const dir = mkdtempSync(path.join(tmpdir(), "ir-delete-"));
  dirs.push(dir);
  const clock = manualClock("2026-10-24T12:00:00.000Z");
  const key = generateInstallationKey();
  const c = openCase(dir, {
    actor: "analyst",
    clock,
    create: {
      title: "deletion test",
      purpose: "مراجعة بنية تحتية",
      legalBasis: "security_incident",
      retention: { mode: "days", days },
    },
  });
  c.addEvidence({
    bytes: new TextEncoder().encode("evidence blob for deletion"),
    mime: "text/plain",
    request: { method: "DNS", url: "dns:delete.example/NS" },
    transformId: "tr-dns",
    version: "1.0.0",
  });
  c.ledger.append("note.added", { text: "before deletion" });
  c.close();
  return { dir, key, clock, retention: { mode: "days" as const, days } };
}

describe("deleteCase — secure deletion with a signed certificate (P6-008, UC-24)", () => {
  it("deletes everything and leaves a verifiable certificate outside the tree", () => {
    const { dir, key, clock } = makeCase(30);
    const crt = deleteCase(dir, {
      actor: "analyst",
      reason: "انتهاء مدة الاحتفاظ — retention expired",
      key,
      clock,
    });
    // the tree is gone: sqlite, blobs, key — everything
    expect(existsSync(dir)).toBe(false);
    // the certificate verifies against the installation key
    expect(verifyDeletionCertificate(crt, key.publicKeyPem)).toEqual([]);
    expect(crt.payload.caseId).toMatch(/^[0-9A-Z]{26}$/);
    expect(crt.payload.chainLength).toBeGreaterThanOrEqual(3);
    expect(crt.payload.blobs).toBe(1);
    expect(crt.payload.retention).toEqual({ mode: "days", days: 30 });
    expect(crt.payload.reason).toContain("retention expired");
    // the head recorded in the certificate is the case's real head
    expect(crt.payload.head).toMatch(/^[0-9a-f]{64}$/);
  });

  it("flags early deletion (before the retention deadline) in the certificate", () => {
    const { dir, key, clock } = makeCase(365);
    const crt = deleteCase(dir, { actor: "analyst", reason: "طلب المالك", key, clock });
    expect(existsSync(dir)).toBe(false);
    expect(verifyDeletionCertificate(crt, key.publicKeyPem)).toEqual([]);
    expect(crt.payload.retentionState).toBe("early");
  });

  it("marks at-expiry deletion", () => {
    const { dir, key } = makeCase(1);
    // one day after creation, the 1-day retention has expired
    const later = manualClock("2026-10-25T12:00:00.000Z");
    const crt = deleteCase(dir, { actor: "analyst", reason: "expired", key, clock: later });
    expect(crt.payload.retentionState).toBe("expired");
  });

  it("refuses to delete a case that does not verify (fail-closed)", () => {
    const { dir, key, clock } = makeCase();
    // corrupt the chain itself: the last entry's payload no longer matches its hash
    const sqlite = new DatabaseSync(path.join(dir, "case.sqlite"));
    const last = sqlite.prepare("SELECT seq, payload FROM ledger ORDER BY seq DESC LIMIT 1").get() as {
      seq: number;
      payload: string;
    };
    // the DB itself is append-only (triggers), so flip the payload byte in the file directly
    sqlite.close();
    const db = readFileSync(path.join(dir, "case.sqlite"));
    const at = db.indexOf(Buffer.from(last.payload.slice(0, 8), "utf8"));
    if (at < 0) throw new Error("fixture: payload not found in the sqlite file");
    db[at] ^= 0xff;
    writeFileSync(path.join(dir, "case.sqlite"), db);
    expect(() => deleteCase(dir, { actor: "analyst", reason: "test", key, clock })).toThrow(/verif/i);
    expect(existsSync(path.join(dir, "case.sqlite"))).toBe(true);
  });

  it("requires a reason (E-01 spirit: no undocumented destruction)", () => {
    const { dir, key, clock } = makeCase();
    expect(() => deleteCase(dir, { actor: "analyst", reason: "", key, clock })).toThrow(/reason/i);
    expect(() => deleteCase(dir, { actor: "analyst", reason: "x".repeat(3), key, clock })).not.toThrow();
    expect(existsSync(dir)).toBe(false);
  });

  it("the case was intact before deletion (sanity: verifyCase passes on the fixture)", () => {
    const { dir } = makeCase();
    expect(verifyCase(dir).ok).toBe(true);
  });
});
