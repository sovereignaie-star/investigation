/**
 * P6-007 — the automated backup/restore roundtrip (acceptance: "استعادة آلية ناجحة").
 *
 * One case, one blob, one encrypted backup file, one wiped directory, one restored case:
 *
 *   1. create a case with an evidence blob (a known marker payload) + a chain entry;
 *   2. pack it (the signed .irpack: raw chain + blobs + wrapped key);
 *   3. seal the pack into an encrypted backup file (Argon2id + AES-256-GCM);
 *   4. verify the backup file does NOT contain the marker (encryption is real);
 *   5. delete the case directory entirely;
 *   6. decrypt the backup, unpack into a fresh directory (verify + rebuild + re-verify);
 *   7. verifyCase the restored case and read the blob back — the marker must match.
 *
 * Prints "backup ok: …" on success. Run by scripts/governance/backup.test.mjs (T-BK-003).
 *
 * Re-exec pattern: tsx cannot be register()ed (P6-004 lesson) — the script re-execs
 * itself under `node --import tsx/esm` exactly like scripts/perf/run.mjs.
 */
// NOTE: every import below the re-exec guard must be DYNAMIC — ESM hoists static
// imports above module code (same lesson as scripts/perf/run.mjs).
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

if (!process.env.IR_BACKUP_REEXEC) {
  // --no-experimental-strip-types: Node 24's native strip-only mode cannot parse TS
  // parameter properties (packages/store) — tsx's full transform must own every .ts file.
  const r = spawnSync(process.execPath, ["--no-experimental-strip-types", "--import", "tsx/esm", fileURLToPath(import.meta.url)], {
    stdio: "inherit",
    cwd: here,
    env: { ...process.env, IR_BACKUP_REEXEC: "1" },
  });
  process.exit(r.status ?? 1);
}

const { mkdtempSync, rmSync, writeFileSync, existsSync } = await import("node:fs");
const { tmpdir } = await import("node:os");

const { manualClock } = await import("../../packages/core/src/clock.ts");
const { generateInstallationKey, checkpoint } = await import("../../packages/ledger/src/signing.ts");
const { openCase, packCase, unpackCase, verifyCase, backupFile, openBackupFile } = await import("../../packages/store/src/index.ts");

const dirs = [];
try {
  const clock = manualClock("2026-10-24T10:00:00.000Z");
  const key = generateInstallationKey();
  const marker = new TextEncoder().encode("P6-007 backup roundtrip marker — الاستعادة الآلية");

  // 1. a case with one evidence blob and a chain entry
  const caseDir = mkdtempSync(join(tmpdir(), "ir-backup-src-"));
  dirs.push(caseDir);
  const c = openCase(caseDir, {
    actor: "analyst",
    clock,
    create: { title: "backup roundtrip", purpose: "مراجعة بنية تحتية", legalBasis: "security_incident" },
  });
  const ev = c.addEvidence({
    bytes: marker,
    mime: "text/plain",
    request: { method: "DNS", url: "dns:backup.example/NS" },
    transformId: "tr-dns",
    version: "1.0.0",
  });
  c.ledger.append("note.added", { text: "before backup" });
  checkpoint(c.ledger, key, clock);
  c.close();

  // 2+3. pack, then seal into an encrypted backup file
  const pack = packCase(caseDir, { actor: "ir backup", key, clock });
  const backupPassphrase = "roundtrip-passphrase-1";
  const file = backupFile(pack, backupPassphrase);
  const backupPath = `${caseDir}.irbak`;
  writeFileSync(backupPath, file);
  dirs.push(backupPath);

  // 4. encryption is real: the plaintext marker must not appear in the backup file
  if (file.includes(marker) || Buffer.from(file).toString("latin1").includes("before backup")) {
    throw new Error("the backup file leaks plaintext — encryption is not real");
  }

  // 5. the case directory is gone
  rmSync(caseDir, { recursive: true, force: true });
  if (existsSync(caseDir)) throw new Error("the source case directory was not deleted");

  // 6. decrypt + unpack into a fresh directory (unpackCase verifies, rebuilds, re-verifies)
  const restored = mkdtempSync(join(tmpdir(), "ir-backup-restore-"));
  dirs.push(restored);
  const opened = openBackupFile(file, backupPassphrase);
  const result = unpackCase(opened, restored, {});

  // 7. the restored case verifies and the blob reads back intact
  const report = verifyCase(restored, {});
  if (!report.ok) throw new Error(`restored case does not verify: ${report.problems.join("; ")}`);
  const c2 = openCase(restored, { actor: "analyst", clock, readOnly: true });
  const blob = c2.blobs.get(ev.sha256);
  c2.close();
  if (Buffer.from(blob).compare(Buffer.from(marker)) !== 0) {
    throw new Error("the restored blob does not match the original marker");
  }

  console.log(
    `backup ok: restored case ${result.caseId}: chain length ${result.length}, head ${result.head}, blob ${ev.sha256.slice(0, 12)} verified`,
  );
} finally {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}
