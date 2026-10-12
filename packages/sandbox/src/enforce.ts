/**
 * Sandbox enforcement harness (T-SBX / P2-005).
 *
 * Spawns a transform in a child process with the LD_PRELOAD socket blocker.
 *
 * IMPORTANT — what this is and is NOT (do not weaken in review):
 *
 * - The LD_PRELOAD shim intercepts the LIBRARY `socket()` call. It is not a
 *   kernel-level enforcement: a direct syscall (e.g. via a native addon or
 *   `dlopen` of a different libc) or a child process spawned without
 *   `LD_PRELOAD` can still open a socket. The shim is a LAYER, not a wall.
 * - Fail-closed: when the shim is NOT supported (Windows, macOS, missing
 *   compiler), this harness REFUSES to spawn the child at all. There is no
 *   fallback "run without the blocker" path — that would be fail-open.
 * - The legitimate egress path is the PARENT process's gateway; the child
 *   communicates with it over a local IPC channel (stdin/stdout by default)
 *   and never opens a socket itself. This is the P2-005 design.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { buildSocketBlocker } from "./build.ts";

export interface SandboxOptions {
  /** Environment for the worker process. `LD_PRELOAD` is overridden. */
  readonly env?: Record<string, string>;
  /** Working directory for the worker. */
  readonly cwd?: string;
  /** Timeout in ms (default 30_000). */
  readonly timeoutMs?: number;
  /** Data to write to the child's stdin (the P2-005 IPC channel). */
  readonly stdinData?: string;
}

export interface SandboxResult {
  readonly ok: boolean;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly blockedByKernel: boolean;
  readonly timedOut: boolean;
  /** The child's stdin handle (open while the child runs). */
  readonly stdin?: ChildProcess["stdin"];
}

/**
 * Refusal returned when the platform has no enforcement primitive. Do NOT
 * treat this as a success — the caller must surface it.
 */
export interface SandboxRefusal {
  readonly refused: true;
  readonly reason: "platform_unsupported";
}

export type SandboxOutcome = SandboxResult | SandboxRefusal;

function isRefusal(x: SandboxOutcome): x is SandboxRefusal {
  return (x as SandboxRefusal).refused === true;
}
export { isRefusal };

/**
 * Fail-closed environment allowlist for the sandboxed child.
 *
 * The child must NOT inherit the parent's full `process.env` — that could leak
 * secrets (tokens, API keys) into a transform. Only the minimum needed for
 * node to run is passed, plus anything explicitly provided by `opts.env`.
 */
const ENV_ALLOWLIST = new Set(["PATH", "HOME", "LANG", "LC_ALL", "TERM", "TMPDIR", "USER"]);

function buildChildEnv(extra: Record<string, string> | undefined, ldPreload: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ENV_ALLOWLIST) {
    const v = process.env[key];
    if (v !== undefined) env[key] = v;
  }
  // Preserve node-specific env that's needed for module resolution.
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("NODE_") && !key.startsWith("NODE_OPTIONS")) env[key] = process.env[key] as string;
  }
  return { ...env, ...(extra ?? {}), LD_PRELOAD: ldPreload };
}

/**
 * Spawn a node child process running `source` in the socket-blocked sandbox.
 * The source is a top-level module evaluated with `--input-type=module`.
 *
 * Fail-closed: on an unsupported platform the child is NOT spawned.
 */
export async function runSandboxedTransform(source: string, opts: SandboxOptions = {}): Promise<SandboxOutcome> {
  const { socketBlockerPath, supported } = buildSocketBlocker();
  if (!supported || !socketBlockerPath) {
    return { refused: true, reason: "platform_unsupported" };
  }
  const env = buildChildEnv(opts.env, socketBlockerPath);

  return new Promise((resolve, reject) => {
    const child: ChildProcess = spawn("node", ["--input-type=module", "--eval", source], {
      cwd: opts.cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs ?? 30_000);
    child.stdout?.on("data", (b: Buffer) => (stdout += b.toString()));
    child.stderr?.on("data", (b: Buffer) => (stderr += b.toString()));
    child.on("error", (e) => {
      clearTimeout(timeout);
      reject(e);
    });
    // Use `close` (not `exit`) so that stdout/stderr are fully drained before
    // we resolve — otherwise `blockedByKernel` (computed from stderr) can be
    // stale/missing at exit time (race between exit and last stderr flush).
    child.on("close", (code, _signal) => {
      clearTimeout(timeout);
      resolve({
        ok: code === 0,
        exitCode: code,
        stdout,
        stderr,
        blockedByKernel: stderr.includes("[block-socket]") || /EACCES/i.test(stderr),
        timedOut,
        stdin: child.stdin ?? undefined,
      });
    });
    // Write stdin data if provided (the P2-005 IPC channel).
    if (opts.stdinData !== undefined && child.stdin) {
      child.stdin.write(opts.stdinData);
      child.stdin.end();
    } else if (child.stdin) {
      // No stdin data requested: close stdin so the child's reads get EOF.
      child.stdin.end();
    }
  });
}
