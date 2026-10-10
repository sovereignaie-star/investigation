import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  verify,
  verifyCheckpoint,
  verifyEmbeddedCheckpoints,
  verifyEvidence,
  type CheckpointError,
  type EvidenceProblem,
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
  evidence: { checked: number; problems: EvidenceProblem[] };
  checkpoints: { embedded: number; verified: boolean; problems: { index: number; errors: CheckpointError[] }[] };
  external: { checked: boolean; errors: CheckpointError[] } | null;
}

export interface VerifyCaseOptions {
  /** Installation public key (PEM) used to check signatures. */
  publicKeyPem?: string;
  /** A checkpoint kept outside the case (detects tail truncation and rewritten history). */
  checkpoint?: SignedCheckpoint;
}

export function verifyCase(dir: string, opts: VerifyCaseOptions = {}): CaseReport {
  if (!existsSync(path.join(dir, CASE_DB))) throw new Error(`not a case directory (no ${CASE_DB}): ${dir}`);
  const c = openCase(dir, { actor: "verifier", readOnly: true, skipChainCheck: true });
  try {
    const entries = c.ledger.entries();
    const chain = verify(entries, opts.checkpoint ? { expectedLength: opts.checkpoint.payload.length } : {});
    const evidenceCount = entries.filter((e) => e.kind === "evidence.stored").length;
    const problems = verifyEvidence(entries, c.blobs);
    const embedded = entries.filter((e) => e.kind === "checkpoint").length;
    const cpProblems = opts.publicKeyPem ? verifyEmbeddedCheckpoints(entries, opts.publicKeyPem) : [];
    let external: CaseReport["external"] = null;
    if (opts.checkpoint) {
      external = opts.publicKeyPem
        ? { checked: true, errors: verifyCheckpoint(entries, opts.checkpoint, opts.publicKeyPem) }
        : { checked: false, errors: [] };
    }
    const schemaVersion = userVersion(c.db);
    const ok =
      chain.ok &&
      problems.length === 0 &&
      cpProblems.length === 0 &&
      (external === null || (external.checked && external.errors.length === 0)) &&
      schemaVersion <= LATEST_VERSION;
    return {
      ok,
      case: path.resolve(dir),
      schemaVersion,
      latestSchemaVersion: LATEST_VERSION,
      chain: { ok: chain.ok, length: chain.length, head: chain.head, errors: chain.errors },
      evidence: { checked: evidenceCount, problems },
      checkpoints: { embedded, verified: Boolean(opts.publicKeyPem), problems: cpProblems },
      external,
    };
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
    `evidence  ${mark(r.evidence.problems.length === 0)}  ${r.evidence.checked} blobs re-hashed`,
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
