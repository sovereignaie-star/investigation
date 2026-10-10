import { argon2Sync } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { manualClock } from "@ir/core";
import { checkpoint, generateInstallationKey, verify } from "@ir/ledger";
import {
  CASE_DB,
  CASE_KEY,
  CaseLockedError,
  changePassphrase,
  createCaseKey,
  openCase,
  unlockCaseKey,
  verifyCase,
  WrongPassphraseError,
  type CaseKeyFile,
} from "./index.ts";

const FAST = { memoryKiB: 256, passes: 1, parallelism: 1 }; // test cost only; production uses RFC 9106 defaults
const PASS = "correct horse battery staple";
const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), "ir-enc-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const SECRET_TEXT = "سجل تجاري سري 7744";
const SECRET_BLOB = "<html>registrant-record-unique-9f31</html>";

function encryptedCase() {
  const dir = tmp();
  const clock = manualClock("2026-10-10T14:00:00.000Z");
  const c = openCase(dir, {
    actor: "analyst",
    clock,
    passphrase: PASS,
    kdf: FAST,
    create: { title: "سرية", purpose: `عناية واجبة ${SECRET_TEXT}`, legalBasis: "due_diligence" },
  });
  const ev = c.addEvidence({
    bytes: new TextEncoder().encode(SECRET_BLOB),
    mime: "text/html",
    request: { method: "GET", url: "https://example.com/r" },
    transformId: "tr-web",
    version: "1.0.0",
  });
  c.close();
  return { dir, clock, ev };
}
const allFileBytes = (dir: string): Buffer => {
  const out: Buffer[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, n.name);
      if (n.isDirectory()) walk(p);
      else out.push(readFileSync(p));
    }
  };
  walk(dir);
  return Buffer.concat(out);
};

