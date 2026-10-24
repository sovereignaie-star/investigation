/**
 * P6-007 — backup & restore (T-BK-001..003 acceptance: "استعادة آلية ناجحة").
 *
 * `ir backup` packs the case (the signed .irpack: raw chain + blobs + wrapped key)
 * and seals that pack into an encrypted backup file (Argon2id + AES-256-GCM — no
 * plaintext in the backup). `ir restore` decrypts, unpacks into a fresh directory
 * (verify + rebuild + re-verify) and prints the case's verification report.
 * Fail-closed: a wrong passphrase restores nothing.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { manualClock } from "@ir/core";
import { generateInstallationKey, checkpoint } from "@ir/ledger";
import { backupFile, openBackupFile, openCase, verifyCase } from "@ir/store";
import { main } from "./ir.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A case with one evidence blob, one note and a checkpoint — the roundtrip payload. */
function makeCase() {
  const dir = mkdtempSync(path.join(tmpdir(), "ir-backup-"));
  dirs.push(dir);
  const clock = manualClock("2026-10-24T11:00:00.000Z");
  const key = generateInstallationKey();
  const priv = `${dir}.key.pem`;
  const pub = `${dir}.pub.pem`;
  writeFileSync(priv, key.privateKeyPem);
  writeFileSync(pub, key.publicKeyPem);
  dirs.push(priv, pub);
  const c = openCase(dir, {
    actor: "analyst",
    clock,
    create: { title: "backup test", purpose: "مراجعة بنية تحتية", legalBasis: "security_incident" },
  });
  const marker = new TextEncoder().encode("P6-007 marker — الاستعادة الآلية");
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
  return { dir, priv, pub, key, clock, ev, marker };
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

describe("ir backup / ir restore — the encrypted backup envelope (P6-007, T-BK-001)", () => {
  it("backup then restore then verify: the full CLI cycle restores an intact case", async () => {
    const { dir, priv, pub, ev, marker } = makeCase();
    const backupPath = `${dir}.irbak`;
    const restoreDir = `${dir}-restored`;
    dirs.push(backupPath, restoreDir);
    const passFile = `${dir}.pass.txt`;
    writeFileSync(passFile, "a-sufficient-passphrase\n");
    dirs.push(passFile);

    const backed = await run(["backup", dir, backupPath, "--key", priv, "--backup-passphrase-file", passFile]);
    expect(backed.code).toBe(0);
    expect(existsSync(backupPath)).toBe(true);
    // encryption is real: no plaintext of the chain or the blob in the backup file
    const raw = readFileSync(backupPath, "latin1");
    expect(raw).not.toContain("before backup");
    expect(raw).not.toContain("ir-backup");

    const restored = await run(["restore", backupPath, restoreDir, "--backup-passphrase-file", passFile]);
    expect(restored.code).toBe(0);
    expect(restored.text).toMatch(/restored .*: case .*, chain length \d+, head [0-9a-f]{64}/);

    const report = verifyCase(restoreDir, { publicKeyPem: readFileSync(pub, "utf8") });
    expect(report.ok).toBe(true);
    const c = openCase(restoreDir, { actor: "analyst", readOnly: true });
    const blob = c.blobs.get(ev.sha256);
    c.close();
    expect(Buffer.from(blob).equals(Buffer.from(marker))).toBe(true);
  });

  it("a wrong backup passphrase restores nothing (fail-closed)", async () => {
    const { dir, priv } = makeCase();
    const backupPath = `${dir}.irbak`;
    const restoreDir = `${dir}-restored`;
    dirs.push(backupPath, restoreDir);
    const good = `${dir}.pass.txt`;
    const bad = `${dir}.bad.txt`;
    writeFileSync(good, "a-sufficient-passphrase\n");
    writeFileSync(bad, "a-wrong-passphrase\n");
    dirs.push(good, bad);

    expect((await run(["backup", dir, backupPath, "--key", priv, "--backup-passphrase-file", good])).code).toBe(0);
    const restored = await run(["restore", backupPath, restoreDir, "--backup-passphrase-file", bad]);
    expect(restored.code).not.toBe(0);
    expect(existsSync(restoreDir)).toBe(false);
  });

  it("backupFile/openBackupFile: sealed with Argon2id + AES-256-GCM, tamper-evident", () => {
    const pack = new TextEncoder().encode(JSON.stringify({ not: "a real pack" }));
    const file = backupFile(pack, "a-sufficient-passphrase");
    const asText = Buffer.from(file).toString("utf8");
    expect(asText).toContain("irbackup/1");
    expect(asText).toContain("argon2id");
    // the plaintext is not in the file
    expect(asText).not.toContain("a real pack");
    // roundtrip
    expect(Buffer.from(openBackupFile(file, "a-sufficient-passphrase")).equals(Buffer.from(pack))).toBe(true);
    // wrong passphrase fails
    expect(() => openBackupFile(file, "a-wrong-passphrase")).toThrow();
    // a damaged file fails (flip a ciphertext byte)
    const damaged = new Uint8Array(file);
    const idx = asText.indexOf('"ct":"') + 8;
    damaged[idx] ^= 0xff;
    expect(() => openBackupFile(damaged, "a-sufficient-passphrase")).toThrow();
  });
});
