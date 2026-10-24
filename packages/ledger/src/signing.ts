import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto";
import { closeSync, constants, fchmodSync, fstatSync, mkdirSync, openSync, readFileSync, writeFileSync, writeSync } from "node:fs";
import path from "node:path";
import { isoNow, systemClock, type Clock } from "@ir/core";
import { canonicalize } from "./jcs.ts";
import type { Entry, Ledger } from "./ledger.ts";
import { merkleRoot } from "./merkle.ts";

/**
 * Installation signing key and signed checkpoints (5.5, ADR-06, P1-011). A checkpoint commits to the first `length`
 * entries by their head hash and Merkle root, signed with Ed25519 over the JCS form of the payload. Publishing or
 * keeping the latest checkpoint outside the case file is what makes tail truncation detectable (T-LED-008, T-LED-012).
 */
export const CHECKPOINT_FORMAT = "ir-checkpoint/1";

export type CheckpointPayload = {
  format: typeof CHECKPOINT_FORMAT;
  length: number;
  head: string;
  root: string;
  at: string;
  keyId: string;
};
export type SignedCheckpoint = { payload: CheckpointPayload; signature: string };

export interface InstallationKey {
  keyId: string;
  publicKeyPem: string;
  sign(data: Uint8Array): string;
}

function rawPublic(pub: KeyObject): Buffer {
  const der = pub.export({ type: "spki", format: "der" });
  return der.subarray(der.length - 32);
}

/** keyId = "ed25519:" + first 16 hex chars of SHA-256(raw 32-byte public key). */
export function keyIdOf(publicKeyPem: string): string {
  const pub = createPublicKey(publicKeyPem);
  if (pub.asymmetricKeyType !== "ed25519") throw new Error("installation keys must be Ed25519");
  return `ed25519:${createHash("sha256").update(rawPublic(pub)).digest("hex").slice(0, 16)}`;
}

function fromPrivate(priv: KeyObject): InstallationKey {
  if (priv.asymmetricKeyType !== "ed25519") throw new Error("installation keys must be Ed25519");
  const publicKeyPem = createPublicKey(priv).export({ type: "spki", format: "pem" }).toString();
  return {
    keyId: keyIdOf(publicKeyPem),
    publicKeyPem,
    sign: (data) => sign(null, data, priv).toString("base64url"),
  };
}

