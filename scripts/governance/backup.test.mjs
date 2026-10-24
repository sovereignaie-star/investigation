/**
 * P6-007: backup & restore governance guard (T-BK-001..003).
 *
 * The acceptance criterion is "استعادة آلية ناجحة" — a successful automated
 * restore, not a claim. The Section 10.4 decision requires an encrypted
 * `ir backup` command for the case file + blobs with an automated restore
 * test. This guard enforces that the commands exist in the CLI, the backup
 * envelope is real encryption (fail-closed, no plaintext), and that the
 * roundtrip script actually executes and restores an intact case.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

test("T-BK-001: the CLI exposes encrypted backup and restore commands", () => {
  assert.ok(existsSync(join(root, "scripts/backup/roundtrip.mjs")), "scripts/backup/roundtrip.mjs must exist");
  const cli = readFileSync(join(root, "packages/cli/src/ir.ts"), "utf8");
  assert.match(cli, /ir backup <case-dir>/, "USAGE must document `ir backup`");
  assert.match(cli, /ir restore /, "USAGE must document `ir restore`");
  assert.match(cli, /backup-passphrase-file/, "the backup envelope must be passphrase-protected");
  assert.match(cli, /case "backup":/, "backup must be a dispatched command");
  assert.match(cli, /case "restore":/, "restore must be a dispatched command");
});

test("T-BK-002: the backup envelope is real, fail-closed encryption", () => {
  const src = readFileSync(join(root, "packages/store/src/backup.ts"), "utf8");
  assert.match(src, /IRBACKUP_FORMAT = "irbackup\/1"/, "the format constant must pin the version");
  assert.match(src, /argon2id/, "the key must be derived with Argon2id (RFC 9106)");
  assert.match(src, /aes-256-gcm/i, "the pack must be sealed with AES-256-GCM");
  assert.match(src, /class BackupError/, "fail-closed BackupError must exist");
  assert.match(src, /no plaintext/i, "the doc must state that no plaintext leaves the pack");
});

test("T-BK-003: automated restore roundtrip executes and restores an intact case", () => {
  const r = spawnSync(process.execPath, ["scripts/backup/roundtrip.mjs"], {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
  });
  assert.equal(r.status, 0, `roundtrip failed:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /backup ok: restored case /, "the roundtrip must report a restored case");
  assert.match(r.stdout, /blob .* verified/, "the restored blob must be verified");
});
