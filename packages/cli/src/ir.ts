import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { isoNow, systemClock, type Clock } from "@ir/core";
import { specById } from "@ir/core/identifiers";
import type { ExpandResult } from "@ir/ledger";
import { project, projectionHash, type Projection } from "@ir/ledger/projections";
import { formatReport, openCase, readCheckpointFile, verifyCase, type Case } from "@ir/store";
import { createSimServer, type SimRule } from "@ir/sim";
import { runTransform, TransformRunError, type RunTransformResult, type Transform } from "@ir/transforms";
import type { HttpTransport } from "@ir/engine";
import type { EgressAuditEvent } from "@ir/egress";
import { LegalBasis, type CaseInit } from "@ir/schema";
import { planNetworkRun, type NetworkDeps } from "./network.ts";
import { REGISTRY, registered, subjectInput, type RegisteredTransform } from "./registry.ts";
import { ensureSubject, recordRunFailure, recordRunSuccess } from "./run-record.ts";
import { importAdsbAircraftDump } from "./adsb-import.ts";
import { importAisVesselDump } from "./ais-import.ts";
import { corroboration, disabledSources, investigate, type InvestigationBudget, type InvestigationResult } from "./investigate.ts";

const USAGE = `usage: ir verify <case-dir> [--key installation.pub] [--checkpoint checkpoint.json] [--passphrase-file file] [--json]
       ir project <case-dir> [--at seq] [--expect sha256] [--passphrase-file file] [--json]
       ir run <case-dir> <transform-id> <subject-type> <subject-value> [--sim rules.json] [--json] [--passphrase-file file]
       ir run <case-dir> <transform-id> <subject-type> <subject-value> --network --allow-host <host> [--allow-host <host>...]
              [--purpose text --legal-basis basis] [--json]
       ir investigate <case-dir> <subject-type> <subject-value> --network --allow-host <host> [--allow-host <host>...]
              [--transform TR-nnn...] [--exclude TR-nnn...] [--max-depth n] [--max-runs n] [--max-requests n]
              [--max-bytes n] [--max-time-ms n] [--purpose text --legal-basis basis] [--json]
       ir source <case-dir> <disable|enable|list> [TR-nnn] [--reason text] [--json] [--passphrase-file file]
       ir import <case-dir> <adsb|ais> <file> [--purpose text --legal-basis basis] [--json] [--passphrase-file file]

  verify:  recomputes the hash chain, re-hashes every evidence blob, and checks signed checkpoints.
  project: rebuilds the graph, table, coverage and network-log views from the chain, offline (optionally as of seq --at),
           and prints their counts and projection hash; --expect fails (exit 1) unless the hash matches.
  run:     runs a transform against a subject in the deterministic simulation world (@ir/sim), stores the
           response as evidence, and expands the findings into the ledger. --sim loads a JSON array of sim
           rules (see @ir/sim); without it every URL returns 200 with an empty body. Refuses encrypted cases.
  run --network (P2-003): real network through @ir/egress only, with the transform in the T-SBX sandbox. Needs
           IR_ENABLE_NETWORK=1 in the environment (IR_OFFLINE=1 always wins) and at least one --allow-host; every
           request and redirect hop must stay on that list. A new case needs --purpose and --legal-basis (not
           training_simulation); a simulation case is refused. Every gateway decision goes to the case audit chain.
  investigate (P2-038): from one seed, runs every registered transform (or the --transform ones) that accepts each
           entity's type, isolated through the same gateway, under a budget (defaults: depth 1, 10 runs, 50
           requests, 10 MB, 120 s). One node per identifier, every edge from every parent kept; a transform runs at
           most once per identifier. Coverage per entity and transform: found, none, failed, not_run (with reason).
           Exit 0 when it completed, 1 when any run failed or the budget/cancellation stopped it, 2 on usage errors.
  import (P2-031): binds a recorded local receiver dump to the case entities and builds the time-track. adsb
           reads a readsb/dump1090 aircraft.json snapshot; ais reads the AIS-catcher JSON output (one JSON record
           per line, or a JSON array). Local transforms only (TR-090/TR-091): no network. A new case needs
           --purpose and --legal-basis (not training_simulation). Rejected records are counted, never silently
           dropped. Exit 0 on import, 2 on usage or I/O errors.
  source (P2-029): records — on the case's own audit chain — that a source (a registered transform id) is
           disabled for this case, or re-enables it (the latest event per source wins); an investigation never
           invokes a disabled source: its runs are recorded not_run with the reason. disable needs a --reason
           (one line, recorded with the event); the exclusion is per case, while --exclude is per invocation.
           list prints every registered source with its state for this case. Exit 0 on success, 2 on usage errors.
           The investigation also reports per-source statistics (outcomes, wall time, measured cost: requests +
           bytes) in its output and on the investigate.completed audit event.
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
  /**
   * P2-037 — cancels a running `ir run` (the entry point aborts it on SIGINT/SIGTERM). The run signal reaches the
   * sandbox, every pending gateway request and the transport; the cancelled run is recorded as an error, never as
   * an empty success.
   */
  signal?: AbortSignal;
}

/** Case created by `ir run` when the target directory has no case yet (P2-022). */
const DEFAULT_CASE = {
  title: "ir run",
  purpose: "CLI transform run in the deterministic simulation world",
  legalBasis: "training_simulation",
} as const;

/** Transforms the CLI can run. Grows as transform batches land (P2-009/010/026/030). */

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
        transform: { type: "string", multiple: true },
        exclude: { type: "string", multiple: true },
        reason: { type: "string" },
        "max-depth": { type: "string" },
        "max-runs": { type: "string" },
        "max-requests": { type: "string" },
        "max-bytes": { type: "string" },
        "max-time-ms": { type: "string" },
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
  const command = dir ? commandFor(cmd, dir, rest, parsed.values, out, err, opts) : undefined;
  if (!command) {
    err(USAGE);
    return 2;
  }
  return command();
}

/** The sub-command for the positionals, or undefined for a usage error. */
function commandFor(
  cmd: string | undefined,
  dir: string,
  rest: string[],
  v: RunValues & InvestigateValues & Values & { at?: string | undefined; expect?: string | undefined },
  out: (s: string) => void,
  err: (s: string) => void,
  opts: CliOptions,
): (() => number | Promise<number>) | undefined {
  const arity: Record<string, number> = { verify: 0, project: 0, run: 3, investigate: 2, import: 2 };
  // P2-029: `ir source` takes up to 2 positionals after the case dir: the verb, then (for
  // disable/enable) the transform id.
  if (cmd === "source") {
    if (rest.length > 2) return undefined;
    return () => runSourceCommand(dir, rest[0], rest[1], v, out, err);
  }
  if (cmd === undefined || arity[cmd] !== rest.length) return undefined;
  switch (cmd) {
    case "verify":
      return () => runVerify(dir, v, out, err);
    case "project":
      return () => runProject(dir, v, out, err);
    case "run":
      return () => runTransformCommand(dir, rest[0], rest[1], rest[2], v, out, err, opts);
    case "import":
      return () => runImportCommand(dir, rest[0], rest[1], v, out, err, opts);
    default:
      return () => runInvestigateCommand(dir, rest[0], rest[1], v, out, err, opts);
  }
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
    `  network (P2-014): ${p.networkLog.requests.length} requests (${p.networkLog.requests.filter((q) => q.decision !== "allowed").length} not allowed), ${p.networkLog.transportCalls.length} transport calls, ${p.networkLog.responses.length} stored outcomes (${originSummary(p.networkLog.responses)})`,
    `  issues: ${p.issues.length}${p.issues
      .slice(0, 5)
      .map((i) => `\n    #${i.seq} ${i.code}: ${i.message}`)
      .join("")}`,
    `  sha256 ${hash}`,
  ].join("\n");
}

/** P2-014: outcome origins in the network line — a sim/replay/unknown outcome is a stored outcome, not a real connection. */
function originSummary(responses: readonly { origin?: string }[]): string {
  const count = (o: string) => responses.filter((r) => r.origin === o).length;
  const unknown = responses.filter((r) => r.origin === undefined).length;
  return `network: ${count("network")}, sim: ${count("sim")}, replay: ${count("replay")}, unknown: ${unknown}`;
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

/** The case record for a new `ir import` case: real recorded receiver data needs a real purpose and basis. */
function importCase(v: RunValues): CaseInit | undefined | string {
  const purpose = v.purpose?.trim() ?? "";
  const basis = v["legal-basis"] ?? "";
  if (purpose === "" && basis === "") return undefined;
  if (purpose.length < 10) return "ir import: --purpose must state the purpose (>= 10 characters)";
  const parsed = LegalBasis.safeParse(basis);
  if (!parsed.success || parsed.data === "training_simulation") {
    return `ir import: --legal-basis must be one of ${LegalBasis.options.filter((b) => b !== "training_simulation").join(", ")}`;
  }
  return { title: "ir import", purpose, legalBasis: parsed.data };
}

/** `ir import` (P2-031): binds a recorded local receiver dump (ADS-B / AIS) to the case entities. */
async function runImportCommand(
  dir: string,
  kind: string,
  file: string,
  v: RunValues,
  out: (s: string) => void,
  err: (s: string) => void,
  opts: CliOptions,
): Promise<number> {
  if (kind !== "adsb" && kind !== "ais") {
    err(`ir import: unknown kind ${JSON.stringify(kind)} (adsb or ais)\n${USAGE}`);
    return 2;
  }
  let content: string;
  try {
    content = readFileSync(file, "utf8");
  } catch (x) {
    err(`ir import: cannot read ${file}: ${(x as Error).message}`);
    return 2;
  }
  const create = importCase(v);
  if (typeof create === "string") {
    err(create);
    return 2;
  }
  const clock = opts.clock ?? systemClock;
  const { passphrase } = passphraseFrom(v["passphrase-file"]);
  const createOpt: { create?: CaseInit } = create ? { create } : {};
  try {
    const c =
      passphrase === undefined
        ? openCase(dir, { actor: "ir-cli", clock, ...createOpt })
        : openCase(dir, { actor: "ir-cli", clock, passphrase, ...createOpt });
    try {
      const res = kind === "adsb" ? await importAdsbAircraftDump(c, content, clock) : await importAisVesselDump(c, content, clock);
      const records = "aircraftCount" in res ? res.aircraftCount : res.vesselCount;
      const p = project(c.entries());
      const hash = projectionHash(p);
      const summary = [
        `ir import: ${kind} ${file}`,
        `  records ${records}, entities ${res.entityIds.length}, claims ${res.claimCount}, rejected ${res.rejected}`,
        `  projection at seq ${p.seq}: nodes ${p.counts.nodes}, edges ${p.counts.edges}, observations ${p.counts.observations}, evidence ${p.counts.evidence}`,
        `  sha256 ${hash}`,
      ].join("\n");
      out(
        v.json
          ? JSON.stringify(
              {
                kind,
                file,
                records,
                entities: res.entityIds.length,
                claims: res.claimCount,
                rejected: res.rejected,
                projection: { ...p, sha256: hash },
              },
              null,
              2,
            )
          : summary,
      );
      return 0;
    } finally {
      c.close();
    }
  } catch (x) {
    err(`ir import: ${(x as Error).message}`);
    return 2;
  }
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
  entry: RegisteredTransform,
  subjectType: string,
  v: RunValues,
  opts: CliOptions,
):
  | {
      transport: HttpTransport;
      origin: "network" | "sim";
      isolatedModule?: string;
      allowedHosts?: readonly string[];
      events?: readonly EgressAuditEvent[];
    }
  | { error: string } {
  if (!v.network) return { transport: createSimServer(v.sim ? readSimRules(v.sim) : []).transport, origin: "sim" };
  if (c.info().legalBasis === "training_simulation") {
    return { error: "--network: this is a simulation case (legal basis training_simulation); use a case with a real basis" };
  }
  const plan = planNetworkRun(c, entry, subjectType, v["allow-host"] ?? [], opts.network ?? {});
  if ("error" in plan) return plan;
  return {
    transport: plan.transport,
    origin: "network",
    isolatedModule: plan.isolatedModule,
    allowedHosts: plan.allowedHosts,
    events: plan.events,
  };
}

/**
 * P2-037 — a clear message when the gateway refused a host the operator did not list. The host list is never
 * widened from a source's answer (an RDAP server found in an IANA bootstrap included): the operator decides.
 */
function hostRefusalHint(entry: RegisteredTransform, events: readonly EgressAuditEvent[] | undefined): string {
  const refused = [...new Set((events ?? []).filter((e) => e.kind === "denied" && e.reason === "host_not_allowed").map((e) => e.host))];
  if (refused.length === 0) return "";
  const discovered = entry.discoveredHosts ? ` (${entry.transform.manifest.id} reaches ${entry.discoveredHosts})` : "";
  return `; refused before connecting: ${refused.join(", ")} not on --allow-host${discovered} — add it with --allow-host only if that source is authorised`;
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
    // P2-037: only registered transforms run, and the subject is checked against the transform's declared
    // subjects and the catalog format before any case is opened or any request is made.
    const entry = registered(transformId);
    if (!entry) {
      err(`ir run: unknown transform "${transformId}"`);
      return 2;
    }
    const transform = entry.transform;
    if (!specById(subjectType)) {
      err(`ir run: subject type "${subjectType}" is not a catalog identifier type`);
      return 2;
    }
    const prepared = subjectInput(entry, subjectType, subjectValue);
    if ("error" in prepared) {
      err(`ir run: ${prepared.error}`);
      return 2;
    }
    const { input, key: subjectKey } = prepared;
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
      const route = runRoute(c, entry, subjectType, v, opts);
      if ("error" in route) {
        err(`ir run: ${route.error}`);
        return 2;
      }
      const subjectId = ensureSubject(c, subjectKey, subjectType, clock);
      let result: RunTransformResult;
      try {
        result = await runTransform(transform, {
          transport: route.transport,
          input,
          now: opts.now,
          sleep: opts.sleep,
          ...(opts.signal ? { signal: opts.signal } : {}),
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
          recordRunFailure(c, subjectId, transform, input, x, clock, route.origin);
          err(`ir run: ${x.message}${hostRefusalHint(entry, route.events)}`);
          return 1;
        }
        throw x;
      }
      // P2-036: every finding is bound to the evidence of the request(s) it cites (TransformFinding.evidence).
      const recorded = recordRunSuccess(c, subjectId, transform, input, result, clock, route.origin);
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

type InvestigateValues = RunValues & {
  transform?: string[] | undefined;
  exclude?: string[] | undefined;
  "max-depth"?: string | undefined;
  "max-runs"?: string | undefined;
  "max-requests"?: string | undefined;
  "max-bytes"?: string | undefined;
  "max-time-ms"?: string | undefined;
};

/** Parses the budget flags; each must be a non-negative integer. */
function budgetFrom(v: InvestigateValues): Partial<InvestigationBudget> | string {
  const flags: Array<[keyof InvestigationBudget, string | undefined, string]> = [
    ["maxDepth", v["max-depth"], "--max-depth"],
    ["maxRuns", v["max-runs"], "--max-runs"],
    ["maxRequests", v["max-requests"], "--max-requests"],
    ["maxBytes", v["max-bytes"], "--max-bytes"],
    ["maxElapsedMs", v["max-time-ms"], "--max-time-ms"],
  ];
  const out: Partial<Record<keyof InvestigationBudget, number>> = {};
  for (const [k, raw, flag] of flags) {
    if (raw === undefined) continue;
    if (!/^\d+$/.test(raw)) return `${flag} must be a non-negative integer`;
    out[k] = Number(raw);
  }
  return out;
}

/** Refusals before any case work: the usage rules of `ir investigate`. */
function investigateUsage(v: InvestigateValues): Partial<InvestigationBudget> | string {
  if (!v.network) return "--network is required (an investigation runs only isolated, through the egress gateway)";
  return budgetFrom(v);
}

/** P2-029 — `ir source list`: every registered source with its current state for this case. */
function printSourceList(c: Case, json: boolean, out: (s: string) => void): void {
  const disabled = disabledSources(c);
  const rows = REGISTRY.map((e) => {
    const id = e.transform.manifest.id;
    const s = disabled.get(id);
    return {
      transformId: id,
      ...(e.transform.manifest.secrets.length > 0 && e.keyUrl ? { keyUrl: e.keyUrl } : {}),
      state: s?.disabled ? "disabled" : "enabled",
      ...(s?.disabled ? { reason: s.reason } : {}),
    };
  });
  if (json) {
    out(JSON.stringify(rows, null, 2));
    return;
  }
  const lines = ["ir source: registered sources for this case:"];
  for (const r of rows) lines.push(`  ${r.transformId}: ${r.state}${r.state === "disabled" && r.reason ? ` — ${r.reason}` : ""}`);
  out(lines.join("\n"));
}

/** P2-029 — `ir source disable|enable`: records the event on the case's audit chain (latest wins). */
function recordSourceToggle(
  c: Case,
  verb: "disable" | "enable",
  transformId: string,
  reason: string | undefined,
  json: boolean,
  out: (s: string) => void,
): number {
  c.audit(verb === "disable" ? "source.disable" : "source.enable", transformId, {
    ...(reason ? { reason } : {}),
  });
  const action = verb === "disable" ? "disabled" : "enabled";
  out(json ? JSON.stringify({ transformId, action }) : `ir source: ${transformId} ${action}${reason ? ` — ${reason}` : ""}`);
  return 0;
}

/** P2-029: the usage rules of `ir source` — the verb, and which verbs take a transform id. */
function sourceUsageError(verb: string | undefined, transformId: string | undefined): string | undefined {
  if (verb !== "disable" && verb !== "enable" && verb !== "list") return "verb must be disable, enable, or list";
  if (verb === "list") return transformId !== undefined ? "list takes no transform id" : undefined;
  return transformId === undefined ? "missing transform id" : undefined;
}

/**
 * P2-029 — `ir source`: records a source's disabled state for this case on its own audit chain
 * (`source.disable` / `source.enable`, the latest event per source wins), or lists every registered
 * source with its current state for this case. An investigation never invokes a disabled source.
 */
async function runSourceCommand(
  dir: string,
  verb: string | undefined,
  transformId: string | undefined,
  v: Values & { reason?: string | undefined },
  out: (s: string) => void,
  err: (s: string) => void,
): Promise<number> {
  const fail = (msg: string) => (err(`ir source: ${msg}`), 2);
  const usage = sourceUsageError(verb, transformId);
  if (usage !== undefined) return fail(usage);
  try {
    // The passphrase is passed as an explicit property (never spread): spreading a password-bearing
    // object taints the whole options object in static analysis (CodeQL js/insufficient-password-hash).
    const { passphrase } = passphraseFrom(v["passphrase-file"]);
    const c = passphrase === undefined ? openCase(dir, { actor: "ir-cli" }) : openCase(dir, { actor: "ir-cli", passphrase });
    try {
      if (verb === "list") {
        printSourceList(c, v.json === true, out);
        return 0;
      }
      if (transformId === undefined || !registered(transformId)) return fail(`unknown transform "${transformId}"`);
      const reason = v.reason?.trim();
      if (verb === "disable" && (!reason || reason.includes("\n"))) return fail("--reason is required (one line)");
      if (verb === "enable" && reason) return fail("--reason belongs to disable");
      // the usage rules above guarantee verb is "disable" or "enable" here
      return recordSourceToggle(
        c,
        verb as "disable" | "enable",
        transformId,
        verb === "disable" ? reason : undefined,
        v.json === true,
        out,
      );
    } finally {
      c.close();
    }
  } catch (x) {
    return fail((x as Error).message);
  }
}

/** Refusals of the opened case: encrypted, or a simulation case. */
function investigateCaseRefusal(c: Case): string | undefined {
  if (c.encrypted) return "refusing an encrypted case";
  if (c.info().legalBasis === "training_simulation") {
    return "this is a simulation case (legal basis training_simulation); use a case with a real basis";
  }
  return undefined;
}

function printInvestigation(c: Case, r: InvestigationResult, json: boolean, out: (s: string) => void): void {
  const entries = c.entries();
  const p = project(entries);
  const hash = projectionHash(p);
  if (json) {
    out(
      JSON.stringify({ ...r, corroboration: corroboration(entries), projection: { seq: p.seq, sha256: hash, counts: p.counts } }, null, 2),
    );
    return;
  }
  const stop = r.stopReason ? `, stopped: ${r.stopReason}` : "";
  const lines = [`ir investigate: ${r.seedKey}: ${r.runs} runs, ${r.requests} requests, ${r.bytes} bytes${stop}`];
  for (const k of r.coverage)
    lines.push(`  ${k.transformId} ${k.entityKey} (depth ${k.depth}): ${k.state}${k.reason ? ` — ${k.reason}` : ""}`);
  // P2-029: the per-source statistics — outcomes, wall time, and the measured cost (requests + bytes).
  lines.push("  sources:");
  for (const s of r.sources)
    lines.push(
      `    ${s.transformId}: ${s.runs} runs (found ${s.found}, none ${s.none}, failed ${s.failed}, not_run ${s.notRun}) — ${s.requests} requests, ${s.bytes} bytes, ${s.elapsedMs} ms`,
    );
  if (r.unexpandable.length > 0) lines.push(`  no transform for: ${r.unexpandable.join(", ")}`);
  lines.push(`  projection at seq ${p.seq}: nodes ${p.counts.nodes}, edges ${p.counts.edges}; sha256 ${hash}`);
  out(lines.join("\n"));
}

/** `ir investigate` (P2-038): the expansion loop over registered connectors, network only, isolated only. */
async function runInvestigateCommand(
  dir: string,
  subjectType: string,
  subjectValue: string,
  v: InvestigateValues,
  out: (s: string) => void,
  err: (s: string) => void,
  opts: CliOptions,
): Promise<number> {
  const fail = (msg: string) => (err(`ir investigate: ${msg}`), 2);
  try {
    const budget = investigateUsage(v);
    if (typeof budget === "string") return fail(budget);
    const clock = opts.clock ?? systemClock;
    const c = openRunCase(dir, v, clock);
    if (typeof c === "string") return fail(c);
    try {
      const refused = investigateCaseRefusal(c);
      if (refused) return fail(refused);
      const r = await investigate(
        c,
        { type: subjectType, value: subjectValue },
        {
          allowHosts: v["allow-host"] ?? [],
          budget,
          transforms: v.transform,
          exclude: v.exclude,
          network: opts.network,
          clock,
          now: opts.now,
          sleep: opts.sleep,
          signal: opts.signal,
        },
      );
      if ("error" in r) return fail(r.error);
      printInvestigation(c, r, v.json === true, out);
      return r.stopReason !== undefined || r.coverage.some((k) => k.state === "failed") ? 1 : 0;
    } finally {
      c.close();
    }
  } catch (x) {
    return fail((x as Error).message);
  }
}

// Run only as the entry point (bin symlinks resolve to the real file), not when imported by tests.
const isEntry = process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
if (isEntry) {
  // P2-037: Ctrl-C / SIGTERM cancel the run through its signal (the sandbox and pending requests are stopped and the
  // cancellation is recorded in the case) instead of killing the process mid-write.
  const cancel = new AbortController();
  process.once("SIGINT", () => cancel.abort());
  process.once("SIGTERM", () => cancel.abort());
  main(process.argv.slice(2), undefined, undefined, { signal: cancel.signal }).then(
    (code) => {
      process.exitCode = code;
    },
    (x) => {
      process.stderr.write(`ir: ${(x as Error).message}\n`);
      process.exitCode = 2;
    },
  );
}
