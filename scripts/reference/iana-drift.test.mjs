/**
 * Unit tests for the IANA drift tool. No network access: the tests build local
 * fixture files and invoke the tool's logic directly through child processes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const tool = path.join(repoRoot, "scripts/reference/iana-drift.mjs");
const snapshotDir = path.join(repoRoot, "docs/adr/reference/iana");

function runTool(args) {
  try {
    const stdout = execFileSync("node", [tool, ...args], { encoding: "utf8" });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

test("identical copies report OK and exit 0", () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "iana-drift-"));
  const v4 = path.join(tmp, "v4.csv");
  const v6 = path.join(tmp, "v6.csv");
  copyFileSync(path.join(snapshotDir, "iana-ipv4-special-purpose-registry.csv"), v4);
  copyFileSync(path.join(snapshotDir, "iana-ipv6-special-purpose-registry.csv"), v6);
  const res = runTool(["--ipv4", v4, "--ipv6", v6]);
  assert.equal(res.code, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /ipv4: OK/);
  assert.match(res.stdout, /ipv6: OK/);
});

test("a modified copy is reported as DRIFT and exits 1", () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "iana-drift-"));
  const v4 = path.join(tmp, "v4.csv");
  const v6 = path.join(tmp, "v6.csv");
  const saved = readFileSync(path.join(snapshotDir, "iana-ipv4-special-purpose-registry.csv"), "utf8");
  // Flip one byte of content: a registry row changed upstream.
  const modified = saved.replace("0.0.0.0/8", "0.0.0.0/9");
  assert.notEqual(modified, saved, "fixture must actually differ");
  writeFileSync(v4, modified);
  copyFileSync(path.join(snapshotDir, "iana-ipv6-special-purpose-registry.csv"), v6);
  const res = runTool(["--ipv4", v4, "--ipv6", v6]);
  assert.equal(res.code, 1, "drift must exit 1");
  assert.match(res.stderr + res.stdout, /ipv4: DRIFT/);
  assert.match(res.stderr + res.stdout, /sha256/);
});

test("a missing fetched copy fails closed with exit 1", () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "iana-drift-"));
  const v6 = path.join(tmp, "v6.csv");
  copyFileSync(path.join(snapshotDir, "iana-ipv6-special-purpose-registry.csv"), v6);
  // No --ipv4 provided at all: cannot verify, must fail closed.
  const res = runTool(["--ipv6", v6]);
  assert.equal(res.code, 1);
  assert.match(res.stderr + res.stdout, /cannot verify/i);
});

test("a non-existent fetched path fails closed with exit 1", () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "iana-drift-"));
  const v6 = path.join(tmp, "v6.csv");
  copyFileSync(path.join(snapshotDir, "iana-ipv6-special-purpose-registry.csv"), v6);
  const res = runTool(["--ipv4", path.join(tmp, "missing.csv"), "--ipv6", v6]);
  assert.equal(res.code, 1);
  assert.match(res.stderr + res.stdout, /cannot read fetched copy|DRIFT/i);
});

test("no arguments prints the fetch instructions and exits 1", () => {
  const res = runTool([]);
  assert.equal(res.code, 1);
  assert.match(res.stderr + res.stdout, /curl -o <ipv4\.csv>/);
  assert.match(res.stderr + res.stdout, /curl -o <ipv6\.csv>/);
});
