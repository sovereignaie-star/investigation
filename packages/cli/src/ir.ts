import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { isoNow, systemClock, type Clock } from "@ir/core";
import { specById } from "@ir/core/identifiers";
import type { ExpandResult } from "@ir/ledger";
import { diffProjections, project, projectionHash, type Projection } from "@ir/ledger/projections";
import { formatReport, openCase, readCheckpointFile, verifyCase, type Case } from "@ir/store";
import { createSimServer, type SimRule } from "@ir/sim";
import { runTransform, TransformRunError, type RunTransformResult, type Transform } from "@ir/transforms";
import type { HttpTransport } from "@ir/engine";
import type { EgressAuditEvent } from "@ir/egress";
import { LegalBasis, type CaseInit } from "@ir/schema";
import { caseProxyConfig, planNetworkRun, proxyRoutingFor, type NetworkDeps } from "./network.ts";
import { REGISTRY, registered, subjectInput, type RegisteredTransform } from "./registry.ts";
import { ensureSubject, recordRunFailure, recordRunSuccess } from "./run-record.ts";
import { compareFindingStates, monitorFindingState, type MonitorFinding } from "./monitor-compare.ts";
import { storeWarcForRun } from "./warc.ts";
import { importAdsbAircraftDump } from "./adsb-import.ts";
import { importAisVesselDump } from "./ais-import.ts";
import { corroboration, disabledSources, investigate, type InvestigationBudget, type InvestigationResult } from "./investigate.ts";

