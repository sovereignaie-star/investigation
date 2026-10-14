import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { canonicalKey, isoNow, systemClock, ulidFactory, type Clock } from "@ir/core";
import { specById } from "@ir/core/identifiers";
import type { ExpandResult } from "@ir/ledger";
import { project, projectionHash, type Projection } from "@ir/ledger/projections";
import { formatReport, openCase, readCheckpointFile, verifyCase, type Case } from "@ir/store";
import { createSimServer, type SimRule } from "@ir/sim";
import { httpScan, runTransform, TransformRunError, type RunTransformResult, type Transform } from "@ir/transforms";
import type { HttpTransport } from "@ir/engine";
import { LegalBasis, type CaseInit } from "@ir/schema";
import { planNetworkRun, type NetworkDeps } from "./network.ts";
import { recordRunFailure, recordRunSuccess } from "./run-record.ts";

const USAGE = `usage: ir verify <case-dir> [--key installation.pub] [--checkpoint checkpoint.json] [--passphrase-file file] [--json]
       ir project <case-dir> [--at seq] [--expect sha256] [--passphrase-file file] [--json]
       ir run <case-dir> <transform-id> <subject-type> <subject-value> [--sim rules.json] [--json] [--passphrase-file file]
       ir run <case-dir> <transform-id> <subject-type> <subject-value> --network --allow-host <host> [--allow-host <host>...]
              [--purpose text --legal-basis basis] [--json]

  verify:  recomputes the hash chain, re-hashes every evidence blob, and checks signed checkpoints.
  project: rebuilds the graph, table and coverage views from the chain, offline (optionally as of seq --at),
           and prints their counts and projection hash; --expect fails (exit 1) unless the hash matches.
  run:     runs a transform against a subject in the deterministic simulation world (@ir/sim), stores the
           response as evidence, and expands the findings into the ledger. --sim loads a JSON array of sim
           rules (see @ir/sim); without it every URL returns 200 with an empty body. Refuses encrypted cases.
  run --network (P2-003): real network through @ir/egress only, with the transform in the T-SBX sandbox. Needs
           IR_ENABLE_NETWORK=1 in the environment (IR_OFFLINE=1 always wins) and at least one --allow-host; every
           request and redirect hop must stay on that list. A new case needs --purpose and --legal-basis (not
           training_simulation); a simulation case is refused. Every gateway decision goes to the case audit chain.
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
  /** Tests only: replaces the real resolver/transport of `--network`; every policy and opt-in stays real. */
  network?: NetworkDeps;
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
        network: { type: "boolean" },
        "allow-host": { type: "string", multiple: true },
        purpose: { type: "string" },
        "legal-basis": { type: "string" },
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
  network?: boolean | undefined;
  "allow-host"?: string[] | undefined;
  purpose?: string | undefined;
  "legal-basis"?: string | undefined;
  json?: boolean | undefined;
  "passphrase-file"?: string | undefined;
};

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

/** The case record for a new `--network` case: a real purpose and legal basis, never the simulation one. */
function networkCase(v: RunValues): CaseInit | undefined | string {
  const purpose = v.purpose?.trim() ?? "";
  const basis = v["legal-basis"] ?? "";
  // No case fields: the case must already exist (openCase refuses to create one without a purpose, E-01).
  if (purpose === "" && basis === "") return undefined;
  if (purpose.length < 10) return "--network: --purpose must state the purpose (>= 10 characters)";
  const parsed = LegalBasis.safeParse(basis);
  if (!parsed.success || parsed.data === "training_simulation") {
    return `--network: --legal-basis must be one of ${LegalBasis.options.filter((b) => b !== "training_simulation").join(", ")}`;
  }
  return { title: "ir run --network", purpose, legalBasis: parsed.data };
}

/** Opens (or creates) the case for `ir run`; a `--network` case gets a real purpose and basis (or must exist). */
function openRunCase(dir: string, v: RunValues, clock: Clock): Case | string {
  if (v.network && v.sim) return "--network and --sim are exclusive";
  const create = v.network ? networkCase(v) : DEFAULT_CASE;
  if (typeof create === "string") return create;
  const { passphrase } = passphraseFrom(v["passphrase-file"]);
  const createOpt: { create?: CaseInit } = create ? { create } : {};
  return passphrase === undefined
    ? openCase(dir, { actor: "ir-cli", clock, ...createOpt })
    : openCase(dir, { actor: "ir-cli", clock, passphrase, ...createOpt });
}

/** Simulation (default) or the real network through @ir/egress with the transform isolated (`--network`). */
function runRoute(
  c: Case,
  transform: Transform,
  subjectType: string,
  v: RunValues,
  opts: CliOptions,
): { transport: HttpTransport; isolatedModule?: string; allowedHosts?: readonly string[] } | { error: string } {
  if (!v.network) return { transport: createSimServer(v.sim ? readSimRules(v.sim) : []).transport };
  if (c.info().legalBasis === "training_simulation") {
    return { error: "--network: this is a simulation case (legal basis training_simulation); use a case with a real basis" };
  }
  const plan = planNetworkRun(c, transform, subjectType, v["allow-host"] ?? [], opts.network ?? {});
  if ("error" in plan) return plan;
  return { transport: plan.transport, isolatedModule: plan.isolatedModule, allowedHosts: plan.allowedHosts };
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
    const clock = opts.clock ?? systemClock;
    const c = openRunCase(dir, v, clock);
    if (typeof c === "string") {
      err(`ir run: ${c}`);
      return 2;
    }
    try {
      if (c.encrypted) {
        err("ir run: refusing to run a transform against an encrypted case (P2-022)");
        return 2;
      }
      const subjectKey = canonicalKey(subjectType, subjectValue);
      const subjectId = ensureSubject(c, subjectKey, subjectType, clock);
      const route = runRoute(c, transform, subjectType, v, opts);
      if ("error" in route) {
        err(`ir run: ${route.error}`);
        return 2;
      }
      const input = { [transform.manifest.inputs[0]]: subjectValue };
      let result: RunTransformResult;
      try {
        result = await runTransform(transform, {
          transport: route.transport,
          input,
          now: opts.now,
          sleep: opts.sleep,
          // P2-036: evidence fetch times come from the case clock, like every other ledger timestamp.
          fetchedAt: () => isoNow(clock),
          ...(route.isolatedModule
            ? { requireIsolation: true, isolatedModule: route.isolatedModule, transformId: transform.manifest.id }
            : {}),
        });
      } catch (x) {
        if (x instanceof TransformRunError) {
          // P2-036: the error observation cites the failed request's own evidence (or a run record naming the
          // stage, message and every response received) — never the last response, never an empty success.
          recordRunFailure(c, subjectId, transform, input, x, clock);
          err(`ir run: ${x.message}`);
          return 1;
        }
        throw x;
      }
      // P2-036: every finding is bound to the evidence of the request(s) it cites (TransformFinding.evidence).
      const recorded = recordRunSuccess(c, subjectId, transform, input, result, clock);
      const { expand, negative } = recorded;
      const p = project(c.entries());
      const hash = projectionHash(p);
      if (v.json) {
        out(
          JSON.stringify(
            {
              transformId,
              network: route.isolatedModule ? { mode: "real", allowedHosts: route.allowedHosts, isolated: true } : { mode: "simulation" },
              subject: { type: subjectType, value: subjectValue, entityId: subjectId },
              requestCount: result.requestCount,
              requests: recorded.requests,
              findings: result.output.findings,
              bindings: recorded.bindings,
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
