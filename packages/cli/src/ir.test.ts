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
  const c = openCase(dir, {
    actor: "analyst",
    clock,
    create: { title: "t", purpose: "مراجعة بنية تحتية", legalBasis: "security_incident" },
  });
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
const run = async (args: string[]) => {
  const out: string[] = [];
  const code = await main(
    args,
    (s) => out.push(s),
    (s) => out.push(s),
  );
  return { code, text: out.join("\n") };
};

describe("ir verify (P1-012)", () => {
  it("reports an intact case as OK with every section, exit 0", async () => {
    const { dir, keyFile, cpFile } = makeCase();
    const r = await run(["verify", dir, "--key", keyFile, "--checkpoint", cpFile]);
    expect(r.code).toBe(0);
    for (const s of [
      "chain     PASS  6 entries",
      "evidence  PASS  1 blobs re-hashed",
      "signed    PASS  1 embedded",
      "external  PASS",
      "result    OK",
    ])
      expect(r.text).toContain(s);
    const json = await run(["verify", dir, "--json", "--key", keyFile]);
    expect(JSON.parse(json.text)).toMatchObject({
      ok: true,
      schemaVersion: 3,
      chain: { length: 6 },
      evidence: { checked: 1, problems: [] },
    });
  });

  it("without --key, signatures are reported as skipped, not passed", async () => {
    const { dir } = makeCase();
    const r = await run(["verify", dir]);
    expect(r.code).toBe(0);
    expect(r.text).toContain("signed    SKIP");
  });

  it("an edited ledger row, a changed blob and a truncated tail each fail with exit 1 and a located reason", async () => {
    const a = makeCase();
    const db = new DatabaseSync(path.join(a.dir, CASE_DB));
    db.exec("DROP TRIGGER ledger_no_update");
    db.exec(`UPDATE ledger SET payload = '{"purpose":"forged"}' WHERE seq = 0`);
    db.close();
    const r1 = await run(["verify", a.dir, "--key", a.keyFile]);
    expect(r1.code).toBe(1);
    expect(r1.text).toMatch(/\[entry_hash\] entry 0/);
    expect(r1.text).toContain("INTEGRITY FAILURE");

    const b = makeCase();
    const rep = verifyCase(b.dir);
    const blob =
      rep.evidence.checked === 1 ? new DatabaseSync(path.join(b.dir, CASE_DB)).prepare("SELECT sha256 FROM evidence").get() : undefined;
    const sha = (blob as { sha256: string }).sha256;
    writeFileSync(path.join(b.dir, "blobs", sha.slice(0, 2), sha), "tampered");
    const r2 = await run(["verify", b.dir]);
    expect(r2.code).toBe(1);
    expect(r2.text).toMatch(/\[corrupt\] entry 2/);

    const c = makeCase();
    const db3 = new DatabaseSync(path.join(c.dir, CASE_DB));
    db3.exec("DROP TRIGGER ledger_no_delete");
    db3.exec("DELETE FROM ledger WHERE seq = 5");
    db3.close();
    const r3 = await run(["verify", c.dir, "--key", c.keyFile, "--checkpoint", c.cpFile]);
    expect(r3.code).toBe(1);
    expect(r3.text).toContain("[truncated]");
  });

  it("usage errors exit 2", async () => {
    expect((await run([])).code).toBe(2);
    expect((await run(["verify"])).code).toBe(2);
    expect((await run(["verify", "/nonexistent-case-dir"])).code).toBe(2);
    expect((await run(["--help"])).code).toBe(0);
  });

  it("encrypted case: SKIP without a passphrase, full check with --passphrase-file", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ir-verify-enc-"));
    dirs.push(dir);
    const c = openCase(dir, {
      actor: "a",
      passphrase: "passphrase for tests",
      kdf: { memoryKiB: 256, passes: 1, parallelism: 1 },
      create: { title: "t", purpose: "encrypted case test", legalBasis: "self_assessment" },
    });
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
    const locked = await run(["verify", dir]);
    expect(locked.code).toBe(0);
    expect(locked.text).toContain("evidence  SKIP  encrypted case");
    const open = await run(["verify", dir, "--passphrase-file", pf]);
    expect(open.code).toBe(0);
    expect(open.text).toContain("evidence  PASS  1 blobs re-hashed");
    writeFileSync(pf, "wrong passphrase!");
    expect((await run(["verify", dir, "--passphrase-file", pf])).code).toBe(2);
  });
});

