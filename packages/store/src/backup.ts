/**
 * P6-007 — the encrypted backup envelope for `.irpack` case packages.
 *
 * A backup file is a JSON document (`irbackup/1`) holding a single AES-256-GCM
 * ciphertext: the signed `.irpack` (raw hash chain + evidence blobs + the wrapped
 * case key) sealed under a key derived from a backup passphrase by Argon2id
 * (RFC 9106, the same cost as case keys). No plaintext leaves the pack: the chain,
 * the blobs and the case record are all inside the ciphertext, and the GCM tag
 * binds the pack's SHA-256 (AAD), so a swapped or truncated ciphertext fails.
 *
 * Fail-closed everywhere: a wrong passphrase, a damaged file, an unknown format or
 * a hash mismatch is a BackupError — never a silent skip, never a partial restore.
 */
import { argon2Sync, createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { systemClock, isoNow, type Clock } from "@ir/core";

export const IRBACKUP_FORMAT = "irbackup/1";

/** RFC 9106 section 4, second recommended option — the same cost as case keys (P1-014). */
export const BACKUP_KDF: Readonly<{ memoryKiB: number; passes: number; parallelism: number }> = {
  memoryKiB: 65536,
  passes: 3,
  parallelism: 4,
};

/** Fail-closed backup errors (never a silent skip). */
export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupError";
  }
}

export type BackupFile = {
  format: typeof IRBACKUP_FORMAT;
  createdAt: string;
  pack: { sha256: string; size: number };
  kdf: { alg: "argon2id"; memoryKiB: number; passes: number; parallelism: number; salt: string };
  iv: string;
  ct: string;
  tag: string;
};

const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64url");
const unb64 = (s: string) => Buffer.from(s, "base64url");
const sha256Hex = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

function deriveKey(passphrase: string, kdf: BackupFile["kdf"]): Buffer {
  if (passphrase.length < 8) throw new BackupError("backup passphrase must be at least 8 characters");
  return argon2Sync("argon2id", {
    message: Buffer.from(passphrase.normalize("NFC"), "utf8"),
    nonce: unb64(kdf.salt),
    parallelism: kdf.parallelism,
    memory: kdf.memoryKiB,
    passes: kdf.passes,
    tagLength: 32,
  });
}

/** Seal a signed pack into an encrypted backup file. No plaintext is emitted. */
export function backupFile(pack: Uint8Array, passphrase: string, opts: { clock?: Clock } = {}): Uint8Array {
  const clock = opts.clock ?? systemClock;
  const sha256 = sha256Hex(pack);
  const kdf: BackupFile["kdf"] = {
    alg: "argon2id",
    memoryKiB: BACKUP_KDF.memoryKiB,
    passes: BACKUP_KDF.passes,
    parallelism: BACKUP_KDF.parallelism,
    salt: b64(randomBytes(16)),
  };
  const key = deriveKey(passphrase, kdf);
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(`${IRBACKUP_FORMAT}|${sha256}`, "utf8"));
  const ct = Buffer.concat([c.update(pack), c.final()]);
  const file: BackupFile = {
    format: IRBACKUP_FORMAT,
    createdAt: isoNow(clock),
    pack: { sha256, size: pack.length },
    kdf,
    iv: b64(iv),
    ct: b64(ct),
    tag: b64(c.getAuthTag()),
  };
  return new TextEncoder().encode(`${JSON.stringify(file, null, 2)}\n`);
}

/** Open an encrypted backup file back into its pack bytes. Fail-closed. */
export function openBackupFile(file: Uint8Array, passphrase: string): Uint8Array {
  let parsed: BackupFile;
  try {
    parsed = JSON.parse(new TextDecoder().decode(file)) as BackupFile;
  } catch {
    throw new BackupError("not an irbackup file: cannot parse the envelope");
  }
  if (parsed?.format !== IRBACKUP_FORMAT) {
    throw new BackupError(`unknown backup format: ${String(parsed?.format)}`);
  }
  let pack: Buffer;
  try {
    const key = deriveKey(passphrase, parsed.kdf);
    const d = createDecipheriv("aes-256-gcm", key, unb64(parsed.iv));
    d.setAAD(Buffer.from(`${IRBACKUP_FORMAT}|${parsed.pack.sha256}`, "utf8"));
    d.setAuthTag(unb64(parsed.tag));
    pack = Buffer.concat([d.update(unb64(parsed.ct)), d.final()]);
  } catch (x) {
    throw new BackupError(`cannot open the backup: wrong passphrase or damaged file (${(x as Error).message})`);
  }
  const sha256 = sha256Hex(pack);
  if (sha256 !== parsed.pack.sha256 || pack.length !== parsed.pack.size) {
    throw new BackupError("backup integrity failure: the decrypted pack does not match its recorded hash");
  }
  return pack;
}