const USAGE = `usage: ir verify <case-dir> [--key installation.pub] [--checkpoint checkpoint.json] [--passphrase-file file] [--json]
       ir project <case-dir> [--at seq] [--expect sha256] [--passphrase-file file] [--json]
       ir diff <case-dir> --from seq --to seq [--passphrase-file file] [--json]
       ir run <case-dir> <transform-id> <subject-type> <subject-value> [--sim rules.json] [--json] [--passphrase-file file]
       ir run <case-dir> <transform-id> <subject-type> <subject-value> --network --allow-host <host> [--allow-host <host>...]
              [--purpose text --legal-basis basis] [--json]
       ir investigate <case-dir> <subject-type> <subject-value> --network --allow-host <host> [--allow-host <host>...]
              [--transform TR-nnn...] [--exclude TR-nnn...] [--max-depth n] [--max-runs n] [--max-requests n]
              [--max-bytes n] [--max-time-ms n] [--purpose text --legal-basis basis] [--json]
       ir source <case-dir> <disable|enable|list> [TR-nnn] [--reason text] [--json] [--passphrase-file file]
       ir monitor <case-dir> add <transform-id> <subject-type> <subject-value> --every <minutes> [--sim rules.json]
       ir monitor <case-dir> list [--json] | check <monitor-id> [--sim rules.json] | remove <monitor-id>
       ir monitor <case-dir> run [--once] [--sim rules.json]
       ir import <case-dir> <adsb|ais> <file> [--purpose text --legal-basis basis] [--json] [--passphrase-file file]

  verify:  recomputes the hash chain, re-hashes every evidence blob, and checks signed checkpoints.
  project: rebuilds the graph, table, coverage and network-log views from the chain, offline (optionally as of seq --at),
           and prints their counts and projection hash; --expect fails (exit 1) unless the hash matches.
  diff:    compares two snapshots of one case (the projections at seq --from and seq --to) by legal keys and
           prints what was added, removed and changed (entities by canonicalKey, claims by id) with the counts
           of each (UC-09). Evidence accrual is not a content change. --json serves the full diff object.
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
  source:  a source's enable/disable state on the case's audit chain (latest wins) with its reason.
  monitor (P4-009, UC-10): scheduled monitoring of one identifier — the case's monitors live on its audit chain
           (the proxy.set pattern). add schedules (or updates) a monitor: re-running a transform on the subject
           every --every minutes. A check re-runs the transform through the real engine path and compares the run's
           normalized findings against the LAST SUCCESSFUL check: the first success establishes the baseline without
           alerting, a change alerts once (returning to a previous state is a NEW change), an unchanged re-check never
           repeats the alert, and a failed check is logged with its error and leaves the baseline intact. Every check
           is logged on the chain (started before the run, then its committed result). run is a foreground loop
           (--once runs the due checks and exits; a missed deadline is one catch-up check); it stops cleanly on
           Ctrl-C/SIGTERM and does not survive the process — a system timer re-invokes it.
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
        from: { type: "string" },
        to: { type: "string" },
        sim: { type: "string" },
        network: { type: "boolean" },
        "allow-host": { type: "string", multiple: true },
        purpose: { type: "string" },
        "legal-basis": { type: "string" },
        transform: { type: "string", multiple: true },
        exclude: { type: "string", multiple: true },
        reason: { type: "string" },
        "via-tor": { type: "boolean" },
        host: { type: "string" },
        port: { type: "string" },
        secret: { type: "string" },
        "max-depth": { type: "string" },
        "max-runs": { type: "string" },
        "max-requests": { type: "string" },
        "max-bytes": { type: "string" },
        "max-time-ms": { type: "string" },
        every: { type: "string" },
        once: { type: "boolean" },
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
/** P2-028 (ADR-31): `ir proxy` dispatch — set takes verb + route, clear/show take the verb alone. */
function proxyCommandFor(
  dir: string,
  rest: readonly string[],
  v: Values & ProxyValues,
  out: (s: string) => void,
  err: (s: string) => void,
): (() => number) | undefined {
  const verb = rest[0];
  if (verb !== "set" && verb !== "clear" && verb !== "show") return undefined;
  if (rest.length > (verb === "set" ? 2 : 1)) return undefined;
  return () => runProxyCommand(dir, verb, rest[1], v, out, err);
}

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
  // P2-028 (ADR-31): `ir proxy` — the case's proxy configuration on its audit chain.
  if (cmd === "proxy") return proxyCommandFor(dir, rest, v, out, err);
  // P4-009 (UC-10): `ir monitor` — scheduled re-runs of a transform over one identifier, compared and alerted.
  if (cmd === "monitor") return monitorCommandFor(dir, rest, v, out, err, opts);
  // P4-008: `ir diff` — two snapshots of one case, compared by legal keys (UC-09).
  if (cmd === "diff") return diffCommandFor(dir, rest, v, out, err);
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
  /** P4-009: `ir monitor add` — the check interval, a positive integer number of minutes. */
  every?: string | undefined;
  /** P4-009: `ir monitor run --once` — run every due check once, then exit. */
  once?: boolean | undefined;
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

/**
 * P4-008 (UC-09/T-TIME-006..010): `ir diff <case-dir> --from <seq> --to <seq>` — compares
 * the projections of one case at two seqs by legal keys and prints the added/removed/changed
 * counts (and, in --json, the full lists). Read-only: like `ir project`, it never writes.
 */
function diffCommandFor(
  dir: string,
  rest: readonly string[],
  v: { from?: string | undefined; to?: string | undefined; json?: boolean | undefined; "passphrase-file"?: string | undefined },
  out: (s: string) => void,
  err: (s: string) => void,
): (() => number | Promise<number>) | undefined {
  if (rest.length > 0) return undefined; // no positionals beyond the case dir
  const from = v.from === undefined ? undefined : Number(v.from);
  const to = v.to === undefined ? undefined : Number(v.to);
  if (from === undefined || to === undefined || !Number.isInteger(from) || !Number.isInteger(to)) {
    err(`ir diff: --from and --to must be integer seqs\n${USAGE}`);
    return () => 2;
  }
  return () => {
    try {
      const { passphrase } = passphraseFrom(v["passphrase-file"]);
      const c =
        passphrase === undefined
          ? openCase(dir, { actor: "ir-cli", readOnly: true })
          : openCase(dir, { actor: "ir-cli", readOnly: true, passphrase });
      try {
        const entries = c.entries();
        if (from > to) {
          err(`ir diff: --from ${from} is after --to ${to}\n${USAGE}`);
          return 2;
        }
        const a = project(entries, { upTo: from });
        const b = project(entries, { upTo: to });
        const d = diffProjections(a, b);
        out(v.json ? JSON.stringify(d, null, 2) : diffSummary(d));
        return 0;
      } finally {
        c.close();
      }
    } catch (x) {
      err(`ir diff: ${(x as Error).message}`);
      return 2;
    }
  };
}

/** The human-readable diff: counts first, then the keys that moved (first few each). */
/** The human-readable diff: counts per side, then the first few keys that moved. */
function diffSummary(d: ReturnType<typeof diffProjections>): string {
  const keys = (xs: readonly { canonicalKey?: string; claimId?: string }[]) =>
    xs.length === 0
      ? ""
      : ` (${xs
          .slice(0, 5)
          .map((x) => x.canonicalKey ?? x.claimId)
          .join(", ")}${xs.length > 5 ? " …" : ""})`;
  const changeKeys = (xs: readonly { key?: string; id?: string }[]) =>
    xs.length === 0
      ? ""
      : ` (${xs
          .slice(0, 5)
          .map((x) => x.key ?? x.id)
          .join(", ")}${xs.length > 5 ? " …" : ""})`;
  const line = (label: string, added: number, removed: number, changed: number, plus: string, minus: string, tilde: string) =>
    `  ${label} +${added} -${removed} ~${changed}${plus}${minus}${tilde}`;
  return [
    `diff seq ${d.fromSeq} -> ${d.toSeq}`,
    line(
      "entities",
      d.counts.entities.added,
      d.counts.entities.removed,
      d.counts.entities.changed,
      keys(d.entities.added),
      keys(d.entities.removed),
      changeKeys(d.entities.changed),
    ),
    line(
      "claims",
      d.counts.claims.added,
      d.counts.claims.removed,
      d.counts.claims.changed,
      keys(d.claims.added),
      keys(d.claims.removed),
      changeKeys(d.claims.changed),
    ),
  ].join("\n");
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

/** P2-028 (ADR-31): the `ir proxy` command's flags (set/clear/show). */
type ProxyValues = {
  "via-tor"?: boolean | undefined;
  host?: string | undefined;
  port?: string | undefined;
  secret?: string | undefined;
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
  v: RunValues & ProxyValues,
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
  // P2-028 (ADR-31): the case's routing (the proxy.set chain + --via-tor) — a refusal fails the run
  // BEFORE the gateway opens (fail-closed: no request passes, nothing falls back to direct).
  const deps = opts.network ?? {};
  const routing = proxyRoutingFor(c, deps, v["via-tor"] === true);
  if ("error" in routing) return routing;
  const plan = planNetworkRun(c, entry, subjectType, v["allow-host"] ?? [], deps, routing.routing);
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

/** The validated run prelude: the registered transform and its catalog-valid subject input. */
function runTransformPrelude(
  transformId: string,
  subjectType: string,
  subjectValue: string,
): { entry: RegisteredTransform; input: Record<string, unknown>; key: string } | { error: string } {
  // P2-037: only registered transforms run, and the subject is checked against the transform's
  // declared subjects and the catalog format before any case is opened or any request is made.
  const entry = registered(transformId);
  if (!entry) return { error: `unknown transform "${transformId}"` };
  if (!specById(subjectType)) return { error: `subject type "${subjectType}" is not a catalog identifier type` };
  const prepared = subjectInput(entry, subjectType, subjectValue);
  if ("error" in prepared) return { error: prepared.error };
  return { entry, input: prepared.input, key: prepared.key };
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
    const prelude = runTransformPrelude(transformId, subjectType, subjectValue);
    if ("error" in prelude) {
      err(`ir run: ${prelude.error}`);
      return 2;
    }
    const transform = prelude.entry.transform;
    const input = prelude.input;
    const subjectKey = prelude.key;
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
      const route = runRoute(c, prelude.entry, subjectType, v, opts);
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
          err(`ir run: ${x.message}${hostRefusalHint(prelude.entry, route.events)}`);
          return 1;
        }
        throw x;
      }
      // P2-036: every finding is bound to the evidence of the request(s) it cites (TransformFinding.evidence).
      const recorded = recordRunSuccess(c, subjectId, transform, input, result, clock, route.origin);
      // P3-020 / UC-06: TR-012's documented post-step — the WARC container of every archived
      // response is serialized and stored as case evidence beside the raw response. The
      // transform itself never writes files (SDK contract); this is the local post-processing
      // its header prescribes, on both the simulation and the network route.
      if (transform.manifest.id === "TR-012") storeWarcForRun(c, recorded.requests, route.origin);
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

type InvestigateValues = RunValues &
  ProxyValues & {
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
      // P4-002: the documented Admiralty grade (D2/5.13) — reliability of the source,
      // the default credibility of its findings, and the written rationale.
      admiralty: e.transform.manifest.admiralty,
    };
  });
  if (json) {
    out(JSON.stringify(rows, null, 2));
    return;
  }
  const lines = ["ir source: registered sources for this case:"];
  for (const r of rows)
    lines.push(
      `  ${r.transformId}: ${r.state} — r=${r.admiralty.reliability} k=${r.admiralty.credibility}${r.state === "disabled" && r.reason ? ` — ${r.reason}` : ""}`,
    );
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

/** Validates `ir proxy set`'s route + flags; the credentials NEVER appear, only the vault entry NAME. */
function proxySetArgs(
  route: string | undefined,
  v: Values & ProxyValues,
): { route: string; host: string; port: number; secretName: string } | string {
  if (route !== "proxy-http-connect" && route !== "proxy-socks5" && route !== "tor") {
    return `unknown route "${route}" (proxy-http-connect | proxy-socks5 | tor)`;
  }
  const host = v.host?.trim() ?? "";
  const port = Number(v.port ?? "");
  const secretName = v.secret?.trim() ?? "";
  if (host === "" || /[\\/:]/.test(host)) return "--host is required (a hostname or IP, no scheme/port/path)";
  if (!Number.isInteger(port) || port < 1 || port > 65535) return "--port is required (1-65535)";
  if (secretName === "") return "--secret is required (the vault credential_pair entry holding the proxy username + password)";
  return { route, host, port, secretName };
}

/** P2-028 (ADR-31): `ir proxy` — the case's proxy configuration, recorded on its own audit chain. */
function runProxyCommand(
  dir: string,
  verb: "set" | "clear" | "show",
  route: string | undefined,
  v: Values & ProxyValues,
  out: (s: string) => void,
  err: (s: string) => void,
): number {
  const fail = (msg: string) => (err(`ir proxy: ${msg}`), 2);
  try {
    const { passphrase } = passphraseFrom(v["passphrase-file"]);
    const c = passphrase === undefined ? openCase(dir, { actor: "ir-cli" }) : openCase(dir, { actor: "ir-cli", passphrase });
    try {
      if (verb === "show") {
        const config = caseProxyConfig(c);
        out(
          config === undefined
            ? JSON.stringify({ route: "direct" }, null, v.json === true ? 2 : 0)
            : JSON.stringify(config, null, v.json === true ? 2 : 0),
        );
        return 0;
      }
      if (verb === "clear") {
        c.audit("proxy.clear", "proxy", {});
        out("ir proxy: cleared — the case's requests are direct");
        return 0;
      }
      // set: validate the route and the flags — the credentials NEVER appear, only the vault entry NAME.
      const args = proxySetArgs(route, v);
      if (typeof args === "string") return fail(args);
      c.audit("proxy.set", args.route, args);
      out(`ir proxy: ${args.route} via ${args.host}:${args.port} (credentials from vault entry "${args.secretName}")`);
      return 0;
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

// =================================================================================================
// P4-009 — `ir monitor`: scheduled monitoring and alerts (UC-10). The monitor's configuration and every
// check live on the case's audit chain (the `proxy.set` pattern): what was scheduled, when each check
// ran, what it changed and whether it alerted are covered by verification and checkpoints like every
// other audit event. A check re-runs the transform through the REAL engine path (`runTransformPrelude` /
// `runRoute` / `runTransform` / `recordRunSuccess` — the same code `ir run` uses) and compares the run's
// normalized findings (`monitor-compare.ts`) against the LAST SUCCESSFUL check's state:
//   - the first success establishes the baseline WITHOUT alerting;
//   - a failed check is logged with its error, alerts nothing, and leaves the baseline intact;
//   - A → A → B → B → A alerts exactly twice (the transition to B, then the return to A) — dedupe is
//     "same state as the last successful check", never an eternal list of sent fingerprints;
//   - the alert decision and its content are committed INSIDE the single `monitor.check.result` event
//     together with the new baseline (one write: a check interrupted after the run is visible as
//     started-without-result, never as a half-alerted check).
// The scheduler is a foreground loop (`--once` runs the due checks and exits); a missed deadline runs
// exactly ONE catch-up check, never a flood. It does not survive the process: a system timer (cron,
// systemd) or an operator re-invokes `ir monitor run`.
// =================================================================================================

/** One scheduled monitor, as recorded on the case's audit chain. */
interface CaseMonitor {
  readonly id: string;
  readonly transformId: string;
  readonly subjectType: string;
  readonly subjectValue: string;
  readonly subjectKey: string;
  readonly intervalMinutes: number;
  /** set by `monitor.removed`: the monitor's checks stay in the log, but it is no longer scheduled. */
  removed?: boolean;
}

/**
 * One check ATTEMPT on the chain: a committed result (success/failed) OR a started-without-result
 * attempt ("incomplete" — the process died mid-check; visible forever, never silently lost, and its
 * id is never reused). The baseline keeper reads only the successful results.
 */
interface MonitorCheck {
  readonly checkId: string;
  readonly monitorId: string;
  readonly status: "success" | "failed" | "incomplete";
  readonly at: string;
  /** the chain head when the attempt started: the check's work is the range fromSeq+1..result. */
  readonly fromSeq?: number;
  readonly findingsCount?: number;
  readonly changed?: boolean;
  /** the new baseline (the normalized findings of this successful run) — present on success. */
  readonly state?: MonitorFinding[];
  readonly alert?: { added: string[]; removed: string[]; changed: string[] };
  readonly error?: string;
}

/** How long a started-without-result attempt blocks a new one: beyond it the attempt is stale (the process died) and a new attempt may claim. Longer than the default run budget (2 min); an operator budget beyond it could overlap two attempts — documented in L-55. */
const IN_FLIGHT_MS = 10 * 60_000;

/** The monitor id is derived deterministically from the NORMALIZED input (transform + type + canonicalKey): re-adding the same identifier — in any equivalent spelling — is the same monitor, not a duplicate. */
function monitorIdFor(transformId: string, subjectType: string, subjectKey: string): string {
  return `m-${createHash("sha256").update(`${transformId.toLowerCase()}|${subjectType}|${subjectKey}`).digest("hex").slice(0, 12)}`;
}

/** The case's monitors from its audit chain, latest-wins per id (the same rule as the proxy configuration). */
function caseMonitors(c: Case): Map<string, CaseMonitor> {
  const monitors = new Map<string, CaseMonitor>();
  for (const ev of c.auditTrail()) {
    const d = (ev.detail ?? {}) as Record<string, unknown>;
    if (ev.action === "monitor.scheduled") {
      const id = d["monitorId"];
      const transformId = d["transformId"];
      const subjectType = d["subjectType"];
      const subjectValue = d["subjectValue"];
      const subjectKey = d["subjectKey"];
      const intervalMinutes = d["intervalMinutes"];
      if (
        typeof id === "string" &&
        typeof transformId === "string" &&
        typeof subjectType === "string" &&
        typeof subjectValue === "string" &&
        typeof subjectKey === "string" &&
        typeof intervalMinutes === "number" &&
        Number.isInteger(intervalMinutes) &&
        intervalMinutes > 0
      ) {
        monitors.set(id, { id, transformId, subjectType, subjectValue, subjectKey, intervalMinutes });
      }
    } else if (ev.action === "monitor.removed" && typeof d["monitorId"] === "string") {
      const m = monitors.get(d["monitorId"]);
      if (m) monitors.set(m.id, { ...m, removed: true });
    }
  }
  return monitors;
}

/** Every check attempt on the chain, oldest first: committed results paired with their started events, and started-without-result attempts listed as incomplete. */
function monitorChecks(c: Case): MonitorCheck[] {
  const checks: MonitorCheck[] = [];
  for (const ev of c.auditTrail()) {
    if (ev.action === "monitor.check.started") {
      const d = (ev.detail ?? {}) as Record<string, unknown>;
      if (typeof d["monitorId"] === "string" && typeof ev.at === "string") {
        checks.push({ checkId: ev.target, monitorId: d["monitorId"], status: "incomplete", at: ev.at });
      }
      continue;
    }
    if (ev.action !== "monitor.check.result") continue;
    const parsed = parseCheckResult(ev);
    if (!parsed) continue;
    // the result replaces its own started entry (an attempt that completed); a result without a
    // started entry (a legacy chain) is kept as-is.
    const idx = checks.findIndex((k) => k.checkId === parsed.checkId && k.status === "incomplete");
    if (idx >= 0) checks[idx] = parsed;
    else checks.push(parsed);
  }
  return checks;
}

/** Validates one result event's detail into a MonitorCheck — fail-closed on the required fields, per-field (the chain being tamper-evident does not prove payload types). */
function parseCheckResult(ev: { target: string; at: string; detail?: Record<string, unknown> }): MonitorCheck | undefined {
  const d = ev.detail ?? {};
  const monitorId = d["monitorId"];
  const status = d["status"];
  if (typeof monitorId !== "string" || (status !== "success" && status !== "failed") || typeof ev.at !== "string") return undefined;
  const check: MonitorCheck = {
    checkId: ev.target,
    monitorId,
    status,
    at: ev.at,
    ...(typeof d["fromSeq"] === "number" ? { fromSeq: d["fromSeq"] as number } : {}),
    ...(typeof d["findingsCount"] === "number" ? { findingsCount: d["findingsCount"] as number } : {}),
    ...(d["changed"] === true ? { changed: true } : {}),
    ...(Array.isArray(d["state"]) ? { state: d["state"] as MonitorFinding[] } : {}),
    ...(d["alert"] !== null && typeof d["alert"] === "object" && Array.isArray((d["alert"] as Record<string, unknown>)["added"])
      ? { alert: d["alert"] as MonitorCheck["alert"] }
      : {}),
    ...(typeof d["error"] === "string" ? { error: d["error"] as string } : {}),
  };
  return check;
}

/** The monitor's committed results, oldest first. */
function checksOfMonitor(checks: readonly MonitorCheck[], monitorId: string): MonitorCheck[] {
  return checks.filter((k) => k.monitorId === monitorId);
}

/** `ir monitor <dir> add|list|check|remove|run` — the verb dispatch (the `ir proxy` pattern). */
function monitorCommandFor(
  dir: string,
  rest: string[],
  v: Values & RunValues,
  out: (s: string) => void,
  err: (s: string) => void,
  opts: CliOptions,
): (() => number | Promise<number>) | undefined {
  const verb = rest[0];
  if (verb === "list" && rest.length === 1) return () => runMonitorList(dir, v, out, err);
  if (verb === "add" && rest.length === 4) return () => runMonitorAdd(dir, rest[1], rest[2], rest[3], v, out, err, opts);
  if (verb === "check" && rest.length === 2) return () => runMonitorCheckCommand(dir, rest[1], v, out, err, opts);
  if (verb === "remove" && rest.length === 2) return () => runMonitorRemove(dir, rest[1], v, out, err);
  if (verb === "run" && rest.length === 1) return () => runMonitorScheduler(dir, v, out, err, opts);
  return () => (err("ir monitor: usage: ir monitor <case-dir> <add|list|check|remove|run> ... (see ir --help)"), 2);
}

/** `ir monitor add <transform-id> <subject-type> <subject-value> --every <minutes>`: schedules (or updates) one monitor. */
async function runMonitorAdd(
  dir: string,
  transformId: string,
  subjectType: string,
  subjectValue: string,
  v: Values & RunValues,
  out: (s: string) => void,
  err: (s: string) => void,
  opts: CliOptions,
): Promise<number> {
  const fail = (msg: string) => (err(`ir monitor: ${msg}`), 2);
  const every = v.every;
  if (every === undefined) return fail("--every <minutes> is required: the check interval, a positive integer number of minutes");
  if (!/^[1-9][0-9]*$/.test(every)) return fail("--every must be a positive integer number of minutes");
  // the same gate as `ir run`: unknown transforms and invalid subjects are refused before any case work.
  const prelude = runTransformPrelude(transformId, subjectType, subjectValue);
  if ("error" in prelude) return fail(prelude.error);
  const id = monitorIdFor(transformId, subjectType, prelude.key);
  const clock = opts.clock ?? systemClock;
  const c = openRunCase(dir, v, clock);
  if (typeof c === "string") return fail(c);
  try {
    // an encrypted case can never run this monitor's checks (P2-022: sealed payloads add no value to a run),
    // so scheduling one on it would be a configuration that can never fire — refused.
    if (c.encrypted) {
      return fail(
        "refusing to schedule a monitor on an encrypted case: its checks run transforms, and sealed payloads add no value (P2-022)",
      );
    }
    const existing = caseMonitors(c).get(id);
    if (existing && !existing.removed && existing.intervalMinutes === Number(every)) {
      out(`ir monitor: ${id} already scheduled (${transformId} ${prelude.key}, every ${every}m)`);
      return 0;
    }
    c.audit("monitor.scheduled", id, {
      monitorId: id,
      transformId,
      subjectType,
      subjectValue,
      subjectKey: prelude.key,
      intervalMinutes: Number(every),
    });
    const action = existing && !existing.removed ? "updated" : "scheduled";
    out(`ir monitor: ${action} ${id} ${transformId} ${prelude.key} every ${every}m`);
    return 0;
  } finally {
    c.close();
  }
}

/** `ir monitor list`: the case's monitors with their check and alert history. */
function runMonitorList(dir: string, v: Values & RunValues, out: (s: string) => void, err: (s: string) => void): number {
  const fail = (msg: string) => (err(`ir monitor: ${msg}`), 2);
  const clock = systemClock;
  const { passphrase } = passphraseFrom(v["passphrase-file"]);
  let c: Case;
  try {
    c = passphrase === undefined ? openCase(dir, { actor: "ir-cli", clock }) : openCase(dir, { actor: "ir-cli", clock, passphrase });
  } catch (x) {
    return fail((x as Error).message);
  }
  try {
    const checks = monitorChecks(c);
    const monitors = [...caseMonitors(c).values()];
    if (v.json === true) {
      out(
        JSON.stringify(
          {
            monitors: monitors.map((m) => {
              const own = checksOfMonitor(checks, m.id);
              return {
                id: m.id,
                transformId: m.transformId,
                subjectType: m.subjectType,
                subjectValue: m.subjectValue,
                intervalMinutes: m.intervalMinutes,
                ...(m.removed ? { removed: true } : {}),
                checks: own.map(({ checkId, status, at, changed, alert, error }) => ({
                  checkId,
                  status,
                  at,
                  ...(changed === true ? { changed: true } : { changed: false }),
                  ...(alert ? { alert } : {}),
                  ...(error ? { error } : {}),
                })),
                alertCount: own.filter((k) => k.alert !== undefined).length,
              };
            }),
          },
          null,
          2,
        ),
      );
      return 0;
    }
    if (monitors.length === 0) out("ir monitor: no monitors scheduled on this case");
    for (const m of monitors) {
      const own = checksOfMonitor(checks, m.id);
      out(
        `${m.id}  ${m.transformId}  ${m.subjectKey}  every ${m.intervalMinutes}m${m.removed ? "  removed" : ""}  checks ${own.length}  alerts ${own.filter((k) => k.alert !== undefined).length}`,
      );
    }
    return 0;
  } catch (x) {
    // an encrypted case without its passphrase cannot read its audit chain: refused cleanly, not a crash.
    return fail(x instanceof Error ? x.message : String(x));
  } finally {
    c.close();
  }
}

/** `ir monitor remove <id>`: unschedules a monitor (its check history stays on the chain). */
function runMonitorRemove(
  dir: string,
  monitorId: string,
  v: Values & RunValues,
  out: (s: string) => void,
  err: (s: string) => void,
): number {
  const fail = (msg: string) => (err(`ir monitor: ${msg}`), 2);
  const { passphrase } = passphraseFrom(v["passphrase-file"]);
  let c: Case;
  try {
    c = passphrase === undefined ? openCase(dir, { actor: "ir-cli" }) : openCase(dir, { actor: "ir-cli", passphrase });
  } catch (x) {
    return fail((x as Error).message);
  }
  try {
    const monitor = caseMonitors(c).get(monitorId);
    if (!monitor || monitor.removed) return fail(`no monitor ${monitorId} scheduled on this case`);
    c.audit("monitor.removed", monitorId, { monitorId });
    out(`ir monitor: removed ${monitorId} (${monitor.transformId} ${monitor.subjectKey})`);
    return 0;
  } catch (x) {
    // an encrypted case without its passphrase cannot read its audit chain: refused cleanly, not a crash.
    return fail(x instanceof Error ? x.message : String(x));
  } finally {
    c.close();
  }
}

/** The seq of the last entry (the check's chain range starts at its started event). */
function headSeq(c: Case): number {
  const last = c.entries().at(-1);
  return last === undefined ? -1 : last.seq;
}

/** Commits a SUCCESSFUL check: compares the run's normalized findings against the last successful state and writes the ONE result event (the alert decision and the new baseline together). */
function commitMonitorSuccess(
  c: Case,
  monitor: CaseMonitor,
  checkId: string,
  fromSeq: number,
  result: RunTransformResult,
  clock: Clock,
  out: (s: string) => void,
): void {
  // the comparison state is THIS RUN's findings, normalized — never the whole case projection.
  const state = monitorFindingState(result.output.findings);
  const baseline = lastSuccessfulCheck(c, monitor.id)?.state;
  const d = baseline === undefined ? undefined : compareFindingStates(baseline, state);
  const changed = d !== undefined && !d.equal;
  // ONE write commits the result, the alert decision and the new baseline together.
  c.audit("monitor.check.result", checkId, {
    monitorId: monitor.id,
    status: "success",
    at: isoNow(clock),
    fromSeq,
    findingsCount: result.output.findings.length,
    changed,
    ...(baseline === undefined ? { first: true } : {}),
    ...(d !== undefined && !d.equal ? { alert: d } : {}),
    state,
  });
  const head = `ir monitor: check ${checkId} ${monitor.transformId} ${monitor.subjectKey} findings ${result.output.findings.length}`;
  if (baseline === undefined) {
    out(`${head} — baseline established (no alert on the first success)`);
  } else if (!changed) {
    out(`${head} — no change`);
  } else if (d !== undefined) {
    out(`${head} — CHANGED (+${d.added.length} -${d.removed.length} ~${d.changed.length})`);
    out(`ALERT ${checkId}: added [${d.added.join(", ")}], removed [${d.removed.join(", ")}], changed [${d.changed.join(", ")}]`);
  }
}

/** A resolved run route (the non-error half of what `runRoute` returns). */
type MonitorRoute = {
  transport: HttpTransport;
  origin: "network" | "sim";
  isolatedModule?: string;
  allowedHosts?: readonly string[];
  events?: readonly EgressAuditEvent[];
};

/** Commits a FAILED check: the error observation, the result event with its error — logged, no alert, baseline intact. */
function commitMonitorFailure(
  c: Case,
  monitor: CaseMonitor,
  checkId: string,
  fromSeq: number,
  subjectId: string,
  entry: RegisteredTransform,
  input: Record<string, unknown>,
  x: TransformRunError,
  clock: Clock,
  route: MonitorRoute,
  err: (s: string) => void,
): void {
  recordRunFailure(c, subjectId, entry.transform, input, x, clock, route.origin);
  c.audit("monitor.check.result", checkId, {
    monitorId: monitor.id,
    status: "failed",
    at: isoNow(clock),
    fromSeq,
    error: x.message,
  });
  err(`ir monitor: check ${checkId} failed: ${x.message}${hostRefusalHint(entry, route.events)}`);
}

/** Commits an attempt that failed BEFORE the transform ran (route setup: a broken --sim file, a refused route): the attempt is logged with its error — no run happened, so no error observation, and the baseline stays. */
function commitAttemptFailure(
  c: Case,
  monitor: CaseMonitor,
  checkId: string,
  fromSeq: number,
  x: unknown,
  clock: Clock,
  err: (s: string) => void,
): void {
  const message = x instanceof Error ? x.message : String(x);
  c.audit("monitor.check.result", checkId, {
    monitorId: monitor.id,
    status: "failed",
    at: isoNow(clock),
    fromSeq,
    error: message,
  });
  err(`ir monitor: check ${checkId} failed: ${message}`);
}

/** The scheduled monitors that are due at `now`, plus the next due time (for the scheduler's sleep). */
function dueMonitors(c: Case, now: number): { due: CaseMonitor[]; notDue: number; nextDueMs: number } {
  const due: CaseMonitor[] = [];
  let notDue = 0;
  let nextDueMs = Infinity;
  const checks = monitorChecks(c);
  for (const m of [...caseMonitors(c).values()].filter((m) => !m.removed)) {
    // DUE is computed from the last ATTEMPT (success or failure — a failed attempt must not make
    // the monitor retry on every poll), never from the last success (that is the comparison
    // baseline's job). A missed deadline is repaid with exactly one catch-up check — never a flood.
    const own = checksOfMonitor(checks, m.id);
    const inFlight = own.filter((k) => k.status === "incomplete").at(-1);
    if (inFlight !== undefined && now - Date.parse(inFlight.at) < IN_FLIGHT_MS) {
      notDue++; // a check is in flight: the scheduler does not pile a second attempt on it
      continue;
    }
    const last = own.at(-1)?.at;
    const dueAt = last === undefined ? now : Date.parse(last) + m.intervalMinutes * 60_000;
    if (dueAt <= now) due.push(m);
    else {
      notDue++;
      nextDueMs = Math.min(nextDueMs, dueAt);
    }
  }
  return { due, notDue, nextDueMs };
}

/**
 * Atomically CLAIMS the next check attempt of one monitor (P4-009 round 3): the in-flight guard
 * refuses a monitor whose check is already running (a fresh started-without-result attempt — the
 * process died mid-check within IN_FLIGHT_MS), then the started event is appended ONLY if the
 * chain head is still what we validated (the store's auditIfSeq — the audit twin of appendIfSeq,
 * chain entry and index row in one transaction). A second handle on the same case therefore
 * gets a clean null instead of a second claim: one alert per change, never two. The attempt id
 * counts EVERY attempt (committed or interrupted), so an interrupted attempt's id is never reused.
 */
function claimCheck(c: Case, monitor: CaseMonitor, clock: Clock): { checkId: string; fromSeq: number } | { error: string } {
  const now = clock.now();
  const own = checksOfMonitor(monitorChecks(c), monitor.id);
  const inFlight = own.filter((k) => k.status === "incomplete").at(-1);
  if (inFlight !== undefined && now - Date.parse(inFlight.at) < IN_FLIGHT_MS) {
    return { error: `check ${inFlight.checkId} of this monitor is already running (started at ${inFlight.at})` };
  }
  const checkId = `${monitor.id}#${own.length + 1}`;
  const fromSeq = headSeq(c);
  const started = c.auditIfSeq(
    "monitor.check.started",
    checkId,
    { monitorId: monitor.id, transformId: monitor.transformId, at: isoNow(clock) },
    fromSeq,
  );
  if (started === null) {
    return { error: "the case changed while this check was starting (a concurrent check won the claim) — retry" };
  }
  return { checkId, fromSeq };
}