describe("ir project (P1-016)", () => {
  it("rebuilds the views offline, prints a stable hash, and checks --expect", async () => {
    const { dir } = makeCase();
    const a = await run(["project", dir]);
    expect(a.code).toBe(0);
    expect(a.text).toMatch(/projection at seq \d+/);
    const hash = /sha256 ([0-9a-f]{64})/.exec(a.text)?.[1] ?? "";
    expect(hash).toHaveLength(64);
    expect((await run(["project", dir])).text).toContain(hash);
    expect((await run(["project", dir, "--expect", hash])).code).toBe(0);
    expect((await run(["project", dir, "--expect", "0".repeat(64)])).code).toBe(1);
    const json = JSON.parse((await run(["project", dir, "--json", "--at", "0"])).text) as { seq: number; sha256: string };
    expect(json.seq).toBe(0);
    expect(json.sha256).not.toBe(hash);
    expect((await run(["project", dir, "--at", "x"])).code).toBe(2);
    expect((await run(["project", "/nonexistent-case-dir"])).code).toBe(2);
  });
});

describe("ir project on an encrypted case", () => {
  it("needs the passphrase file, and gives the same hash on every run", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ir-project-enc-"));
    dirs.push(dir);
    openCase(dir, {
      actor: "analyst",
      passphrase: "long passphrase",
      kdf: { memoryKiB: 256, passes: 1, parallelism: 1 },
      create: { title: "t", purpose: "مراجعة بنية تحتية", legalBasis: "security_incident" },
    }).close();
    const pf = path.join(dir, "..", `${path.basename(dir)}.pass`);
    writeFileSync(pf, "long passphrase\n");
    dirs.push(pf);
    expect((await run(["project", dir])).code).toBe(2); // locked: payloads are sealed
    const a = await run(["project", dir, "--passphrase-file", pf]);
    expect(a.code).toBe(0);
    const hash = /sha256 ([0-9a-f]{64})/.exec(a.text)?.[1] ?? "";
    expect((await run(["project", dir, "--passphrase-file", pf, "--expect", hash])).code).toBe(0);
  });
});

