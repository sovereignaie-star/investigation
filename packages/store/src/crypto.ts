import { argon2Sync, createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import * as zlib from "node:zlib";
import { BlobIntegrityError, blobPath, type BlobRef, type BlobStore } from "@ir/ledger";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Case encryption at the application layer (P1-014, ADR-04). A random 256-bit data key per case is wrapped with a
 * key derived from the passphrase by Argon2id (RFC 9106); payloads and blobs are sealed with AES-256-GCM under HKDF
 * subkeys. Ledger payloads are stored as sealed envelopes, so the hash chain and signatures still verify without the
 * passphrase while the content does not open without it.
 */
export const CASE_KEY_FORMAT = "ir-casekey/1";
export const ENVELOPE = "aes-256-gcm/1";

export type KdfParams = { alg: "argon2id"; memoryKiB: number; passes: number; parallelism: number; salt: string };
export type CaseKeyFile = {
  format: typeof CASE_KEY_FORMAT;
  caseId: string;
  kdf: KdfParams;
  wrapped: { iv: string; ct: string; tag: string };
};
export type Envelope = { enc: typeof ENVELOPE; iv: string; ct: string; tag: string };

/** RFC 9106 section 4, second recommended option: 64 MiB, 3 passes, 4 lanes. */
export type KdfCost = { memoryKiB: number; passes: number; parallelism: number };
export const DEFAULT_KDF: Readonly<KdfCost> = { memoryKiB: 65536, passes: 3, parallelism: 4 };

export class WrongPassphraseError extends Error {
  constructor() {
    super("wrong passphrase or damaged case key file");
    this.name = "WrongPassphraseError";
  }
}

const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64url");
const unb64 = (s: string) => Buffer.from(s, "base64url");

function kek(passphrase: string, kdf: KdfParams): Buffer {
  if (passphrase.length < 8) throw new Error("passphrase must be at least 8 characters");
  return argon2Sync("argon2id", {
    message: Buffer.from(passphrase.normalize("NFC"), "utf8"),
    nonce: unb64(kdf.salt),
    parallelism: kdf.parallelism,
    memory: kdf.memoryKiB,
    passes: kdf.passes,
    tagLength: 32,
  });
}

function seal(key: Uint8Array, plain: Uint8Array, aad: string): { iv: Buffer; ct: Buffer; tag: Buffer } {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return { iv, ct, tag: c.getAuthTag() };
}

function open(key: Uint8Array, iv: Uint8Array, ct: Uint8Array, tag: Uint8Array, aad: string): Buffer {
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAAD(Buffer.from(aad, "utf8"));
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}

export interface CaseKey {
  readonly caseId: string;
  sealPayload(kind: string, value: unknown): Envelope;
  openPayload(kind: string, env: Envelope): unknown;
  blobAddress(sha256: string): string;
  sealBlob(sha256: string, compressed: Uint8Array): Uint8Array;
  openBlob(sha256: string, data: Uint8Array): Uint8Array;
}

function caseKey(caseId: string, dek: Buffer): CaseKey {
  const sub = (info: string) => Buffer.from(hkdfSync("sha256", dek, Buffer.from(caseId), info, 32));
  const kPayload = sub("ir-case/1 payload");
  const kBlob = sub("ir-case/1 blob");
  const kAddr = sub("ir-case/1 blob-address");
  const MAGIC = Buffer.from("IRB1");
  return {
    caseId,
    sealPayload(kind, value) {
      const s = seal(kPayload, Buffer.from(JSON.stringify(value), "utf8"), `${caseId}|${kind}`);
      return { enc: ENVELOPE, iv: b64(s.iv), ct: b64(s.ct), tag: b64(s.tag) };
    },
    openPayload(kind, env) {
      return JSON.parse(open(kPayload, unb64(env.iv), unb64(env.ct), unb64(env.tag), `${caseId}|${kind}`).toString("utf8")) as unknown;
    },
    // Keyed address: without the key, file names do not reveal which known documents a case holds.
    blobAddress: (sha256) => createHmac("sha256", kAddr).update(sha256).digest("hex"),
    sealBlob(sha256, compressed) {
      const s = seal(kBlob, compressed, `${caseId}|${sha256}`);
      return Buffer.concat([MAGIC, s.iv, s.ct, s.tag]);
    },
    openBlob(sha256, data) {
      const buf = Buffer.from(data);
      if (buf.length < 32 || !buf.subarray(0, 4).equals(MAGIC)) throw new Error("not a sealed blob");
      return open(kBlob, buf.subarray(4, 16), buf.subarray(16, buf.length - 16), buf.subarray(buf.length - 16), `${caseId}|${sha256}`);
    },
  };
}

/** Creates the per-case data key and its passphrase-wrapped file (store it as case.key.json beside case.sqlite). */
export function createCaseKey(caseId: string, passphrase: string, params: Partial<KdfCost> = {}): { file: CaseKeyFile; key: CaseKey } {
  const kdf: KdfParams = { alg: "argon2id", ...DEFAULT_KDF, ...params, salt: b64(randomBytes(16)) };
  const dek = randomBytes(32);
  const w = seal(kek(passphrase, kdf), dek, `${CASE_KEY_FORMAT}|${caseId}`);
  return {
    file: { format: CASE_KEY_FORMAT, caseId, kdf, wrapped: { iv: b64(w.iv), ct: b64(w.ct), tag: b64(w.tag) } },
    key: caseKey(caseId, dek),
  };
}

export function unlockCaseKey(file: CaseKeyFile, passphrase: string): CaseKey {
  if (file.format !== CASE_KEY_FORMAT || file.kdf.alg !== "argon2id") throw new Error("unsupported case key file");
  let dek: Buffer;
  try {
    dek = open(
      kek(passphrase, file.kdf),
      unb64(file.wrapped.iv),
      unb64(file.wrapped.ct),
      unb64(file.wrapped.tag),
      `${CASE_KEY_FORMAT}|${file.caseId}`,
    );
  } catch {
    throw new WrongPassphraseError();
  }
  if (dek.length !== 32) throw new WrongPassphraseError();
  return caseKey(file.caseId, dek);
}

/** Re-wraps the same data key under a new passphrase; payloads and blobs are untouched. */
export function changePassphrase(
  file: CaseKeyFile,
  oldPassphrase: string,
  newPassphrase: string,
  params: Partial<KdfCost> = {},
): CaseKeyFile {
  const dek = open(
    kek(oldPassphrase, file.kdf),
    unb64(file.wrapped.iv),
    unb64(file.wrapped.ct),
    unb64(file.wrapped.tag),
    `${CASE_KEY_FORMAT}|${file.caseId}`,
  );
  const kdf: KdfParams = { alg: "argon2id", ...DEFAULT_KDF, ...params, salt: b64(randomBytes(16)) };
  const w = seal(kek(newPassphrase, kdf), dek, `${CASE_KEY_FORMAT}|${file.caseId}`);
  return { ...file, kdf, wrapped: { iv: b64(w.iv), ct: b64(w.ct), tag: b64(w.tag) } };
}

export const isEnvelope = (v: unknown): v is Envelope => typeof v === "object" && v !== null && (v as { enc?: unknown }).enc === ENVELOPE;

type Zstd = { compress: (b: Uint8Array) => Uint8Array; decompress: (b: Uint8Array) => Uint8Array };
const zstd = zlib as unknown as { zstdCompressSync: Zstd["compress"]; zstdDecompressSync: Zstd["decompress"] };
const sha256Hex = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/**
 * BlobStore over sealed files at blobs/<addr[0:2]>/<addr>, addr = HMAC(key, sha256). Same contract as fsBlobStore:
 * get() returns only bytes whose SHA-256 matches; tampering fails the GCM tag ("corrupt").
 */
export function encryptedBlobStore(root: string, key: CaseKey): BlobStore {
  const file = (sha: string) => path.join(root, ...blobPath(key.blobAddress(sha)).split("/"));
  const read = (sha: string): Uint8Array | undefined => {
    try {
      return new Uint8Array(readFileSync(file(sha)));
    } catch (x) {
      if ((x as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw x;
    }
  };
  const get = (sha256: string): Uint8Array => {
    if (!/^[0-9a-f]{64}$/.test(sha256)) throw new BlobIntegrityError(sha256, "missing");
    const data = read(sha256);
    if (!data) throw new BlobIntegrityError(sha256, "missing");
    let raw: Uint8Array;
    try {
      raw = new Uint8Array(zstd.zstdDecompressSync(key.openBlob(sha256, data)));
    } catch {
      throw new BlobIntegrityError(sha256, "corrupt");
    }
    if (!timingSafeEqual(Buffer.from(sha256Hex(raw)), Buffer.from(sha256))) throw new BlobIntegrityError(sha256, "mismatch");
    return raw;
  };
  const has = (sha256: string) => {
    try {
      get(sha256);
      return true;
    } catch {
      return false;
    }
  };
  return {
    put(bytes): BlobRef {
      const sha256 = sha256Hex(bytes);
      if (!has(sha256)) {
        const target = file(sha256);
        mkdirSync(path.dirname(target), { recursive: true });
        const tmp = `${target}.${randomBytes(6).toString("hex")}.tmp`;
        writeFileSync(tmp, key.sealBlob(sha256, zstd.zstdCompressSync(bytes)), { flag: "wx" });
        renameSync(tmp, target);
      }
      return { sha256, size: bytes.length, blobRef: blobPath(sha256) };
    },
    get,
    has,
  };
}