/** Runs ONE check of one monitor on an OPEN case: claims the attempt atomically, re-runs the transform, records the run, compares, commits the result. */
async function runMonitorCheckOnCase(
  c: Case,
  monitor: CaseMonitor,
  v: Values & RunValues,
  out: (s: string) => void,
  err: (s: string) => void,
  opts: CliOptions,
): Promise<number> {
  // usage errors that do NOT start a check (unknown transform, invalid subject) are refused
  // before anything is written — an attempt is not an attempt until its start is claimed.
  const prelude = runTransformPrelude(monitor.transformId, monitor.subjectType, monitor.subjectValue);
  if ("error" in prelude) {
    err(`ir monitor: ${prelude.error}`);
    return 2;
  }
  const clock = opts.clock ?? systemClock;
  const claim = claimCheck(c, monitor, clock);
  if ("error" in claim) {
    err(`ir monitor: ${claim.error}`);
    return 2;
  }
  const { checkId, fromSeq } = claim;
  // from here on the attempt is on the chain: every failure is a LOGGED attempt failure (exit 1),
  // never a silent exit — the baseline stays and the next attempt is due on schedule.
  let route: ReturnType<typeof runRoute> | undefined;
  try {
    route = runRoute(c, prelude.entry, monitor.subjectType, v, opts);
    if ("error" in route) {
      commitAttemptFailure(c, monitor, checkId, fromSeq, new Error(route.error), clock, err);
      return 1;
    }
    const transform = prelude.entry.transform;
    const subjectId = ensureSubject(c, monitor.subjectKey, monitor.subjectType, clock);
    const result = await runTransform(transform, {
      transport: route.transport,
      input: prelude.input,
      now: opts.now,
      sleep: opts.sleep,
      ...(opts.signal ? { signal: opts.signal } : {}),
      fetchedAt: () => isoNow(clock),
      ...(route.isolatedModule ? { requireIsolation: true, isolatedModule: route.isolatedModule, transformId: transform.manifest.id } : {}),
    });
    // the run is recorded on the case exactly like `ir run` records it (evidence, claims, observations).
    const recorded = recordRunSuccess(c, subjectId, transform, prelude.input, result, clock, route.origin);
    if (transform.manifest.id === "TR-012") storeWarcForRun(c, recorded.requests, route.origin);
    commitMonitorSuccess(c, monitor, checkId, fromSeq, result, clock, out);
    return 0;
  } catch (x) {
    const live = route !== undefined && !("error" in route) ? route : undefined;
    if (x instanceof TransformRunError && live !== undefined) {
      commitMonitorFailure(
        c,
        monitor,
        checkId,
        fromSeq,
        ensureSubject(c, monitor.subjectKey, monitor.subjectType, clock),
        prelude.entry,
        prelude.input,
        x,
        clock,
        live,
        err,
      );
      return 1;
    }
    // route setup threw (a broken --sim file), or the run failed before its route existed:
    // a logged attempt failure, not a crash
    commitAttemptFailure(c, monitor, checkId, fromSeq, x, clock, err);
    return 1;
  }
}

