/**
 * P6-008 — secure case deletion per retention (UC-24, E-09).
 *
 * Deletion is destructive, so it is fail-closed and paper-trailed:
 *
 *  - the case must VERIFY first — an unverifiable case is refused, never silently
 *    destroyed (deleting what you cannot account for destroys evidence);
 *  - a reason is mandatory (E-01 spirit: no undocumented destruction);
 *  - every file in the tree is overwritten with random bytes before unlink
 *    (best-effort secure deletion on the local filesystem), then the directory
 *    tree is removed entirely — case.sqlite (+wal/shm), blobs/, the wrapped key;
 *  - a signed `irdeletion/1` certificate (the installation Ed25519 key over JCS,
 *    the same construction as checkpoints) is returned for the caller to keep
 *    OUTSIDE the deleted tree: it records what was deleted, the case's retention
 *    policy, and whether deletion happened before (early) or at/after (expired)
 *    its deadline.
 *
 * Design decision (documented in DECLARED_LIMITS 27): retention is a maximum — an
 * early deletion is legitimate data minimization and is marked early in the
 * certificate; there is no force flag and no way around the verification gate.
 */
import { closeSync, openSync, readdirSync, rmSync, statSync, writeSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { isoNow, systemClock, type Clock } from "@ir/core";
import {
  canonicalize,
  IRDELETION_FORMAT,
  merkleRoot,
  type DeletionCertificatePayload,
  type Entry,
  type InstallationKey,
  type SignedDeletionCertificate,
} from "@ir/ledger";
import { openCase } from "./case.ts";
import { verifyCase } from "./verify-case.ts";

/** Fail-closed deletion errors (never a silent skip). */
export class DeletionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeletionError";
  }
}

export interface DeleteCaseOptions {
  actor: string;
  /** Mandatory (E-01 spirit): the destruction must be accountable. */
  reason: string;
  /** Signs the deletion certificate (installation Ed25519 key). */
  key: InstallationKey;
  clock?: Clock;
  /** Unlocks an encrypted case to read its record for the certificate. */
  passphrase?: string;
}

const bytesOf = (p: object) => new TextEncoder().encode(canonicalize(p));

/** The retention deadline as a timestamp, or null when there is none (indefinite). */
function retentionDeadline(createdAt: string, retention: { mode: string; days?: number; until?: string }): number | null {
  if (retention.mode === "days" && typeof retention.days === "number" && Number.isFinite(retention.days)) {
    return Date.parse(createdAt) + retention.days * 86_400_000;
  }
  if (retention.mode === "until" && retention.until) return Date.parse(retention.until);
  return null;
}

/** Overwrite a file with random bytes (best-effort), then leave it for the tree removal. */
function overwrite(p: string, size: number): void {
  const fd = openSync(p, "r+");
  try {
    const chunk = 65_536;
    for (let at = 0; at < size; at += chunk) {
      const n = Math.min(chunk, size - at);
      writeSync(fd, randomBytes(n), 0, n, at);
    }
  } finally {
    closeSync(fd);
  }
}

/** Every regular file under dir, as absolute paths. */
function listFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => path.join(d.parentPath, d.name));
}

export function deleteCase(dir: string, opts: DeleteCaseOptions): SignedDeletionCertificate {
  const clock = opts.clock ?? systemClock;
  const reason = opts.reason.trim();
  if (reason.length < 3) {
    throw new DeletionError("a deletion reason is required (at least 3 characters)");
  }

  // 1. verify — never delete what you cannot account for.
  const report = verifyCase(dir, opts.passphrase ? { passphrase: opts.passphrase } : {});
  if (!report.ok) {
    const why = report.chain.errors[0]?.message ?? report.evidence.problems[0] ?? "the case does not verify";
    throw new DeletionError(`refusing to delete a case that does not verify: ${why}`);
  }

  // 2. gather the certificate facts from the (verified) case.
  const c = openCase(dir, {
    actor: opts.actor,
    readOnly: true,
    ...(opts.passphrase ? { passphrase: opts.passphrase } : {}),
  });
  let entries: readonly Entry[];
  let caseId: string;
  let createdAt: string;
  let retention: DeletionCertificatePayload["retention"];
  try {
    entries = c.ledger.entries();
    const info = c.info();
    caseId = info.id;
    createdAt = info.createdAt;
    retention = info.retention as DeletionCertificatePayload["retention"];
  } finally {
    c.close();
  }
  const head = entries[entries.length - 1]?.entryHash ?? "";
  const root = merkleRoot(entries.map((e) => e.entryHash));
  const blobs = listFiles(dir).filter((p) => p.includes(`${path.sep}blobs${path.sep}`)).length;

  const deadline = retentionDeadline(createdAt, retention as { mode: string; days?: number; until?: string });
  const retentionState: SignedDeletionCertificate["payload"]["retentionState"] =
    deadline === null ? "indefinite" : clock.now() >= deadline ? "expired" : "early";

  // 3. overwrite every file, then remove the tree — no leftovers.
  for (const p of listFiles(dir)) overwrite(p, statSync(p).size);
  rmSync(dir, { recursive: true, force: true });

  // 4. the signed certificate (kept outside the deleted tree by the caller).
  const payload: DeletionCertificatePayload = {
    format: IRDELETION_FORMAT,
    caseId,
    chainLength: entries.length,
    head,
    root,
    blobs,
    retention,
    retentionState,
    reason,
    actor: opts.actor,
    at: isoNow(clock),
    keyId: opts.key.keyId,
  };
  return { payload, signature: opts.key.sign(bytesOf(payload)) };
}
