import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { manualClock } from "@ir/core";
import { checkpoint, generateInstallationKey, signCheckpoint } from "@ir/ledger";
import { CASE_DB, openCase, verifyCase } from "@ir/store";
import { main } from "./ir.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function makeCase() {
  const dir = mkdtempSync(path.join(tmpdir(), "ir-verify-"));
  dirs.push(dir);
  const clock = manualClock("2026-10-10T13:00:00.000Z");
  const key = generateInstallationKey();
  const c = openCase(dir, { actor: "analyst", clock });
  c.ledger.append("case.created", { purpose: "مراجعة بنية تحتية" });
  c.addEvidence({
    bytes: new TextEncoder().encode("ns1.example.net"),
    mime: "text/plain",
    request: { method: "DNS", url: "dns:example.com/NS" },
    transformId: "tr-dns",
    version: "1.0.0",
  });
  checkpoint(c.ledger, key, clock);
  c.ledger.append("note.added", { text: "after checkpoint" });
  const published = signCheckpoint(c.ledger.entries(), key, clock);
  c.close();
  const keyFile = path.join(dir, "..", `${path.basename(dir)}.pub`);
  const cpFile = path.join(dir, "..", `${path.basename(dir)}.cp.json`);
  writeFileSync(keyFile, key.publicKeyPem);
  writeFileSync(cpFile, JSON.stringify(published));
  dirs.push(keyFile, cpFile);
  return { dir, keyFile, cpFile };
}
const run = (args: string[]) => {
  const out: string[] = [];
  const code = main(
    args,
    (s) => out.push(s),
    (s) => out.push(s),
  );
  return { code, text: out.join("\n") };
};

describe("ir verify (P1-012)", () => {
  it("reports an intact case as OK with every section, exit 0", () => {
    const { dir, keyFile, cpFile } = makeCase();
    const r = run(["verify", dir, "--key", keyFile, "--checkpoint", cpFile]);
    expect(r.code).toBe(0);
    for (const s of [
      "chain     PASS  4 entries",
      "evidence  PASS  1 blobs re-hashed",
      "signed    PASS  1 embedded",
      "external  PASS",
      "result    OK",
    ])
      expect(r.text).toContain(s);
    const json = run(["verify", dir, "--json", "--key", keyFile]);
    expect(JSON.parse(json.text)).toMatchObject({
      ok: true,
      schemaVersion: 3,
      chain: { length: 4 },
      evidence: { checked: 1, problems: [] },
    });
  });

  it("without --key, signatures are reported as skipped, not passed", () => {
    const { dir } = makeCase();
    const r = run(["verify", dir]);
    expect(r.code).toBe(0);
    expect(r.text).toContain("signed    SKIP");
  });

  it("an edited ledger row, a changed blob and a truncated tail each fail with exit 1 and a located reason", () => {
    const a = makeCase();
    const db = new DatabaseSync(path.join(a.dir, CASE_DB));
    db.exec("DROP TRIGGER ledger_no_update");
    db.exec(`UPDATE ledger SET payload = '{"purpose":"forged"}' WHERE seq = 0`);
    db.close();
    const r1 = run(["verify", a.dir, "--key", a.keyFile]);
    expect(r1.code).toBe(1);
    expect(r1.text).toMatch(/\[entry_hash\] entry 0/);
    expect(r1.text).toContain("INTEGRITY FAILURE");

    const b = makeCase();
    const rep = verifyCase(b.dir);
    const blob =
      rep.evidence.checked === 1 ? new DatabaseSync(path.join(b.dir, CASE_DB)).prepare("SELECT sha256 FROM evidence").get() : undefined;
    const sha = (blob as { sha256: string }).sha256;
    writeFileSync(path.join(b.dir, "blobs", sha.slice(0, 2), sha), "tampered");
    const r2 = run(["verify", b.dir]);
    expect(r2.code).toBe(1);
    expect(r2.text).toMatch(/\[corrupt\] entry 1/);

    const c = makeCase();
    const db3 = new DatabaseSync(path.join(c.dir, CASE_DB));
    db3.exec("DROP TRIGGER ledger_no_delete");
    db3.exec("DELETE FROM ledger WHERE seq = 3");
    db3.close();
    const r3 = run(["verify", c.dir, "--key", c.keyFile, "--checkpoint", c.cpFile]);
    expect(r3.code).toBe(1);
    expect(r3.text).toContain("[truncated]");
  });

  it("usage errors exit 2", () => {
    expect(run([]).code).toBe(2);
    expect(run(["verify"]).code).toBe(2);
    expect(run(["verify", "/nonexistent-case-dir"]).code).toBe(2);
    expect(run(["--help"]).code).toBe(0);
  });

  it("encrypted case: SKIP without a passphrase, full check with --passphrase-file", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ir-verify-enc-"));
    dirs.push(dir);
    const c = openCase(dir, { actor: "a", passphrase: "passphrase for tests", kdf: { memoryKiB: 256, passes: 1, parallelism: 1 } });
    c.append("case.created", { purpose: "p" });
    c.addEvidence({
      bytes: new TextEncoder().encode("x"),
      mime: "text/plain",
      request: { method: "LOCAL", url: "file:x" },
      transformId: "tr-local",
      version: "1.0.0",
    });
    c.close();
    const pf = `${dir}.pass`;
    dirs.push(pf);
    writeFileSync(pf, "passphrase for tests\n");
    const locked = run(["verify", dir]);
    expect(locked.code).toBe(0);
    expect(locked.text).toContain("evidence  SKIP  encrypted case");
    const open = run(["verify", dir, "--passphrase-file", pf]);
    expect(open.code).toBe(0);
    expect(open.text).toContain("evidence  PASS  1 blobs re-hashed");
    writeFileSync(pf, "wrong passphrase!");
    expect(run(["verify", dir, "--passphrase-file", pf]).code).toBe(2);
  });
});