/** `ir monitor check <id>`: runs one check of one scheduled monitor now. */
async function runMonitorCheckCommand(
  dir: string,
  monitorId: string,
  v: Values & RunValues,
  out: (s: string) => void,
  err: (s: string) => void,
  opts: CliOptions,
): Promise<number> {
  const fail = (msg: string) => (err(`ir monitor: ${msg}`), 2);
  const clock = opts.clock ?? systemClock;
  const c = openRunCase(dir, v, clock);
  if (typeof c === "string") return fail(c);
  try {
    if (c.encrypted) return fail("refusing to run a transform against an encrypted case (P2-022)");
    const monitor = caseMonitors(c).get(monitorId);
    if (!monitor || monitor.removed) return fail(`no monitor ${monitorId} scheduled on this case`);
    return await runMonitorCheckOnCase(c, monitor, v, out, err, opts);
  } finally {
    c.close();
  }
}

/** `ir monitor run [--once]`: the foreground scheduler — runs the DUE checks, then exits (--once) or sleeps until the next due time. */
async function runMonitorScheduler(
  dir: string,
  v: Values & RunValues,
  out: (s: string) => void,
  err: (s: string) => void,
  opts: CliOptions,
): Promise<number> {
  const fail = (msg: string) => (err(`ir monitor: ${msg}`), 2);
  const clock = opts.clock ?? systemClock;
  const c = openRunCase(dir, v, clock);
  if (typeof c === "string") return fail(c);
  try {
    if (c.encrypted) return fail("refusing to run a transform against an encrypted case (P2-022)");
    const once = v.once === true;
    let exitCode = 0;
    for (;;) {
      if (opts.signal?.aborted) break;
      const { due, notDue, nextDueMs } = dueMonitors(c, clock.now());
      for (const m of due) {
        const code = await runMonitorCheckOnCase(c, m, v, out, err, opts);
        if (code !== 0) exitCode = Math.max(exitCode, code);
      }
      if (once) {
        out(`ir monitor: ${due.length} due check${due.length === 1 ? "" : "s"}, ${notDue} not due`);
        return exitCode;
      }
      if (opts.signal?.aborted) break;
      await schedulerWait(opts, clock, nextDueMs);
    }
    return exitCode;
  } finally {
    c.close();
  }
}

