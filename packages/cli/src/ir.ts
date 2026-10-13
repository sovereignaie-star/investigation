import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { canonicalKey, isoNow, systemClock, ulidFactory, type Clock } from "@ir/core";
import { specById } from "@ir/core/identifiers";
import { expandFindings, recordOutcome, type ExpandResult } from "@ir/ledger";
import { project, projectionHash, type Projection } from "@ir/ledger/projections";
import { formatReport, openCase, readCheckpointFile, verifyCase, type Case } from "@ir/store";
import { createSimServer, type SimRule } from "@ir/sim";
import { httpScan, runTransform, TransformRunError, type RunTransformResult, type Transform, type TransformEvidence } from "@ir/transforms";

const USAGE = `usage: ir verify <case-dir> [--key installation.pub] [--checkpoint checkpoint.json] [--passphrase-file file] [--json]
       ir project <case-dir> [--at seq] [--expect sha256] [--passphrase-file file] [--json]
       ir run <case-dir> <transform-id> <subject-type> <subject-value> [--sim rules.json] [--json] [--passphrase-file file]

  verify:  recomputes the hash chain, re-hashes every evidence blob, and checks signed checkpoints.
  project: rebuilds the graph, table and coverage views from the chain, offline (optionally as of seq --at),
           and prints their counts and projection hash; --expect fails (exit 1) unless the hash matches.
  run:     runs a transform against a subject in the deterministic simulation world (@ir/sim), stores the
           response as evidence, and expands the findings into the ledger. --sim loads a JSON array of sim
           rules (see @ir/sim); without it every URL returns 200 with an empty body. Refuses encrypted cases.
  Encrypted cases: the passphrase is read from --passphrase-file or IR_CASE_PASSPHRASE, never from the command line.
  Exit codes: 0 intact, 1 integrity failure, 2 usage or I/O error.`;

/** `ir` command line (P1-012, P2-022). Returns the exit code so tests can call it without spawning a process. */
const stdout = (s: string) => void process.stdout.write(`${s}\n`);
const stderr = (s: string) => void process.stderr.write(`${s}\n`);

/** Injectable clock/sleep for deterministic tests; the CLI defaults to the system clock and real timers. */
export interface CliOptions {
  clock?: Clock;
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

/** Case created by `ir run` when the target directory has no case yet (P2-022). */
const DEFAULT_CASE = {
  title: "ir run",
  purpose: "CLI transform run in the deterministic simulation world",
  legalBasis: "training_simulation",
} as const;

/** Transforms the CLI can run. Grows as transform batches land (P2-009/010/026/030). */
const TRANSFORMS: Transform[] = [httpScan];

function transformById(id: string): Transform | undefined {
  return TRANSFORMS.find((t) => t.manifest.id === id);
}

function passphraseFrom(file: string | undefined): { passphrase?: string } {
  if (file) return { passphrase: readFileSync(file, "utf8").replace(/\r?\n$/, "") };
  const env = process.env["IR_CASE_PASSPHRASE"];
  return env ? { passphrase: env } : {};
}

export async function main(
  argv: string[],
  out: (s: string) => void = stdout,
  err: (s: string) => void = stderr,
  opts: CliOptions = {},
): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        key: { type: "string" },
        checkpoint: { type: "string" },
        "passphrase-file": { type: "string" },
        json: { type: "boolean" },
        at: { type: "string" },
        expect: { type: "string" },
        sim: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (x) {
    err(`${(x as Error).message}\n${USAGE}`);
    return 2;
  }
  const [cmd, dir, ...rest] = parsed.positionals;
  if (parsed.values.help) {
    out(USAGE);
    return 0;
  }
  if (cmd === "project" && dir && rest.length === 0) return runProject(dir, parsed.values, out, err);
  if (cmd === "run" && dir && rest.length === 3) {
    return runTransformCommand(dir, rest[0], rest[1], rest[2], parsed.values, out, err, opts);
  }
  if (cmd !== "verify" || !dir || rest.length > 0) {
    err(USAGE);
    return 2;
  }
  return runVerify(dir, parsed.values, out, err);
}

type Values = {
  key?: string | undefined;
  checkpoint?: string | undefined;
  json?: boolean | undefined;
  "passphrase-file"?: string | undefined;
};

function runVerify(dir: string, v: Values, out: (s: string) => void, err: (s: string) => void): number {
  try {
    const report = verifyCase(dir, {
      ...(v.key ? { publicKeyPem: readFileSync(v.key, "utf8") } : {}),
      ...(v.checkpoint ? { checkpoint: readCheckpointFile(v.checkpoint) } : {}),
      ...passphraseFrom(v["passphrase-file"]),
    });
    out(v.json ? JSON.stringify(report, null, 2) : formatReport(report));
    return report.ok ? 0 : 1;
  } catch (x) {
    err(`ir verify: ${(x as Error).message}`);
    return 2;
  }
}

