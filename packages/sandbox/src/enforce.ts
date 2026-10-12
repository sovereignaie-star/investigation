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
}

export interface SandboxResult {
  readonly ok: boolean;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly blockedByKernel: boolean;
  readonly timedOut: boolean;
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
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ...(opts.env ?? {}),
    LD_PRELOAD: socketBlockerPath,
  };

  return new Promise((resolve, reject) => {
    const child: ChildProcess = spawn("node", ["--input-type=module", "--eval", source], {
      cwd: opts.cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
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
    child.on("exit", (code, _signal) => {
      clearTimeout(timeout);
      resolve({
        ok: code === 0,
        exitCode: code,
        stdout,
        stderr,
        blockedByKernel: stderr.includes("[block-socket]") || /EACCES/i.test(stderr),
        timedOut,
      });
    });
  });
}