/** Sleeps until the next due time, capped at the 60 s poll; the injected sleep and signal make the loop testable and cleanly stoppable. */
async function schedulerWait(opts: CliOptions, clock: Clock, nextDueMs: number): Promise<void> {
  const wait = Math.min(nextDueMs - clock.now(), 60_000);
  if (!Number.isFinite(wait) || wait <= 0) return;
  await (opts.sleep ?? monitorSleep)(Math.max(wait, 0), opts.signal ?? new AbortController().signal);
}

/** The default scheduler sleep: resolves on timeout or abort, and ALWAYS cleans up its timer and its abort listener (a long-running scheduler must not leak one listener per wait). Exported for its direct tests (P4-009 round 3). */
export function monitorSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve(); // an already-aborted signal: no pointless full wait
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(t);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const t = setTimeout(done, ms);
    signal.addEventListener("abort", done);
  });
}

/** The last SUCCESSFUL check of a monitor (the baseline keeper) — a failed check never becomes the baseline. */
function lastSuccessfulCheck(c: Case, monitorId: string): MonitorCheck | undefined {
  return checksOfMonitor(monitorChecks(c), monitorId)
    .filter((k) => k.status === "success")
    .at(-1);
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
      // P2-028 (ADR-31): the case's routing (the proxy.set chain + --via-tor) — a refusal fails the
      // run BEFORE any work (fail-closed: no request passes, nothing falls back to direct).
      const routing = proxyRoutingFor(c, opts.network ?? {}, v["via-tor"] === true);
      if ("error" in routing) return fail(routing.error);
      const r = await investigate(
        c,
        { type: subjectType, value: subjectValue },
        {
          allowHosts: v["allow-host"] ?? [],
          budget,
          transforms: v.transform,
          exclude: v.exclude,
          network: opts.network,
          ...(routing.routing ? { routing: routing.routing } : {}),
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
