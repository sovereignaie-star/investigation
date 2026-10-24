/**
 * P6-008 — the automated secure-deletion roundtrip (UC-24 acceptance).
 *
 * One case, one blob, one deletion, one certificate:
 *
 *   1. create a case with an evidence blob and a note;
 *   2. verify it (the fixture must be intact);
 *   3. delete it securely (verify → overwrite → unlink → tree gone);
 *   4. verify the signed deletion certificate against the installation key;
 *   5. confirm no leftovers: the directory tree does not exist.
 *
 * Prints "delete ok: … certificate verified … no leftovers" on success.
 * Run by scripts/governance/delete.test.mjs (T-DEL-003).
 *
 * Re-exec pattern: tsx cannot be register()ed (P6-004 lesson) — the script re-execs
 * itself under `node --import tsx/esm` exactly like scripts/backup/roundtrip.mjs.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

if (!process.env.IR_DELETE_REEXEC) {
  const r = spawnSync(process.execPath, ["--no-experimental-strip-types", "--import", "tsx/esm", fileURLToPath(import.meta.url)], {
    stdio: "inherit",
    cwd: here,
    env: { ...process.env, IR_DELETE_REEXEC: "1" },
  });
  process.exit(r.status ?? 1);
}

const { mkdtempSync, rmSync, existsSync } = await import("node:fs");
const { tmpdir } = await import("node:os");

const { manualClock } = await import("../../packages/core/src/clock.ts");
const { generateInstallationKey, verifyDeletionCertificate } = await import("../../packages/ledger/src/signing.ts");
const { openCase, verifyCase, deleteCase } = await import("../../packages/store/src/index.ts");

const dirs = [];
try {
  const clock = manualClock("2026-10-24T12:00:00.000Z");
  const key = generateInstallationKey();

  // 1. a case with one evidence blob and a chain entry
  const caseDir = mkdtempSync(join(tmpdir(), "ir-delete-src-"));
  dirs.push(caseDir);
  const c = openCase(caseDir, {
    actor: "analyst",
    clock,
    create: {
      title: "deletion roundtrip",
      purpose: "مراجعة بنية تحتية",
      legalBasis: "security_incident",
      retention: { mode: "days", days: 1 },
    },
  });
  c.addEvidence({
    bytes: new TextEncoder().encode("P6-008 deletion roundtrip blob"),
    mime: "text/plain",
    request: { method: "DNS", url: "dns:delete.example/NS" },
    transformId: "tr-dns",
    version: "1.0.0",
  });
  c.ledger.append("note.added", { text: "before deletion" });
  c.close();

  // 2. the fixture is intact
  const before = verifyCase(caseDir, {});
  if (!before.ok) throw new Error(`fixture does not verify: ${before.problems.join("; ")}`);

  // 3. secure deletion (verify → overwrite → unlink)
  const crt = deleteCase(caseDir, {
    actor: "analyst",
    reason: "الحذف الآمن — سيناريو الاختبار الآلي",
    key,
    clock,
  });

  // 4. the certificate verifies against the installation key
  const errors = verifyDeletionCertificate(crt, key.publicKeyPem);
  if (errors.length > 0) throw new Error(`deletion certificate does not verify: ${JSON.stringify(errors)}`);

  // 5. no leftovers: the tree is gone
  if (existsSync(caseDir)) throw new Error("the case directory still exists — leftovers remain");

  console.log(
    `delete ok: case ${crt.payload.caseId} deleted (chain ${crt.payload.chainLength}, head ${crt.payload.head.slice(0, 12)}…, blobs ${crt.payload.blobs}, retention ${crt.payload.retentionState}) — certificate verified, no leftovers`,
  );
} finally {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}
