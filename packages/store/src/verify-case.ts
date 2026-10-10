import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  verify,
  verifyCheckpoint,
  verifyEmbeddedCheckpoints,
  verifyEvidence,
  type CheckpointError,
  type EvidenceProblem,
  type Entry,
  type SignedCheckpoint,
  type VerifyError,
} from "@ir/ledger";
import { CASE_DB, openCase } from "./case.ts";
import { LATEST_VERSION, userVersion } from "./migrations.ts";

/**
 * Integrity report for one case directory (5.5 "ir verify", P1-012). Read-only: the case is opened without
 * migrations and nothing is written. `ok` is false if any check fails; checks that need a key are reported as
 * skipped rather than passed when no key is given.
 */
export interface CaseReport {
  ok: boolean;
  case: string;
  schemaVersion: number;
  latestSchemaVersion: number;
  chain: { ok: boolean; length: number; head: string | null; errors: VerifyError[] };
  encryption: "none" | "locked" | "unlocked";
  /** Sealed payloads that fail AES-GCM authentication (encrypted cases opened with the passphrase). */
  sealed: { unopenable: number[] };
  evidence: { checked: number; skipped: boolean; problems: EvidenceProblem[] };
  checkpoints: { embedded: number; verified: boolean; problems: { index: number; errors: CheckpointError[] }[] };
  external: { checked: boolean; errors: CheckpointError[] } | null;
}

export interface VerifyCaseOptions {
  /** Installation public key (PEM) used to check signatures. */
  publicKeyPem?: string;
  /** A checkpoint kept outside the case (detects tail truncation and rewritten history). */
  checkpoint?: SignedCheckpoint;
  /** Unlocks an encrypted case so evidence blobs can be re-hashed; without it they are reported as skipped. */
  passphrase?: string;
}

function checkSignatures(
  entries: readonly Entry[],
  opts: VerifyCaseOptions,
): Pick<CaseReport, "external"> & { cp: CaseReport["checkpoints"]["problems"] } {
  const cp = opts.publicKeyPem ? verifyEmbeddedCheckpoints(entries, opts.publicKeyPem) : [];
  if (!opts.checkpoint) return { cp, external: null };
  const external = opts.publicKeyPem
    ? { checked: true, errors: verifyCheckpoint(entries, opts.checkpoint, opts.publicKeyPem) }
    : { checked: false, errors: [] };
  return { cp, external };
}

const allGood = (r: Omit<CaseReport, "ok">): boolean =>
  r.chain.ok &&
  r.sealed.unopenable.length === 0 &&
  r.evidence.problems.length === 0 &&
  r.checkpoints.problems.length === 0 &&
  (r.external === null || (r.external.checked && r.external.errors.length === 0)) &&
  r.schemaVersion <= r.latestSchemaVersion;

export function verifyCase(dir: string, opts: VerifyCaseOptions = {}): CaseReport {
  if (!existsSync(path.join(dir, CASE_DB))) throw new Error(`not a case directory (no ${CASE_DB}): ${dir}`);
  const c = openCase(dir, {
    actor: "verifier",
    readOnly: true,
    skipChainCheck: true,
    ...(opts.passphrase !== undefined ? { passphrase: opts.passphrase } : {}),
  });
  try {
    const entries = c.ledger.entries();
    const chain = verify(entries, opts.checkpoint ? { expectedLength: opts.checkpoint.payload.length } : {});
    const opened = c.locked ? { entries: [], unopenable: [] } : c.openEntries();
    const sig = checkSignatures(entries, opts);
    const body: Omit<CaseReport, "ok"> = {
      case: path.resolve(dir),
      schemaVersion: userVersion(c.db),
      latestSchemaVersion: LATEST_VERSION,
      chain: { ok: chain.ok, length: chain.length, head: chain.head, errors: chain.errors },
      encryption: !c.encrypted ? "none" : c.locked ? "locked" : "unlocked",
      sealed: { unopenable: opened.unopenable },
      evidence: {
        checked: c.locked ? 0 : entries.filter((e) => e.kind === "evidence.stored").length,
        skipped: c.locked,
        problems: c.locked ? [] : verifyEvidence(opened.entries, c.blobs),
      },
      checkpoints: {
        embedded: entries.filter((e) => e.kind === "checkpoint").length,
        verified: Boolean(opts.publicKeyPem),
        problems: sig.cp,
      },
      external: sig.external,
    };
    return { ok: allGood(body), ...body };
  } finally {
    c.close();
  }
}

export const readCheckpointFile = (file: string): SignedCheckpoint => JSON.parse(readFileSync(file, "utf8")) as SignedCheckpoint;

/** Plain-text rendering for terminals. */
export function formatReport(r: CaseReport): string {
  const mark = (ok: boolean) => (ok ? "PASS" : "FAIL");
  const lines = [
    `case      ${r.case}`,
    `schema    v${r.schemaVersion} (this build: v${r.latestSchemaVersion})`,
    `chain     ${mark(r.chain.ok)}  ${r.chain.length} entries, head ${r.chain.head ?? "-"}`,
    ...r.chain.errors.map((e) => `          - [${e.code}] ${e.message}`),
    `encrypted ${r.encryption === "none" ? "no" : r.encryption === "locked" ? "yes (locked: content not read)" : "yes (unlocked)"}`,
    ...r.sealed.unopenable.map((i) => `          - [sealed] entry ${i}: payload fails authentication (tampered or wrong key)`),
    r.evidence.skipped
      ? "evidence  SKIP  encrypted case (pass --passphrase-file to re-hash blobs)"
      : `evidence  ${mark(r.evidence.problems.length === 0)}  ${r.evidence.checked} blobs re-hashed`,
    ...r.evidence.problems.map((p) => `          - [${p.reason}] entry ${p.index}, evidence ${p.id}, sha256 ${p.sha256}`),
    r.checkpoints.verified
      ? `signed    ${mark(r.checkpoints.problems.length === 0)}  ${r.checkpoints.embedded} embedded checkpoints`
      : `signed    SKIP  ${r.checkpoints.embedded} embedded checkpoints (pass --key to check signatures)`,
    ...r.checkpoints.problems.flatMap((p) => p.errors.map((e) => `          - entry ${p.index}: [${e.code}] ${e.message}`)),
  ];
  if (r.external)
    lines.push(
      r.external.checked
        ? `external  ${mark(r.external.errors.length === 0)}  published checkpoint`
        : "external  FAIL  checkpoint given without --key",
      ...r.external.errors.map((e) => `          - [${e.code}] ${e.message}`),
    );
  lines.push(`result    ${r.ok ? "OK" : "INTEGRITY FAILURE"}`);
  return lines.join("\n");
}
