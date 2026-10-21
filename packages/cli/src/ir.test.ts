import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { manualClock, seededRandom, systemClock, ulidFactory } from "@ir/core";
import { checkpoint, generateInstallationKey, signCheckpoint } from "@ir/ledger";
import { CASE_DB, openCase, verifyCase } from "@ir/store";
import { claimCheck, main, monitorSleep } from "./ir.ts";

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
/** The seq of the last entry — the fixture chain is never empty, and the check says so. */
function lastSeq(entries: readonly { seq: number }[]): number {
  const last = entries.at(-1);
  if (last === undefined) throw new Error("fixture chain must not be empty");
  return last.seq;
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

/** `run` with injected CLI options (P4-009 scheduler tests drive the clock, the sleep and the signal). */
const runWith = async (args: string[], opts: NonNullable<Parameters<typeof main>[3]>) => {
  const out: string[] = [];
  const code = await main(
    args,
    (s) => out.push(s),
    (s) => out.push(s),
    opts,
  );
  return { code, text: out.join("\n") };
};

/** The simulation-world rules of one monitored source; rewriting the file changes what the next fetch sees. */
function simRules(dir: string, server: string): string {
  const file = path.join(dir, "..", `${path.basename(dir)}.rules.json`);
  writeFileSync(
    file,
    JSON.stringify([
      {
        match: "https://example.com/",
        response: { status: 200, headers: { "content-type": "text/html", server }, body: "<html>ok</html>" },
      },
    ]),
  );
  return file;
}

/** The `--json` shape of `ir monitor list` (P4-009). */
interface MonitorListJson {
  monitors: Array<{
    id: string;
    transformId: string;
    subjectType: string;
    subjectValue: string;
    subjectKey: string;
    intervalMinutes: number;
    removed?: boolean;
    checks: Array<{
      checkId: string;
      status: string;
      at: string;
      superseded?: boolean;
      changed?: boolean;
      alert?: { added: string[]; removed: string[]; changed: string[] };
      error?: string;
    }>;
    alertCount: number;
  }>;
}

/** Runs `ir monitor list --json` and returns the parsed monitors. */
const monitors = async (dir: string): Promise<MonitorListJson["monitors"]> =>
  (JSON.parse((await run(["monitor", dir, "list", "--json"])).text) as MonitorListJson).monitors;

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

/**
 * P4-008 (T-TIME-006..010/UC-09): `ir diff` — مقارنة لقطتين من سلسلة القضية بالمفاتيح
 * القانونية. الجولة الحمراء: الأمر غير موجود قبل التنفيذ (خروج 2 من الاستعمال) —
 * موثقة في WORKLOG قبل أي تنفيذ (قاعدة J-1).
 */
describe("ir diff (P4-008)", () => {
  function makeDiffCase() {
    const dir = mkdtempSync(path.join(tmpdir(), "ir-diff-"));
    dirs.push(dir);
    const clock = manualClock("2026-10-10T13:00:00.000Z");
    const c = openCase(dir, {
      actor: "analyst",
      clock,
      create: { title: "t", purpose: "مراجعة بنية تحتية", legalBasis: "security_incident" },
    });
    const id = ulidFactory(clock, seededRandom(7));
    const entity = (type: string, value: string) => {
      const entityId = id();
      c.ledger.append("entity.added", {
        id: entityId,
        type,
        canonicalKey: `${type}:${value}`,
        labels: { en: value },
        props: {},
      });
      return entityId;
    };
    const alice = entity("person", "alice");
    const bob = entity("person", "bob");
    c.ledger.append("claim.added", {
      id: id(),
      subjectId: alice,
      predicate: "knows",
      objectId: bob,
      validFrom: null,
      validTo: null,
      occurredFrom: null,
      occurredTo: null,
      confidence: 0.8,
      explanation: "fixture",
    });
    const fromSeq = lastSeq(c.ledger.entries());
    const dave = entity("person", "dave");
    c.ledger.append("claim.added", {
      id: id(),
      subjectId: dave,
      predicate: "name",
      value: "Dave",
      validFrom: null,
      validTo: null,
      occurredFrom: null,
      occurredTo: null,
      confidence: 0.8,
      explanation: "fixture",
    });
    c.ledger.append("merge.decided", {
      id: id(),
      entityIds: [alice, bob],
      survivorId: alice,
      reasons: ["same person"],
      decidedBy: "analyst",
      decidedAt: "2026-10-10T13:00:00.000Z",
      reverted: false,
    });
    const toSeq = lastSeq(c.ledger.entries());
    c.close();
    return { dir, fromSeq, toSeq };
  }

  it("diffs two snapshots of one case by legal keys and prints the counts (UC-09)", async () => {
    const { dir, fromSeq, toSeq } = makeDiffCase();
    const a = await run(["diff", dir, "--from", String(fromSeq), "--to", String(toSeq)]);
    expect(a.code).toBe(0);
    expect(a.text).toContain(`diff seq ${fromSeq} -> ${toSeq}`);
    expect(a.text).toMatch(/entities \+1 -1 ~1/);
    expect(a.text).toMatch(/claims \+1 -0 ~1/);
  });

  it("diffing a snapshot against itself reports an empty diff", async () => {
    const { dir, toSeq } = makeDiffCase();
    const a = await run(["diff", dir, "--from", String(toSeq), "--to", String(toSeq)]);
    expect(a.code).toBe(0);
    expect(a.text).toMatch(/entities \+0 -0 ~0/);
    expect(a.text).toMatch(/claims \+0 -0 ~0/);
  });

  it("rejects a non-integer --from or --to with the usage error", async () => {
    const { dir } = makeDiffCase();
    expect((await run(["diff", dir, "--from", "x", "--to", "1"])).code).toBe(2);
    expect((await run(["diff", dir, "--from", "1", "--to", "y"])).code).toBe(2);
  });

  it("serves the machine-readable diff with --json", async () => {
    const { dir, fromSeq, toSeq } = makeDiffCase();
    const a = await run(["diff", dir, "--from", String(fromSeq), "--to", String(toSeq), "--json"]);
    expect(a.code).toBe(0);
    const parsed = JSON.parse(a.text) as {
      fromSeq: number;
      toSeq: number;
      counts: { entities: { added: number; removed: number; changed: number } };
    };
    expect(parsed.fromSeq).toBe(fromSeq);
    expect(parsed.toSeq).toBe(toSeq);
    expect(parsed.counts.entities).toEqual({ added: 1, removed: 1, changed: 1 });
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

describe("ir project (P2-014: network log)", () => {
  it("prints the network log line and includes the full log in --json", async () => {
    const { dir } = makeCase();
    const a = await run(["project", dir]);
    expect(a.code).toBe(0);
    // the case's one evidence entry is a DNS request outcome — a stored response, not a LOCAL run record
    expect(a.text).toMatch(
      /network \(P2-014\): 0 requests \(0 not allowed\), 0 transport calls, 1 stored outcomes \(network: 0, sim: 0, replay: 0, unknown: 1\)/,
    );
    const json = JSON.parse((await run(["project", dir, "--json"])).text) as {
      networkLog: { requests: unknown[]; responses: Array<{ url: string; method: string }> };
    };
    expect(json.networkLog.requests).toEqual([]);
    expect(json.networkLog.responses).toEqual([expect.objectContaining({ url: "dns:example.com/NS", method: "DNS" })]);
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

describe("ir run (P3-020)", () => {
  /**
   * P3-020 / UC-05: TR-016 must be runnable from the CLI on the simulation world — the
   * roadmap row promises «عنوان/معاملة ← معاملات، أرصدة», and the wallet journey's output
   * is transactions and related addresses. This test was written BEFORE the registration
   * and failed red with exit 2 (unknown transform).
   */
  it("runs TR-016 on a bitcoin_address subject in the simulation world and expands transactions and counterparties", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ir-run-btc-"));
    dirs.push(dir);
    const rules = path.join(dir, "..", `${path.basename(dir)}.rules.json`);
    writeFileSync(
      rules,
      JSON.stringify([
        {
          match: "https://mempool.space/api/address/1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
          response: {
            status: 200,
            body: JSON.stringify({
              address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
              chain_stats: { funded_txo_sum: 100000, spent_txo_sum: 20000, tx_count: 2 },
            }),
          },
        },
        {
          match: "https://mempool.space/api/address/1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa/txs",
          response: {
            status: 200,
            body: JSON.stringify([
              {
                txid: "f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16",
                vin: [{ prevout: { scriptpubkey_address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa" } }],
                vout: [{ scriptpubkey_address: "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2" }],
              },
            ]),
          },
        },
      ]),
    );
    dirs.push(rules);
    const r = await run(["run", dir, "TR-016", "bitcoin_address", "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", "--sim", rules]);
    expect(r.code).toBe(0);
    expect(r.text).toContain("ir run: TR-016 on bitcoin_address:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa");
    expect(r.text).toContain("has_balance");
    expect(r.text).toContain("has_transaction");
    expect(r.text).toContain("transacted_with");
    // the ledger holds the subject, the counterparty and the transaction hash as nodes
    const p = await run(["project", dir]);
    expect(p.code).toBe(0);
    expect(p.text).toContain("nodes 3"); // subject + counterparty + tx hash
  });

  /**
   * P3-020 / UC-05 acceptance: a well-formed address with a wrong Base58Check checksum is
   * refused at the CLI subject gate — BEFORE the case is even opened, before any request.
   * Written BEFORE the builder's checksum check existed: it failed red with exit 0 (the run
   * reached the transform, which rejected it as a run error, after opening the case).
   */
  it("refuses a well-formed bitcoin_address with a bad checksum before opening the case", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ir-run-badck-"));
    dirs.push(dir);
    const r = await run(["run", dir, "TR-016", "bitcoin_address", "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNb"]);
    expect(r.code).toBe(2);
    expect(r.text).toContain("checksum");
    // fail-closed: the refusal happened before the case was touched — no case was created
    expect(existsSync(path.join(dir, CASE_DB))).toBe(false);
  });

  /**
   * P3-020 / UC-06: TR-012 must be runnable from the CLI, and the run's documented post-step
   * (the transform's own header: «تسلسل WARC خطوة معالجة لاحقة خارج المحوّل») must store the
   * WARC container as case evidence alongside the raw response — with its own sha256 and
   * fetch time, and a WARC-Payload-Digest equal to the raw body's hash. Written BEFORE both
   * existed: it failed red with exit 2 (unknown transform).
   */
  it("runs TR-012 on a url subject and stores the WARC archive as evidence beside the raw response", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ir-run-warc-"));
    dirs.push(dir);
    const rules = path.join(dir, "..", `${path.basename(dir)}.rules.json`);
    writeFileSync(
      rules,
      JSON.stringify([
        {
          match: "https://example.com/",
          response: { status: 200, headers: { "content-type": "text/html" }, body: "<html><body>warc page</body></html>" },
        },
      ]),
    );
    dirs.push(rules);
    const r = await run(["run", dir, "TR-012", "url", "https://example.com/", "--sim", rules]);
    expect(r.code).toBe(0);
    expect(r.text).toContain("ir run: TR-012 on url:https://example.com/");
    expect(r.text).toContain("has_content_hash");
    expect(r.text).toContain("has_archive_snapshot");
    // the case holds BOTH evidences: the raw response and the WARC container of it
    const c = openCase(dir, { readOnly: true, skipChainCheck: true, actor: "test" });
    try {
      const stored = c.ledger
        .entries()
        .filter((e) => e.kind === "evidence.stored")
        .map((e) => e.payload as { mime: string; sha256: string; request: { url: string } });
      expect(stored).toHaveLength(2);
      const raw = stored.find((e) => e.mime === "text/html");
      const warc = stored.find((e) => e.mime === "application/warc");
      expect(raw?.request.url).toBe("https://example.com/");
      expect(warc?.request.url).toBe("https://example.com/");
      // the WARC container is a real WARC/1.0 response record for the target, and its
      // payload digest equals the raw body's own hash
      expect(warc).toBeDefined();
      expect(raw).toBeDefined();
      const warcSha = warc?.sha256 ?? "";
      const bytes = c.blobs.get(warcSha);
      const text = new TextDecoder().decode(bytes);
      expect(text).toContain("WARC/1.0");
      expect(text).toContain("WARC-Type: response");
      expect(text).toContain("WARC-Target-URI: https://example.com/");
      expect(text).toContain(`WARC-Payload-Digest: sha256:${raw?.sha256 ?? ""}`);
      // and the archived page itself is inside the container
      expect(text).toContain("warc page");
    } finally {
      c.close();
    }
  });
});

describe("ir import (P2-031: local receiver dumps)", () => {
  /** A case with a real purpose (the import binds real recorded data, not the simulation world). */
  function makeImportCase() {
    const dir = mkdtempSync(path.join(tmpdir(), "ir-import-"));
    dirs.push(dir);
    openCase(dir, {
      actor: "analyst",
      create: { title: "t", purpose: "مراجعة بنية تحتية", legalBasis: "security_incident" },
    }).close();
    return dir;
  }

  const ADSB = JSON.stringify({
    now: 1792317600, // 2026-10-18T10:00:00Z
    aircraft: [{ hex: "3c6444", flight: "UAL123", lat: 52.52, lon: 13.405, alt_baro: 35000 }],
  });
  const AIS = [
    JSON.stringify({ rxtime: "20261018100000", scaled: true, mmsi: 246003000, lon: 4.263965, lat: 52.099342, speed: 12.3, course: 270 }),
  ].join("\n");

  it("imports an ADS-B dump into an existing case and prints the counts (exit 0)", async () => {
    const dir = makeImportCase();
    const file = path.join(dir, "aircraft.json");
    writeFileSync(file, ADSB);
    const r = await run(["import", dir, "adsb", file]);
    expect(r.code).toBe(0);
    expect(r.text).toContain("records 1");
    expect(r.text).toContain("rejected 0");
    expect(r.text).toContain("sha256 ");
  });

  it("imports an AIS dump, and --json prints the machine-readable result", async () => {
    const dir = makeImportCase();
    const file = path.join(dir, "ais.ndjson");
    writeFileSync(file, AIS);
    const r = await run(["import", dir, "ais", file, "--json"]);
    expect(r.code).toBe(0);
    const json = JSON.parse(r.text) as { records: number; rejected: number; claims: number };
    expect(json.records).toBe(1);
    expect(json.rejected).toBe(0);
    expect(json.claims).toBeGreaterThan(0);
  });

  it("a new case is only created with a real --purpose and --legal-basis (E-01)", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ir-import-new-"));
    dirs.push(dir);
    const file = path.join(dir, "ais.ndjson");
    writeFileSync(file, AIS);
    expect((await run(["import", dir, "ais", file])).code).toBe(2);
    const r = await run(["import", dir, "ais", file, "--purpose", "مراجعة بنية تحتية مصرح بها", "--legal-basis", "security_incident"]);
    expect(r.code).toBe(0);
  });

  it("usage errors: unknown kind, missing file and wrong arity exit 2", async () => {
    const dir = makeImportCase();
    const file = path.join(dir, "ais.ndjson");
    writeFileSync(file, AIS);
    expect((await run(["import", dir, "nmea", file])).code).toBe(2);
    expect((await run(["import", dir, "ais", path.join(dir, "missing.ndjson")])).code).toBe(2);
    expect((await run(["import", dir, "ais"])).code).toBe(2);
  });
});

describe("ir monitor (P4-009)", () => {
  /** A fresh case + a monitor on TR-010 over one simulated URL, with rules the test rewrites between checks. */
  async function monitoredCase(every: string) {
    const dir = mkdtempSync(path.join(tmpdir(), "ir-monitor-"));
    dirs.push(dir);
    const rules = simRules(dir, "nginx");
    const add = await run(["monitor", dir, "add", "TR-010", "url", "https://example.com/", "--every", every]);
    expect(add.code).toBe(0);
    return { dir, rules, id: (await monitors(dir))[0].id };
  }

  it("usage errors: missing verb, missing or invalid --every, unknown transform and unknown monitor exit 2", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ir-monitor-usage-"));
    dirs.push(dir);
    const missing = await run(["monitor", dir]);
    expect(missing.code).toBe(2);
    expect(missing.text).toContain("ir monitor:");
    expect((await run(["monitor", dir, "add", "TR-010", "url", "https://example.com/"])).code).toBe(2);
    const zero = await run(["monitor", dir, "add", "TR-010", "url", "https://example.com/", "--every", "0"]);
    expect(zero.code).toBe(2);
    expect(zero.text).toContain("--every");
    expect((await run(["monitor", dir, "add", "TR-010", "url", "https://example.com/", "--every", "abc"])).code).toBe(2);
    expect((await run(["monitor", dir, "add", "TR-999", "url", "https://example.com/", "--every", "5"])).code).toBe(2);
    const add = await run(["monitor", dir, "add", "TR-010", "url", "https://example.com/", "--every", "5"]);
    expect(add.code).toBe(0);
    const unknown = await run(["monitor", dir, "check", "m-does-not-exist"]);
    expect(unknown.code).toBe(2);
    expect(unknown.text).toContain("m-does-not-exist");
  });

  it("add schedules a monitor on the case's audit chain and list shows it", async () => {
    const { dir } = await monitoredCase("5");
    const list = await run(["monitor", dir, "list"]);
    expect(list.code).toBe(0);
    expect(list.text).toContain("TR-010");
    expect(list.text).toContain("every 5m");
    expect(list.text).toContain("checks 0");
    expect(list.text).toContain("alerts 0");
    // the configuration is an audit event on the case chain (the proxy.set pattern)
    const c = openCase(dir, { actor: "test" });
    const scheduled = c.auditTrail().filter((e) => e.action === "monitor.scheduled");
    c.close();
    expect(scheduled).toHaveLength(1);
  });

  it("adding the same subject twice (in an equivalent spelling) does not create a second monitor", async () => {
    const { dir } = await monitoredCase("5");
    const again = await run(["monitor", dir, "add", "TR-010", "url", "HTTPS://Example.com/", "--every", "5"]);
    expect(again.code).toBe(0);
    expect(again.text).toContain("already scheduled");
    expect((await monitors(dir)).length).toBe(1);
    // re-adding with a different interval updates the same monitor (latest wins), it does not duplicate it
    const updated = await run(["monitor", dir, "add", "TR-010", "url", "https://example.com/", "--every", "10"]);
    expect(updated.code).toBe(0);
    expect(updated.text).toContain("every 10m");
    expect((await monitors(dir)).length).toBe(1);
    expect((await monitors(dir))[0].intervalMinutes).toBe(10);
  });

  it("a check runs the transform through the real engine: the first success establishes the baseline without an alert", async () => {
    const { dir, rules, id } = await monitoredCase("5");
    const r = await run(["monitor", dir, "check", id, "--sim", rules]);
    expect(r.code).toBe(0);
    expect(r.text).toContain("baseline established");
    expect(r.text).toContain("findings 2");
    expect(r.text).not.toContain("ALERT");
    const m = (await monitors(dir))[0];
    expect(m.checks).toHaveLength(1);
    expect(m.checks[0].status).toBe("success");
    expect(m.checks[0].changed).toBe(false);
    expect(m.alertCount).toBe(0);
  });

  it("no change on the next check: no alert, and the check is still logged (UC-10: تسجيل كل فحص)", async () => {
    const { dir, rules, id } = await monitoredCase("5");
    await run(["monitor", dir, "check", id, "--sim", rules]);
    const r = await run(["monitor", dir, "check", id, "--sim", rules]);
    expect(r.code).toBe(0);
    expect(r.text).toContain("no change");
    expect(r.text).not.toContain("ALERT");
    const m = (await monitors(dir))[0];
    expect(m.checks).toHaveLength(2); // every check is logged, changed or not
    expect(m.alertCount).toBe(0);
  });

  it("a real change alerts once, the unchanged re-check does not repeat it, and returning to the old state alerts again", async () => {
    const { dir, id } = await monitoredCase("5");
    const rulesA = simRules(dir, "nginx");
    await run(["monitor", dir, "check", id, "--sim", rulesA]); // baseline: nginx
    await run(["monitor", dir, "check", id, "--sim", rulesA]); // no change
    const rulesB = simRules(dir, "apache");
    const changed = await run(["monitor", dir, "check", id, "--sim", rulesB]);
    expect(changed.code).toBe(0);
    expect(changed.text).toContain("CHANGED");
    expect(changed.text).toContain("ALERT");
    expect(changed.text).toContain("has_technology");
    const again = await run(["monitor", dir, "check", id, "--sim", rulesB]); // same new state: no repeat
    expect(again.code).toBe(0);
    expect(again.text).toContain("no change");
    const rulesA2 = simRules(dir, "nginx"); // the file is rewritten in place: the source returns to the old state
    const back = await run(["monitor", dir, "check", id, "--sim", rulesA2]); // return to the old state is a NEW change
    expect(back.code).toBe(0);
    expect(back.text).toContain("ALERT");
    const m = (await monitors(dir))[0];
    expect(m.checks).toHaveLength(5);
    expect(m.alertCount).toBe(2); // exactly one alert per state transition, never a duplicate
  });

  it("a failed check is logged with its error, changes nothing about the baseline, and alerts nothing", async () => {
    const { dir, id } = await monitoredCase("5");
    const rulesA = simRules(dir, "nginx");
    await run(["monitor", dir, "check", id, "--sim", rulesA]); // baseline: nginx
    // the source now fails: the check fails (exit 1), is logged as failed, and the baseline survives
    const failing = path.join(path.dirname(rulesA), "failing.rules.json");
    writeFileSync(failing, JSON.stringify([{ match: "https://example.com/", failure: { kind: "transport:timeout" } }]));
    const fail = await run(["monitor", dir, "check", id, "--sim", failing]);
    expect(fail.code).toBe(1);
    expect(fail.text).toContain("failed");
    const m = (await monitors(dir))[0];
    expect(m.checks).toHaveLength(2);
    expect(m.checks[1].status).toBe("failed");
    expect(m.checks[1].alert).toBeUndefined();
    expect(m.alertCount).toBe(0);
    // the source recovers to the SAME state: no change vs the surviving baseline, no alert
    const ok = await run(["monitor", dir, "check", id, "--sim", rulesA]);
    expect(ok.code).toBe(0);
    expect(ok.text).toContain("no change");
  });

  it("remove unschedules a monitor and a check on it is refused", async () => {
    const { dir, id } = await monitoredCase("5");
    const rm = await run(["monitor", dir, "remove", id]);
    expect(rm.code).toBe(0);
    const m = (await monitors(dir))[0];
    expect(m.removed).toBe(true);
    const check = await run(["monitor", dir, "check", id]);
    expect(check.code).toBe(2);
  });

  it("the scheduler runs only DUE checks: --once checks an overdue monitor and skips one checked moments ago", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ir-monitor-run-"));
    dirs.push(dir);
    const rules = simRules(dir, "nginx");
    const clock = manualClock("2026-10-22T10:00:00.000Z");
    const add = await runWith(["monitor", dir, "add", "TR-010", "url", "https://example.com/", "--every", "5"], { clock });
    expect(add.code).toBe(0);
    const id = (await monitors(dir))[0].id;
    // a check run now (at t0) makes the monitor not due again until t0+5m
    const check = await runWith(["monitor", dir, "check", id, "--sim", rules], { clock });
    expect(check.code).toBe(0);
    const notDue = await runWith(["monitor", dir, "run", "--once", "--sim", rules], { clock });
    expect(notDue.code).toBe(0);
    expect(notDue.text).toContain("0 due");
    expect((await monitors(dir))[0].checks).toHaveLength(1); // nothing ran
    // 6 minutes later the monitor is due: --once runs exactly one catch-up check (no compensatory flood)
    clock.advance(6 * 60_000);
    const due = await runWith(["monitor", dir, "run", "--once", "--sim", rules], { clock });
    expect(due.code).toBe(0);
    expect(due.text).toContain("1 due");
    expect((await monitors(dir))[0].checks).toHaveLength(2);
  });

  it("the scheduler loop honors the interval with the injected clock and sleep, and stops cleanly on the signal", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ir-monitor-loop-"));
    dirs.push(dir);
    const rules = simRules(dir, "nginx");
    const clock = manualClock("2026-10-22T10:00:00.000Z");
    await runWith(["monitor", dir, "add", "TR-010", "url", "https://example.com/", "--every", "1"], { clock });
    const controller = new AbortController();
    let wake: (() => void) | undefined;
    const sleeps: number[] = [];
    const loop = runWith(["monitor", dir, "run", "--sim", rules], {
      clock,
      signal: controller.signal,
      sleep: (ms, signal) =>
        new Promise<void>((resolve) => {
          sleeps.push(ms);
          wake = resolve;
          signal.addEventListener("abort", () => resolve());
        }),
    });
    // the never-checked monitor is due immediately: check #1 runs before the first sleep
    await waitUntil(async () => (await monitors(dir))[0].checks.length === 1);
    // the loop sleeps until the next due time (t0 + 1m), capped at the 60 s poll
    await waitUntil(async () => sleeps.length === 1);
    expect(sleeps[0]).toBe(60_000);
    // 2 minutes pass while the loop sleeps: on wake the monitor is due again → check #2
    clock.advance(2 * 60_000);
    wake?.();
    await waitUntil(async () => (await monitors(dir))[0].checks.length === 2);
    // the signal stops the loop cleanly (exit 0), never mid-write
    controller.abort();
    const r = await loop;
    expect(r.code).toBe(0);
  });

  it("a FAILED check does not make the monitor due again before the interval elapses (the schedule, not every poll)", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ir-monitor-due-"));
    dirs.push(dir);
    const rules = simRules(dir, "nginx");
    const clock = manualClock("2026-10-22T10:00:00.000Z");
    await runWith(["monitor", dir, "add", "TR-010", "url", "https://example.com/", "--every", "5"], { clock });
    const id = (await monitors(dir))[0].id;
    expect((await runWith(["monitor", dir, "check", id, "--sim", rules], { clock })).code).toBe(0);
    // the interval elapses and the source now fails: the due check FAILS at t0+5m
    clock.advance(5 * 60_000);
    const failing = path.join(dir, "failing.rules.json");
    writeFileSync(failing, JSON.stringify([{ match: "https://example.com/", failure: { kind: "transport:timeout" } }]));
    expect((await runWith(["monitor", dir, "check", id, "--sim", failing], { clock })).code).toBe(1);
    // 30 seconds later the monitor is NOT due again: the failed attempt counts as an attempt
    clock.advance(30_000);
    const notDue = await runWith(["monitor", dir, "run", "--once", "--sim", rules], { clock });
    expect(notDue.code).toBe(0);
    expect(notDue.text).toContain("0 due");
    // a full interval after the failed attempt it is due again (exactly one retry, on schedule)
    clock.advance(5 * 60_000 - 30_000);
    const due = await runWith(["monitor", dir, "run", "--once", "--sim", rules], { clock });
    expect(due.code).toBe(0);
    expect(due.text).toContain("1 due");
  });

  it("two CONCURRENT checks of one monitor alert ONCE (the claim is atomic across handles)", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ir-monitor-race-"));
    dirs.push(dir);
    const rulesA = simRules(dir, "nginx");
    await run(["monitor", dir, "add", "TR-010", "url", "https://example.com/", "--every", "5"]);
    const id = (await monitors(dir))[0].id;
    await run(["monitor", dir, "check", id, "--sim", rulesA]); // baseline: nginx
    const rulesB = simRules(dir, "apache"); // the source changes
    const [r1, r2] = await Promise.all([
      run(["monitor", dir, "check", id, "--sim", rulesB]),
      run(["monitor", dir, "check", id, "--sim", rulesB]),
    ]);
    // exactly one ran the transform and alerted; the other was refused with no second alert
    expect([r1.code, r2.code].sort()).toEqual([0, 2]);
    const m = (await monitors(dir))[0];
    expect(m.alertCount).toBe(1); // ONE alert for the change, never two
    expect(m.checks.filter((k) => k.status === "success")).toHaveLength(2); // baseline + the change check
  });

  it("an interrupted check is visible as incomplete and the next attempt gets a FRESH id (no id reuse)", async () => {
    const { dir, id } = await monitoredCase("5");
    // a check that started and died: a started event with no result, written 11 minutes ago (stale)
    const pastAt = new Date(Date.now() - 11 * 60_000).toISOString(); // 11 minutes ago: beyond IN_FLIGHT_MS
    const past = manualClock(pastAt);
    const c = openCase(dir, { actor: "ir-cli", clock: past });
    c.audit("monitor.check.started", `${id}#1`, { monitorId: id, transformId: "TR-010", at: pastAt });
    c.close();
    // the incomplete attempt is VISIBLE (UC-10: every attempt is on the record, interrupted ones too)
    expect((await monitors(dir))[0].checks.some((k) => k.checkId === `${id}#1` && k.status === "incomplete")).toBe(true);
    // the next attempt does not reuse #1: it runs as #2 (an interrupted attempt's id is never reused)
    const rules = simRules(dir, "nginx");
    const check = await run(["monitor", dir, "check", id, "--sim", rules]);
    expect(check.code).toBe(0);
    const m = (await monitors(dir))[0];
    expect(m.checks.some((k) => k.checkId === `${id}#2`)).toBe(true);
    expect(m.checks.filter((k) => k.status === "incomplete")).toHaveLength(1); // #1 stays incomplete forever
  });

  it("a FRESH in-flight check refuses a second attempt (and the scheduler skips the monitor)", async () => {
    const { dir, id } = await monitoredCase("5");
    // a started event written NOW with no result: the check is in flight
    const c = openCase(dir, { actor: "ir-cli" });
    c.audit("monitor.check.started", `${id}#1`, { monitorId: id, transformId: "TR-010", at: new Date().toISOString() });
    c.close();
    const check = await run(["monitor", dir, "check", id]);
    expect(check.code).toBe(2);
    expect(check.text).toContain("already running");
    const once = await run(["monitor", dir, "run", "--once"]);
    expect(once.text).toContain("0 due"); // the scheduler does not try an in-flight monitor
  });

  it("a ROUTE-SETUP failure of a scheduled monitor is a logged failed attempt (not a silent exit 2)", async () => {
    const { dir, id } = await monitoredCase("5");
    const rules = simRules(dir, "nginx");
    await run(["monitor", dir, "check", id, "--sim", rules]); // baseline
    // the rules file breaks (malformed JSON): the attempt starts, route setup fails
    const broken = path.join(dir, "broken.rules.json");
    writeFileSync(broken, "{ not json");
    const check = await run(["monitor", dir, "check", id, "--sim", broken]);
    expect(check.code).toBe(1);
    expect(check.text).toContain("failed");
    const m = (await monitors(dir))[0];
    const failed = m.checks.find((k) => k.status === "failed");
    expect(failed).toBeDefined();
    // the baseline survived: the source recovers and the next check compares against it, no false alert
    const ok = await run(["monitor", dir, "check", id, "--sim", rules]);
    expect(ok.code).toBe(0);
    expect(ok.text).toContain("no change");
  });

  it("a claim from a head snapshot taken BEFORE another handle's claim is refused (the head is captured before the attempt state)", async () => {
    const { dir } = await monitoredCase("5");
    // a second monitor on another URL: claiming ITS check moves the chain head without tripping the first monitor's in-flight guard
    await run(["monitor", dir, "add", "TR-010", "url", "https://other.example/", "--every", "5"]);
    const list = await monitors(dir);
    const first = list.find((m) => m.subjectValue === "https://example.com/");
    const second = list.find((m) => m.subjectValue === "https://other.example/");
    if (first === undefined || second === undefined) throw new Error("test setup: both monitors must be listed");
    const asCaseMonitor = (m: typeof first) => ({
      id: m.id,
      transformId: m.transformId,
      subjectType: m.subjectType,
      subjectValue: m.subjectValue,
      subjectKey: m.subjectKey,
      intervalMinutes: m.intervalMinutes,
    });
    const cA = openCase(dir, { actor: "ir-cli" });
    const cB = openCase(dir, { actor: "ir-cli" });
    try {
      // B claims the SECOND monitor's check — its write moves the chain head
      const b = claimCheck(cB, asCaseMonitor(second), systemClock);
      expect("error" in b).toBe(false);
      // A had captured the head BEFORE B's claim (the first step of its own claim): A's claim from that
      // stale snapshot must be REFUSED — never a second claim on a case that changed under it
      const a = claimCheck(cA, asCaseMonitor(first), systemClock, (b as { fromSeq: number }).fromSeq);
      expect("error" in a).toBe(true);
      // exactly ONE started event is on the chain — no duplicate attempt
      const started = cA.auditTrail().filter((e) => e.action === "monitor.check.started");
      expect(started).toHaveLength(1);
    } finally {
      cA.close();
      cB.close();
    }
  });

  it("a LATE result from a superseded attempt never becomes the baseline and never alerts (a suspended attempt resuming after a newer claim)", async () => {
    const { dir, id } = await monitoredCase("5");
    // attempt #1 started 11 minutes ago (stale — the process was suspended mid-check)
    const pastAt = new Date(Date.now() - 11 * 60_000).toISOString();
    const c = openCase(dir, { actor: "ir-cli", clock: manualClock(pastAt) });
    c.audit("monitor.check.started", `${id}#1`, { monitorId: id, transformId: "TR-010", at: pastAt });
    c.close();
    // the newer attempt #2 runs while #1 is suspended and establishes the baseline (first success)
    const rules = simRules(dir, "nginx");
    const second = await run(["monitor", dir, "check", id, "--sim", rules]);
    expect(second.code).toBe(0);
    expect(second.text).toContain("baseline established");
    // the suspended attempt RESUMES and commits its result late — exactly the write the old code made unconditionally
    const c2 = openCase(dir, { actor: "ir-cli" });
    c2.audit("monitor.check.result", `${id}#1`, {
      monitorId: id,
      status: "success",
      at: new Date().toISOString(),
      fromSeq: 5,
      findingsCount: 1,
      changed: true,
      alert: { added: ["has_technology|http|other.example|stale"], removed: [], changed: [] },
      state: [
        {
          predicate: "has_technology",
          objectType: "http",
          objectValue: "other.example",
          objectId: "stale",
          confidence: 1,
          explanation: "the suspended attempt's own run",
        },
      ],
    });
    c2.close();
    // the late result is logged but SUPERSEDED: its alert is void and it did not become the baseline
    const m = (await monitors(dir))[0];
    expect(m.alertCount).toBe(0);
    // the next check against the SAME rules as #2 reports "no change" — if #1's state had become the baseline this would alert
    const third = await run(["monitor", dir, "check", id, "--sim", rules]);
    expect(third.code).toBe(0);
    expect(third.text).toContain("no change");
    expect((await monitors(dir))[0].alertCount).toBe(0);
  });

  it("a result event with malformed fields is excluded from the monitor's checks (fail-closed: nothing is cast into a baseline)", async () => {
    const { dir, id } = await monitoredCase("5");
    const c = openCase(dir, { actor: "ir-cli" });
    // state elements that are not findings (a string, a number) — must never be cast into a baseline
    c.audit("monitor.check.result", `${id}#1`, {
      monitorId: id,
      status: "success",
      at: new Date().toISOString(),
      findingsCount: 2,
      changed: false,
      state: ["not-a-finding", 42],
    });
    // an alert whose members are not string arrays — not a comparable alert
    c.audit("monitor.check.result", `${id}#2`, {
      monitorId: id,
      status: "success",
      at: new Date().toISOString(),
      findingsCount: 0,
      changed: true,
      alert: { added: "has_technology", removed: null, changed: [] },
    });
    // a finding with the right shape but wrong field types (confidence a string) — not a finding
    c.audit("monitor.check.result", `${id}#3`, {
      monitorId: id,
      status: "success",
      at: new Date().toISOString(),
      findingsCount: 1,
      changed: false,
      state: [{ predicate: "has_technology", objectType: "http", objectValue: "example.com", confidence: "high", explanation: "x" }],
    });
    c.close();
    const m = (await monitors(dir))[0];
    expect(m.checks).toHaveLength(0);
    expect(m.alertCount).toBe(0);
  });

  it("refuses an encrypted case: add cannot schedule a monitor whose checks could never run", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ir-monitor-enc-"));
    dirs.push(dir);
    openCase(dir, {
      actor: "a",
      passphrase: "passphrase for tests",
      kdf: { memoryKiB: 256, passes: 1, parallelism: 1 },
      create: { title: "t", purpose: "encrypted case test", legalBasis: "self_assessment" },
    }).close();
    const add = await run(["monitor", dir, "add", "TR-010", "url", "https://example.com/", "--every", "5"]);
    expect(add.code).toBe(2);
    expect(add.text).toContain("refusing to schedule a monitor on an encrypted case");
    const check = await run(["monitor", dir, "check", "m-any"]);
    expect(check.code).toBe(2);
    expect(check.text).toContain("refusing to run a transform against an encrypted case");
  });
});

/** Awaits a condition that the CLI's own asynchrony makes eventually true (P4-009 loop tests). */
async function waitUntil(cond: () => Promise<boolean>, tries = 200): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("condition never became true");
}

describe("monitorSleep (P4-009 — the scheduler's default wait)", () => {
  it("resolves on timeout and REMOVES its abort listener (no listener leak over a long scheduler run)", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      let live = 0;
      const signal = controller.signal as AbortSignal & {
        addEventListener: typeof AbortSignal.prototype.addEventListener;
        removeEventListener: typeof AbortSignal.prototype.removeEventListener;
      };
      const origAdd = signal.addEventListener.bind(signal);
      const origRemove = signal.removeEventListener.bind(signal);
      signal.addEventListener = ((type: string, fn: never, opts?: unknown) => {
        live++;
        return origAdd(type, fn, opts as never);
      }) as typeof signal.addEventListener;
      signal.removeEventListener = ((type: string, fn: never, opts?: unknown) => {
        live--;
        return origRemove(type, fn, opts as never);
      }) as typeof signal.removeEventListener;
      for (let i = 0; i < 20; i++) {
        const p = monitorSleep(60_000, signal);
        await vi.advanceTimersByTimeAsync(60_000);
        await p;
        expect(live).toBe(0); // every completed wait cleaned up its own listener
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("resolves immediately on abort (the timer is cleaned, no waiting)", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const p = monitorSleep(60_000, controller.signal);
      controller.abort();
      await p; // resolves without any timer advance
    } finally {
      vi.useRealTimers();
    }
  });

  it("resolves immediately for an ALREADY-aborted signal (no pointless full wait)", async () => {
    const controller = new AbortController();
    controller.abort();
    await monitorSleep(60_000, controller.signal); // hangs (and times the test out) if it waits the full ms
  });
});