function summary(p: Projection, hash: string): string {
  const c = p.counts;
  return [
    `projection at seq ${p.seq}`,
    `  nodes ${c.nodes} (entities ${c.entities}), edges ${c.edges} (claims ${c.claims}), observations ${c.observations}, evidence ${c.evidence}, active merges ${c.merges}`,
    `  coverage: ${p.coverage.cells.length} cells over ${p.coverage.transforms.length} transforms, ${p.coverage.untouched.length} untouched nodes`,
    `  issues: ${p.issues.length}${p.issues
      .slice(0, 5)
      .map((i) => `\n    #${i.seq} ${i.code}: ${i.message}`)
      .join("")}`,
    `  sha256 ${hash}`,
  ].join("\n");
}

/** `ir project` (P1-016, toward T-LED-020): offline rebuild of the views from the chain. */
function runProject(
  dir: string,
  v: { at?: string | undefined; expect?: string | undefined; json?: boolean | undefined; "passphrase-file"?: string | undefined },
  out: (s: string) => void,
  err: (s: string) => void,
): number {
  const at = v.at === undefined ? undefined : Number(v.at);
  if (at !== undefined && !Number.isInteger(at)) {
    err(`ir project: --at must be an integer seq\n${USAGE}`);
    return 2;
  }
  try {
    // the passphrase is handed to openCase as its own field, only to unwrap the case key (Argon2id, P1-014); it is
    // never part of what gets hashed
    const { passphrase } = passphraseFrom(v["passphrase-file"]);
    const c =
      passphrase === undefined
        ? openCase(dir, { actor: "ir-cli", readOnly: true })
        : openCase(dir, { actor: "ir-cli", readOnly: true, passphrase });
    try {
      const p = project(c.entries(), at === undefined ? {} : { upTo: at });
      const hash = projectionHash(p);
      out(v.json ? JSON.stringify({ ...p, sha256: hash }, null, 2) : summary(p, hash));
      if (v.expect && v.expect !== hash) {
        err(`ir project: hash ${hash} does not match --expect ${v.expect}`);
        return 1;
      }
      return 0;
    } finally {
      c.close();
    }
  } catch (x) {
    err(`ir project: ${(x as Error).message}`);
    return 2;
  }
}

type RunValues = {
  sim?: string | undefined;
  json?: boolean | undefined;
  "passphrase-file"?: string | undefined;
};

/** The mime type of a stored evidence blob, from the response's content-type (defaults to text/plain). */
function mimeFrom(headers: Readonly<Record<string, string>> | undefined): string {
  const ct = headers?.["content-type"] ?? headers?.["Content-Type"];
  if (!ct) return "text/plain";
  const mime = ct.split(";")[0].trim().toLowerCase();
  return /^[\w.+-]+\/[\w.+-]+$/.test(mime) ? mime : "text/plain";
}

/**
 * Stores every recorded request outcome as evidence (D1: raw response, content-addressed). Returns the id of the
 * final response — the one the transform's findings are based on. A run that made no request (e.g. refused before
 * any request) stores a synthetic LOCAL record so observations always cite real evidence.
 */
/** The ledger's transformId is a lowercase Slug; manifest ids are uppercase (TR-010 → tr-010). */
function ledgerTransformId(transform: Transform): string {
  return transform.manifest.id.toLowerCase();
}

function storeRunEvidence(c: Case, evidence: TransformEvidence[], transform: Transform, clock: Clock): string {
  const ids: string[] = [];
  for (const ev of evidence) {
    const stored = c.addEvidence({
      bytes: new TextEncoder().encode(ev.body ?? ""),
      mime: mimeFrom(ev.headers),
      request: {
        method: ev.method === "HEAD" ? "HEAD" : "GET",
        url: ev.url,
        headers: {},
        ...(ev.status !== undefined ? { status: ev.status } : {}),
      },
      transformId: ledgerTransformId(transform),
      version: transform.manifest.version,
      fetchedAt: isoNow(clock),
    });
    ids.push(stored.id);
  }
  if (ids.length === 0) {
    const stored = c.addEvidence({
      bytes: new TextEncoder().encode(""),
      mime: "text/plain",
      request: { method: "LOCAL", url: "local://ir-run", headers: {} },
      transformId: ledgerTransformId(transform),
      version: transform.manifest.version,
      fetchedAt: isoNow(clock),
    });
    return stored.id;
  }
  return ids[ids.length - 1];
}

/** Reuses the subject node when it already exists (D-020: one node per canonical key), else creates it. */
function ensureSubject(c: Case, key: string, type: string, clock: Clock): string {
  const p = project(c.entries());
  const existing = p.graph.nodes.find((n) => n.canonicalKey === key);
  if (existing) return existing.id;
  const id = ulidFactory(clock)();
  c.append("entity.added", {
    id,
    type,
    canonicalKey: key,
    labels: { en: key.slice(key.indexOf(":") + 1) },
    props: {},
  });
  return id;
}

function readSimRules(file: string): SimRule[] {
  const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
  if (!Array.isArray(parsed)) throw new Error("--sim must be a JSON array of sim rules");
  return parsed as SimRule[];
}

function runSummary(
  transform: Transform,
  subjectType: string,
  subjectValue: string,
  result: RunTransformResult,
  expand: ExpandResult,
  p: Projection,
  hash: string,
  negative: boolean,
): string {
  const lines = [
    `ir run: ${transform.manifest.id} on ${subjectType}:${subjectValue}`,
    `  requests ${result.requestCount}`,
    `  findings ${result.output.findings.length}`,
  ];
  for (const f of result.output.findings) {
    lines.push(`    ${f.predicate} -> ${f.objectType} ${f.objectValue} (${f.confidence.toFixed(2)})`);
  }
  if (negative) lines.push("  no findings: negative observation recorded");
  lines.push(`  expanded: ${expand.claimIds.length} claims, ${expand.attributeCount} attributes, ${expand.rejectedCount} rejected`);
  lines.push(
    `  projection at seq ${p.seq}: nodes ${p.counts.nodes}, edges ${p.counts.edges}, observations ${p.counts.observations}, evidence ${p.counts.evidence}`,
  );
  lines.push(`  sha256 ${hash}`);
  return lines.join("\n");
}

/**
 * `ir run` (P2-022): runs a transform against a subject in the deterministic simulation world, stores the response
 * as evidence, and expands the findings into the ledger. The subject is a catalog identifier type; the transform's
 * declared input is filled with the subject value. Failures are recorded as error observations (D3), never dropped.
 * Encrypted cases are refused: the CLI is a simulation/testing tool and sealed payloads add no value here.
 */
async function runTransformCommand(
  dir: string,
  transformId: string,
  subjectType: string,
  subjectValue: string,
  v: RunValues,
  out: (s: string) => void,
  err: (s: string) => void,
  opts: CliOptions,
): Promise<number> {
  try {
    const transform = transformById(transformId);
    if (!transform) {
      err(`ir run: unknown transform "${transformId}"`);
      return 2;
    }
    if (!specById(subjectType)) {
      err(`ir run: subject type "${subjectType}" is not a catalog identifier type`);
      return 2;
    }
    const { passphrase } = passphraseFrom(v["passphrase-file"]);
    const clock = opts.clock ?? systemClock;
    const c =
      passphrase === undefined
        ? openCase(dir, { actor: "ir-cli", clock, create: DEFAULT_CASE })
        : openCase(dir, { actor: "ir-cli", clock, passphrase, create: DEFAULT_CASE });
    try {
      if (c.encrypted) {
        err("ir run: refusing to run a transform against an encrypted case (P2-022)");
        return 2;
      }
      const subjectKey = canonicalKey(subjectType, subjectValue);
      const subjectId = ensureSubject(c, subjectKey, subjectType, clock);
      const rules = v.sim ? readSimRules(v.sim) : [];
      const sim = createSimServer(rules);
      const input = { [transform.manifest.inputs[0]]: subjectValue };
      let result: RunTransformResult;
      try {
        result = await runTransform(transform, { transport: sim.transport, input, now: opts.now, sleep: opts.sleep });
      } catch (x) {
        if (x instanceof TransformRunError) {
          const evidenceId = storeRunEvidence(c, x.evidence, transform, clock);
          recordOutcome(subjectId, "error", { ledger: c.ledger, transformId: ledgerTransformId(transform), evidenceId, clock }, x.message);
          err(`ir run: ${x.message}`);
          return 1;
        }
        throw x;
      }
      const evidenceId = storeRunEvidence(c, result.evidence, transform, clock);
      const expand = expandFindings(result.output, subjectId, {
        ledger: c.ledger,
        transformId: ledgerTransformId(transform),
        evidenceId,
        clock,
      });
      const negative = result.output.findings.length === 0;
      if (negative) {
        recordOutcome(subjectId, "negative", { ledger: c.ledger, transformId: ledgerTransformId(transform), evidenceId, clock });
      }
      const p = project(c.entries());
      const hash = projectionHash(p);
      if (v.json) {
        out(
          JSON.stringify(
            {
              transformId,
              subject: { type: subjectType, value: subjectValue, entityId: subjectId },
              requestCount: result.requestCount,
              findings: result.output.findings,
              expand,
              projection: { seq: p.seq, sha256: hash, counts: p.counts },
            },
            null,
            2,
          ),
        );
      } else {
        out(runSummary(transform, subjectType, subjectValue, result, expand, p, hash, negative));
      }
      return 0;
    } finally {
      c.close();
    }
  } catch (x) {
    err(`ir run: ${(x as Error).message}`);
    return 2;
  }
}

// Run only as the entry point (bin symlinks resolve to the real file), not when imported by tests.
const isEntry = process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
if (isEntry) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (x) => {
      process.stderr.write(`ir: ${(x as Error).message}\n`);
      process.exitCode = 2;
    },
  );
}
