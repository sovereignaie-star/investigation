import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { formatReport, readCheckpointFile, verifyCase } from "@ir/store";

const USAGE = `usage: ir verify <case-dir> [--key installation.pub] [--checkpoint checkpoint.json] [--passphrase-file file] [--json]

  Recomputes the hash chain, re-hashes every evidence blob, and checks signed checkpoints.
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
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (x) {
    err(`${(x as Error).message}\n${USAGE}`);
    return 2;
  }
  const [cmd, dir, ...rest] = parsed.positionals;
  if (parsed.values.help || cmd !== "verify" || !dir || rest.length > 0) {
    (parsed.values.help ? out : err)(USAGE);
    return parsed.values.help ? 0 : 2;
  }
  try {
    const report = verifyCase(dir, {
      ...(parsed.values.key ? { publicKeyPem: readFileSync(parsed.values.key, "utf8") } : {}),
      ...(parsed.values.checkpoint ? { checkpoint: readCheckpointFile(parsed.values.checkpoint) } : {}),
      ...passphraseFrom(parsed.values["passphrase-file"]),
    });
    out(parsed.values.json ? JSON.stringify(report, null, 2) : formatReport(report));
    return report.ok ? 0 : 1;
  } catch (x) {
    err(`ir verify: ${(x as Error).message}`);
    return 2;
  }
}

// Run only as the entry point (bin symlinks resolve to the real file), not when imported by tests.
const isEntry = process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
if (isEntry) process.exitCode = main(process.argv.slice(2));
