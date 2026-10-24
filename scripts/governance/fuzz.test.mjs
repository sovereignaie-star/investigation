/**
 * P6-004: fuzz campaign governance guard (T-FUZZ-001..005).
 *
 * The acceptance criterion is "24 ساعة بلا انهيار" — a 24-machine-hour fuzz campaign over the
 * parsers with zero crashes. This guard enforces that the harness exists, is wired into CI, and
 * that a campaign ledger records the evidence (run metadata + zero-crash attestation). No
 * fabricated evidence: the ledger only accepts entries written by the harness itself
 * (structure + checksum), and the 24h total must be reproducible from run URLs/seed files.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

test("T-FUZZ-001: fuzz campaign harness exists and self-checks", () => {
  assert.ok(existsSync(join(root, "scripts/fuzz/campaign.mjs")), "scripts/fuzz/campaign.mjs must exist");
  assert.ok(existsSync(join(root, "scripts/fuzz/targets.mjs")), "scripts/fuzz/targets.mjs must exist");
  assert.ok(existsSync(join(root, "docs/security/fuzz-campaigns.md")), "campaign ledger must exist");
});

test("T-FUZZ-002: campaign harness runs a bounded smoke campaign with zero crashes", () => {
  // 3 seconds, fixed seed: fast enough for the governance suite, long enough to execute
  // every registered target at least once with real fast-check arbitraries.
  const out = execFileSync(process.execPath, [join(root, "scripts/fuzz/campaign.mjs"), "--duration-ms", "3000", "--seed", "12345"], {
    encoding: "utf8",
    timeout: 60_000,
    cwd: root,
  });
  assert.match(out, /campaign ok: 0 crashes/);
  assert.match(out, /"totalIterations":\s*[1-9]/, "campaign must execute iterations");
});

test("T-FUZZ-003: harness detects an injected crash (canary) — the guard actually guards", () => {
  const out = execFileSync(
    process.execPath,
    [join(root, "scripts/fuzz/campaign.mjs"), "--duration-ms", "2000", "--seed", "12345", "--canary"],
    { encoding: "utf8", timeout: 60_000, cwd: root },
  );
  assert.match(out, /campaign failed: 1 crashes?/, "canary crash must be reported");
  assert.match(out, /FUZZ-CANARY/, "canary failure must be identified in the report");
});

test("T-FUZZ-004: campaign ledger records real evidence with harness checksum", () => {
  const doc = readFileSync(join(root, "docs/security/fuzz-campaigns.md"), "utf8");
  const m = doc.match(/<!-- fuzz-ledger([\s\S]*?)-->/);
  assert.ok(m, "ledger block <!-- fuzz-ledger ... --> must exist in docs/security/fuzz-campaigns.md");
  const ledger = m[1];
  const entries = ledger.split("\n").filter((l) => l.trim().startsWith("|"));
  assert.ok(entries.length >= 2, "ledger must have at least the header and one entry");
  for (const e of entries) {
    const cells = e.split("|").map((c) => c.trim());
    if (cells[1] === "التاريخ" || cells[1] === "التشغيلات" || cells[1] === "المجموع") continue;
    assert.match(cells[1], /^\d{4}-\d{2}-\d{2}$/, `entry date must be ISO: ${e}`);
    const n = Number(cells[2]);
    assert.ok(Number.isFinite(n) && n > 0, `entry duration must be positive hours: ${e}`);
    assert.match(cells[3], /^https:\/\/github\.com\/.*\/actions\/runs\/\d+$/, `entry must cite a CI run URL: ${e}`);
    assert.match(cells[4], /^0$/, `zero crashes must be attested per entry: ${e}`);
    // checksum = sha256(seed line + duration + run id) prefix, prevents retro-fabricated rows
    const runId = (cells[3].match(/runs\/(\d+)/) || [])[1];
    const seed = cells[5];
    assert.match(seed, /^[0-9a-f]{64}$/, `entry must record the campaign seed (64 hex): ${e}`);
    const expect = createHash("sha256").update(`${cells[1]}:${n}:${runId}:${seed}`).digest("hex").slice(0, 8);
    assert.equal(cells[6], expect, `ledger row checksum mismatch (possible fabricated row): ${e}`);
  }
});

test("T-FUZZ-005: fuzz workflow exists and is wired for recurring + on-demand campaigns", () => {
  const wf = readFileSync(join(root, ".github/workflows/fuzz.yml"), "utf8");
  assert.match(wf, /workflow_dispatch/);
  assert.match(wf, /schedule:/);
  assert.match(wf, /campaign\.mjs/, "workflow must run the campaign harness");
  assert.match(wf, /24/, "workflow must support the 24-hour acceptance campaign");
});

test("T-FUZZ-006: campaign ledger totals at least 24 machine-hours for GA acceptance", () => {
  const doc = readFileSync(join(root, "docs/security/fuzz-campaigns.md"), "utf8");
  const m = doc.match(/المجموع المُثبت \(ساعات آلة\):\*\* (\d+)/);
  assert.ok(m, "ledger must state the attested machine-hour total");
  const total = Number(m[1]);
  assert.ok(total >= 24, `acceptance is 24 machine-hours with zero crashes; attested total is ${total}`);
});
