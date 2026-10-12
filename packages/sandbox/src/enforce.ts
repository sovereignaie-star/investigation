/**
 * Sandbox enforcement harness (T-SBX / P2-005).
 *
 * Spawns a transform in a child process with the LD_PRELOAD socket blocker.
 * The transform is trusted to *attempt* network access (which must fail);
 * the sandbox must NOT be bypassed by simply not trying.
 *
 * The `source` is a self-contained JavaScript module (no imports outside
 * built-ins) evaluated as the child's main module.
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
 * Spawn a node child process running `source` in the socket-blocked sandbox.
 * The source is a top-level module evaluated with `--input-type=module`.
 */
export async function runSandboxedTransform(source: string, opts: SandboxOptions = {}): Promise<SandboxResult> {
  const { socketBlockerPath, supported } = buildSocketBlocker();
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ...(opts.env ?? {}),
    ...(supported && socketBlockerPath ? { LD_PRELOAD: socketBlockerPath } : {}),
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