describe("ir run (P2-022)", () => {
  it("runs TR-010 in the simulation world, stores evidence, and expands findings into the ledger", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ir-run-"));
    dirs.push(dir);
    const rules = path.join(dir, "..", `${path.basename(dir)}.rules.json`);
    writeFileSync(
      rules,
      JSON.stringify([
        {
          match: "https://example.com/",
          response: { status: 200, headers: { "content-type": "text/html", server: "nginx" }, body: "<html>ok</html>" },
        },
      ]),
    );
    dirs.push(rules);
    const r = await run(["run", dir, "TR-010", "url", "https://example.com", "--sim", rules]);
    expect(r.code).toBe(0);
    expect(r.text).toContain("ir run: TR-010 on url:https://example.com");
    expect(r.text).toContain("requests 1");
    expect(r.text).toContain("findings 2");
    expect(r.text).toContain("has_http_response");
    expect(r.text).toContain("has_technology");
    expect(r.text).toContain("expanded: 2 claims, 2 attributes, 0 rejected");
    expect(r.text).toMatch(/sha256 [0-9a-f]{64}/);
    // the ledger now holds the subject entity, evidence, claims and observations
    const p = await run(["project", dir]);
    expect(p.code).toBe(0);
    expect(p.text).toContain("nodes 1");
    expect(p.text).toContain("edges 0"); // http_status/technology are literal attributes, not edges
    expect(p.text).toContain("observations 2");
    expect(p.text).toContain("evidence 1");
  });

  it("a transport failure is recorded as an error observation and exits 1", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ir-run-err-"));
    dirs.push(dir);
    const rules = path.join(dir, "..", `${path.basename(dir)}.rules.json`);
    writeFileSync(rules, JSON.stringify([{ match: "https://example.com/", failure: { kind: "transport:timeout" } }]));
    dirs.push(rules);
    const r = await run(["run", dir, "TR-010", "url", "https://example.com", "--sim", rules]);
    expect(r.code).toBe(1);
    expect(r.text).toContain("ir run:");
    const p = await run(["project", dir]);
    expect(p.code).toBe(0);
    expect(p.text).toContain("observations 1"); // the error observation
  });

  it("reuses an existing subject node instead of duplicating it (D-020)", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ir-run-dedup-"));
    dirs.push(dir);
    const rules = path.join(dir, "..", `${path.basename(dir)}.rules.json`);
    writeFileSync(rules, JSON.stringify([{ match: "https://example.com/", response: { status: 200, body: "ok" } }]));
    dirs.push(rules);
    const a = await run(["run", dir, "TR-010", "url", "https://example.com", "--sim", rules]);
    expect(a.code).toBe(0);
    const b = await run(["run", dir, "TR-010", "url", "https://example.com", "--sim", rules]);
    expect(b.code).toBe(0);
    const p = await run(["project", dir]);
    expect(p.code).toBe(0);
    expect(p.text).toContain("nodes 1"); // still one node after two runs
    expect(p.text).toContain("evidence 2");
  });

  it("--json prints a machine-readable result", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ir-run-json-"));
    dirs.push(dir);
    const rules = path.join(dir, "..", `${path.basename(dir)}.rules.json`);
    writeFileSync(rules, JSON.stringify([{ match: "https://example.com/", response: { status: 200, body: "ok" } }]));
    dirs.push(rules);
    const r = await run(["run", dir, "TR-010", "url", "https://example.com", "--sim", rules, "--json"]);
    expect(r.code).toBe(0);
    const json = JSON.parse(r.text) as {
      transformId: string;
      subject: { type: string; value: string; entityId: string };
      requestCount: number;
      findings: unknown[];
      expand: { claimIds: string[]; attributeCount: number; rejectedCount: number };
      projection: { seq: number; sha256: string };
    };
    expect(json.transformId).toBe("TR-010");
    expect(json.subject).toMatchObject({ type: "url", value: "https://example.com" });
    expect(json.requestCount).toBe(1);
    expect(json.findings).toHaveLength(1);
    expect(json.expand.claimIds).toHaveLength(1);
    expect(json.expand.attributeCount).toBe(1);
    expect(json.projection.sha256).toHaveLength(64);
  });

  it("usage errors: unknown transform, non-identifier subject type, and a bad --sim file exit 2", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ir-run-usage-"));
    dirs.push(dir);
    expect((await run(["run", dir, "TR-999", "url", "https://example.com"])).code).toBe(2);
    expect((await run(["run", dir, "TR-010", "not-a-type", "x"])).code).toBe(2);
    const bad = path.join(dir, "..", `${path.basename(dir)}.bad.json`);
    writeFileSync(bad, "not json");
    dirs.push(bad);
    expect((await run(["run", dir, "TR-010", "url", "https://example.com", "--sim", bad])).code).toBe(2);
    expect((await run(["run", dir, "TR-010", "url"])).code).toBe(2);
  });

  it("refuses an encrypted case (P2-022: simulation/testing tool, sealed payloads add no value)", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ir-run-enc-"));
    dirs.push(dir);
    openCase(dir, {
      actor: "a",
      passphrase: "passphrase for tests",
      kdf: { memoryKiB: 256, passes: 1, parallelism: 1 },
      create: { title: "t", purpose: "encrypted case test", legalBasis: "self_assessment" },
    }).close();
    const r = await run(["run", dir, "TR-010", "url", "https://example.com"]);
    expect(r.code).toBe(2);
    expect(r.text).toContain("refusing to run a transform against an encrypted case");
  });
});
