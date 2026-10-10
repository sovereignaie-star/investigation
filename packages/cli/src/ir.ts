import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { project, projectionHash, type Projection } from "@ir/ledger/projections";
import { formatReport, openCase, readCheckpointFile, verifyCase } from "@ir/store";

const USAGE = `usage: ir verify <case-dir> [--key installation.pub] [--checkpoint checkpoint.json] [--passphrase-file file] [--json]
       ir project <case-dir> [--at seq] [--expect sha256] [--passphrase-file file] [--json]

  verify:  recomputes the hash chain, re-hashes every evidence blob, and checks signed checkpoints.
  project: rebuilds the graph, table and coverage views from the chain, offline (optionally as of seq --at),
           and prints their counts and projection hash; --expect fails (exit 1) unless the hash matches.
  Encrypted cases: the passphrase is read from --passphrase-file or IR_CASE_PASSPHRASE, never from the command line.
  Exit codes: 0 intact, 1 integrity failure, 2 usage or I/O error.`;

/** `ir` command line (P1-012). Returns the exit code so tests can call it without spawning a process. */
const stdout = (s: string) => void process.stdout.write(`${s}\n`);
const stderr = (s: string) => void process.stderr.write(`${s}\n`);

function passphraseFrom(file: string | undefined): { passphrase?: string } {
  if (file) return { passphrase: readFileSync(file, "utf8").replace(/\r?\n$/, "") };
  const env = process.env["IR_CASE_PASSPHRASE"];
  return env ? { passphrase: env } : {};
}

export function main(argv: string[], out: (s: string) => void = stdout, err: (s: string) => void = stderr): number {
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
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (x) {
    err(`${(x as Error).message}\n${USAGE}`);
    return 2;
  }
  const [cmd, dir, ...rest] = parsed.positionals;
  if (!parsed.values.help && cmd === "project" && dir && rest.length === 0) return runProject(dir, parsed.values, out, err);
  if (parsed.values.help || cmd !== "verify" || !dir || rest.length > 0) {
    (parsed.values.help ? out : err)(USAGE);
    return parsed.values.help ? 0 : 2;
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

// Run only as the entry point (bin symlinks resolve to the real file), not when imported by tests.
const isEntry = process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
if (isEntry) process.exitCode = main(process.argv.slice(2));