describe("case encryption (P1-014)", () => {
  it("Argon2id matches the RFC 9106 section 5.3 test vector", () => {
    const tag = argon2Sync("argon2id", {
      message: Buffer.alloc(32, 1),
      nonce: Buffer.alloc(16, 2),
      secret: Buffer.alloc(8, 3),
      associatedData: Buffer.alloc(12, 4),
      parallelism: 4,
      tagLength: 32,
      memory: 32,
      passes: 3,
    });
    expect(tag.toString("hex")).toBe("0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659");
  });

  it("no plaintext payload or blob content appears anywhere in the case files", () => {
    const { dir, ev } = encryptedCase();
    const bytes = allFileBytes(dir);
    for (const s of [SECRET_TEXT, SECRET_BLOB, "registrant-record", "عناية واجبة", ev.sha256, "example.com/r"])
      expect(bytes.includes(Buffer.from(s)), s).toBe(false);
    expect(readdirSync(path.join(dir, "blobs")).length).toBe(1);
    expect(statSync(path.join(dir, CASE_KEY)).mode & 0o777).toBe(0o600);
  });

  it("reading without the key fails; the wrong passphrase fails; the right one reads everything back", () => {
    const { dir, ev } = encryptedCase();
    const locked = openCase(dir, { actor: "x", readOnly: true });
    expect(locked.locked).toBe(true);
    expect(() => locked.entries()).toThrow(CaseLockedError);
    expect(() => locked.blobs.get(ev.sha256)).toThrow(CaseLockedError);
    locked.close();
    expect(() => openCase(dir, { actor: "x", passphrase: "wrong passphrase" })).toThrow(WrongPassphraseError);
    const c = openCase(dir, { actor: "x", passphrase: PASS });
    expect(c.info().purpose).toBe(`عناية واجبة ${SECRET_TEXT}`);
    expect(new TextDecoder().decode(c.blobs.get(ev.sha256))).toBe(SECRET_BLOB);
    c.close();
  });

  it("the chain and signed checkpoints verify without the passphrase; evidence is re-hashed only with it", () => {
    const { dir, clock } = encryptedCase();
    const key = generateInstallationKey();
    const c = openCase(dir, { actor: "x", passphrase: PASS, clock });
    checkpoint(c.ledger, key, clock);
    c.close();
    const r1 = verifyCase(dir, { publicKeyPem: key.publicKeyPem });
    expect(r1).toMatchObject({
      ok: true,
      encryption: "locked",
      chain: { ok: true, length: 6 },
      evidence: { skipped: true },
      checkpoints: { embedded: 1, problems: [] },
    });
    const r2 = verifyCase(dir, { publicKeyPem: key.publicKeyPem, passphrase: PASS });
    expect(r2).toMatchObject({ ok: true, encryption: "unlocked", evidence: { checked: 1, skipped: false, problems: [] } });
  });

  it("tampering with a sealed payload or blob is detected (chain hash and GCM tag)", () => {
    const { dir, ev } = encryptedCase();
    const db = new DatabaseSync(path.join(dir, CASE_DB));
    const row = db.prepare("SELECT payload FROM ledger WHERE seq = 0").get() as { payload: string };
    const env = JSON.parse(row.payload) as { ct: string };
    const flipped = env.ct.startsWith("A") ? `B${env.ct.slice(1)}` : `A${env.ct.slice(1)}`;
    db.exec("DROP TRIGGER ledger_no_update");
    db.prepare("UPDATE ledger SET payload = ? WHERE seq = 0").run(JSON.stringify({ ...env, ct: flipped }));
    db.close();
    const raw = openCase(dir, { actor: "x", readOnly: true, skipChainCheck: true });
    expect(verify(raw.ledger.entries()).errors.map((e) => e.code)).toEqual(["entry_hash"]);
    raw.close();
    const sub = readdirSync(path.join(dir, "blobs"))[0] ?? "";
    const file = path.join(dir, "blobs", sub, readdirSync(path.join(dir, "blobs", sub))[0] ?? "");
    const b = readFileSync(file);
    b[20] = (b[20] ?? 0) ^ 1;
    writeFileSync(file, b);
    const r = verifyCase(dir, { passphrase: PASS });
    expect(r.ok).toBe(false);
    expect(r.sealed.unopenable).toEqual([0]);
    expect(r.evidence.problems.map((p) => [p.id, p.reason])).toEqual([[ev.id, "corrupt"]]);
  });

  it("changing the passphrase re-wraps the same data key; the old one stops working", () => {
    const { dir, ev } = encryptedCase();
    const file = JSON.parse(readFileSync(path.join(dir, CASE_KEY), "utf8")) as CaseKeyFile;
    const next = changePassphrase(file, PASS, "a brand new passphrase", FAST);
    expect(next.wrapped.ct).not.toBe(file.wrapped.ct);
    expect(() => unlockCaseKey(next, PASS)).toThrow(WrongPassphraseError);
    writeFileSync(path.join(dir, CASE_KEY), JSON.stringify(next));
    const c = openCase(dir, { actor: "x", passphrase: "a brand new passphrase" });
    expect(new TextDecoder().decode(c.blobs.get(ev.sha256))).toBe(SECRET_BLOB);
    c.close();
  });

  it("guards: short passphrases, a key file from another case, a passphrase for an unencrypted case", () => {
    expect(() => createCaseKey("01J00000000000000000000001", "short", FAST)).toThrow(/at least 8/);
    const a = encryptedCase();
    const b = encryptedCase();
    writeFileSync(path.join(a.dir, CASE_KEY), readFileSync(path.join(b.dir, CASE_KEY)));
    expect(() => openCase(a.dir, { actor: "x", passphrase: PASS })).toThrow(/belongs to case/);
    const plain = tmp();
    openCase(plain, { actor: "x", create: { title: "t", purpose: "a stated purpose", legalBasis: "self_assessment" } }).close();
    expect(() => openCase(plain, { actor: "x", passphrase: PASS })).toThrow(/not encrypted/);
  });
});