export function generateInstallationKey(): InstallationKey & { privateKeyPem: string } {
  const { privateKey } = generateKeyPairSync("ed25519");
  return { ...fromPrivate(privateKey), privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
}

export function installationKeyFromPem(privateKeyPem: string): InstallationKey {
  return fromPrivate(createPrivateKey(privateKeyPem));
}

/**
 * Loads `<dir>/installation.key` (PKCS#8 PEM, mode 0600) or creates it with `installation.pub` beside it. The private
 * key never enters the ledger, checkpoints or logs.
 */
export function loadOrCreateInstallationKey(dir: string): InstallationKey {
  const keyFile = path.join(dir, "installation.key");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // One open of the path (create if absent, mode 0600); everything after goes through the descriptor.
  const fd = openSync(keyFile, constants.O_RDWR | constants.O_CREAT, 0o600);
  try {
    fchmodSync(fd, 0o600);
    if (fstatSync(fd).size > 0) return installationKeyFromPem(readFileSync(fd, "utf8"));
    const k = generateInstallationKey();
    writeSync(fd, k.privateKeyPem);
    writeFileSync(path.join(dir, "installation.pub"), k.publicKeyPem);
    return installationKeyFromPem(k.privateKeyPem);
  } finally {
    closeSync(fd);
  }
}

const bytesOf = (p: object) => new TextEncoder().encode(canonicalize(p));

/** Signs the current state of `entries` without changing the ledger. */
export function signCheckpoint(entries: readonly Entry[], key: InstallationKey, clock: Clock = systemClock): SignedCheckpoint {
  const last = entries[entries.length - 1];
  if (!last) throw new Error("cannot checkpoint an empty ledger");
  const payload: CheckpointPayload = {
    format: CHECKPOINT_FORMAT,
    length: entries.length,
    head: last.entryHash,
    root: merkleRoot(entries.map((e) => e.entryHash)),
    at: isoNow(clock),
    keyId: key.keyId,
  };
  return { payload, signature: key.sign(bytesOf(payload)) };
}

/** Signs a checkpoint and records it in the ledger as a `checkpoint` entry; returns it for publication elsewhere. */
export function checkpoint(ledger: Ledger, key: InstallationKey, clock?: Clock): SignedCheckpoint {
  const signed = signCheckpoint(ledger.entries(), key, clock);
  ledger.append("checkpoint", signed);
  return signed;
}

export type CheckpointCode = "format" | "key" | "signature" | "truncated" | "head" | "root";
export type CheckpointError = { code: CheckpointCode; message: string };

/** Verifies signature, key, and that `entries` still contain exactly the committed prefix. Empty result means valid. */
export function verifyCheckpoint(entries: readonly Entry[], cp: SignedCheckpoint, publicKeyPem: string): CheckpointError[] {
  const errors: CheckpointError[] = [];
  const p = cp.payload;
  if (p?.format !== CHECKPOINT_FORMAT || !Number.isInteger(p.length) || p.length < 1)
    return [{ code: "format", message: "not an ir-checkpoint/1 payload" }];
  if (keyIdOf(publicKeyPem) !== p.keyId) errors.push({ code: "key", message: `checkpoint signed by ${p.keyId}, not by this key` });
  let sigOk = false;
  try {
    sigOk = verify(null, bytesOf(p), createPublicKey(publicKeyPem), Buffer.from(cp.signature, "base64url"));
  } catch {
    sigOk = false;
  }
  if (!sigOk) errors.push({ code: "signature", message: "Ed25519 signature does not verify" });
  if (entries.length < p.length) {
    errors.push({ code: "truncated", message: `ledger has ${entries.length} entries, checkpoint committed to ${p.length}` });
    return errors;
  }
  const prefix = entries.slice(0, p.length);
  if (prefix[prefix.length - 1]?.entryHash !== p.head)
    errors.push({ code: "head", message: `entry ${p.length - 1} is not the committed head` });
  if (merkleRoot(prefix.map((e) => e.entryHash)) !== p.root)
    errors.push({ code: "root", message: "Merkle root of the committed prefix changed" });
  return errors;
}

/** Every `checkpoint` entry inside the ledger, verified against the entries before it. */
export function verifyEmbeddedCheckpoints(entries: readonly Entry[], publicKeyPem: string): { index: number; errors: CheckpointError[] }[] {
  return entries
    .map((e, index) => ({ e, index }))
    .filter(({ e }) => e.kind === "checkpoint")
    .map(({ e, index }) => ({ index, errors: verifyCheckpoint(entries.slice(0, index), e.payload as SignedCheckpoint, publicKeyPem) }))
    .filter((r) => r.errors.length > 0);
}

/**
 * P6-008 (UC-24): the signed deletion certificate. After a case is securely deleted
 * nothing remains inside its directory, so the certificate lives outside it and is
 * the only durable proof of what was deleted: the case id, the chain it committed
 * to (length/head/Merkle root), the blob count, the case's retention policy and
 * whether deletion happened before (early) or at/after (expired) its deadline, the
 * reason, the actor and the time — signed with the installation Ed25519 key over
 * the JCS form of the payload (the same construction as checkpoints).
 */
export const IRDELETION_FORMAT = "irdeletion/1";

export type DeletionCertificatePayload = {
  format: typeof IRDELETION_FORMAT;
  caseId: string;
  chainLength: number;
  head: string;
  root: string;
  blobs: number;
  retention: { mode: string; [k: string]: unknown };
  retentionState: "early" | "expired" | "indefinite";
  reason: string;
  actor: string;
  at: string;
  keyId: string;
};
export type SignedDeletionCertificate = { payload: DeletionCertificatePayload; signature: string };

export type DeletionCode = "format" | "key" | "signature";
export type DeletionCertificateError = { code: DeletionCode; message: string };

/** Verifies a deletion certificate against an installation public key. Empty result means valid. */
export function verifyDeletionCertificate(crt: SignedDeletionCertificate, publicKeyPem: string): DeletionCertificateError[] {
  const errors: DeletionCertificateError[] = [];
  const p = crt?.payload;
  if (p?.format !== IRDELETION_FORMAT || typeof p?.caseId !== "string" || !Number.isInteger(p?.chainLength)) {
    return [{ code: "format", message: "not an irdeletion/1 certificate payload" }];
  }
  if (keyIdOf(publicKeyPem) !== p.keyId) {
    errors.push({ code: "key", message: `certificate signed by ${p.keyId}, not by this key` });
  }
  let sigOk = false;
  try {
    sigOk = verify(null, bytesOf(p), createPublicKey(publicKeyPem), Buffer.from(crt.signature, "base64url"));
  } catch {
    sigOk = false;
  }
  if (!sigOk) errors.push({ code: "signature", message: "Ed25519 signature does not verify" });
  return errors;
}
