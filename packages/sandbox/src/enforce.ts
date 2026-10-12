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
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { buildSocketBlocker } from "./build.ts";

export interface SandboxOptions {
  /**
   * Isolation assurance level. DEFAULT `"kernel-required"` (fail-closed): the
   * child runs only inside an empty network namespace (`unshare --net`), a
   * kernel wall that grandchildren cannot drop. `"shim-only"` is an EXPLICIT,
   * LOWER-assurance opt-in (LD_PRELOAD layer only; a grandchild can escape it)
   * — never the default, and never to be used for untrusted transforms
   * connected to a real network.
   */
  isolation?: "kernel-required" | "shim-only";
  /** Environment for the worker process. `LD_PRELOAD` is overridden. */
  readonly env?: Record<string, string>;
  /** Working directory for the worker. */
  readonly cwd?: string;
  /** Timeout in ms (default 30_000). */
  readonly timeoutMs?: number;
  /** Data to write to the child's stdin (the P2-005 IPC channel). */
  readonly stdinData?: string;
  /**
   * Round-trip IPC handler. When provided, the child's stdout lines are
   * parsed as JSON objects; each is passed to this handler which can send a
   * JSON response back to the child's stdin. This is the P2-005 channel
   * that lets the parent (which owns the `@ir/egress` gateway) act on behalf
   * of the sandboxed transform.
   */
  readonly ipcHandler?: (message: Record<string, unknown>, stdin: NonNullable<ChildProcess["stdin"]> | undefined) => void;
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
  readonly reason: "platform_unsupported" | "kernel_isolation_unavailable";
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
 * Kernel-level isolation: `unshare --user --map-root-user --net` puts the child
 * in a NEW, EMPTY network namespace. Unlike the LD_PRELOAD shim (a LIBRARY
 * layer that a grandchild can drop), a network namespace is enforced BY THE
 * KERNEL for EVERY process inside it — a grandchild spawned with
 * `LD_PRELOAD=""` is STILL inside the empty namespace and cannot connect
 * (`ENETUNREACH`). stdio pipes are unaffected by the namespace switch.
 *
 * When `unshare` is available and the namespace probe succeeds, it is the
 * PRIMARY isolation mechanism. The LD_PRELOAD shim is kept as a DEFENSIVE
 * SECOND LAYER (belt and suspenders): if the kernel mechanism is somehow
 * unavailable, the shim still blocks the common library path. BOTH must be
 * present for the harness to spawn a child at all (fail-closed).
 */
function canUnshareNet(): boolean {
  const r = spawnSync("unshare", ["--user", "--map-root-user", "--net", "true"], {
    encoding: "utf8",
    timeout: 5000,
  });
  return r.status === 0;
}

/**
 * Verify the shim ACTUALLY blocks a socket BEFORE any transform source runs.
 *
 * This is a LIVE PROBE, not a build-success check. The parent starts a local
 * listener, spawns a THROWAWAY child with the same LD_PRELOAD env, and asks
 * it to connect. If the throwaway child CAN connect, the shim is NOT enforcing
 * (e.g. it loaded but the libc path is different) — the harness REFUSES to run
 * the transform source. A transform source is only ever executed after this
 * probe proves the enforcement layer blocks a fresh socket in THIS environment.
 *
 * The probe uses a random ephemeral port on 127.0.0.1 (not a real network
 * destination) and is torn down immediately. Its result is cached per
 * (blockerPath, pid) so repeated transforms don't re-probe.
 */
const probeCache = new Map<string, boolean>();
async function verifyBlockerEnforced(socketBlockerPath: string, env: Record<string, string>): Promise<boolean> {
  const key = `${socketBlockerPath}:${process.pid}`;
  const cached = probeCache.get(key);
  if (cached !== undefined) return cached;
  let enforced = false;
  let listener: import("node:net").Server | undefined;
  try {
    const net = await import("node:net");
    const l = net.createServer(() => {
      // Any connection means the shim did NOT block — mark not-enforced.
      enforced = false;
    });
    listener = l;
    await new Promise<void>((r) => l.listen(0, "127.0.0.1", () => r()));
    const addr = listener.address() as { port: number };
    const probeChild = spawn(
      "node",
      [
        "--input-type=module",
        "--eval",
        `import("node:net").then((m) => {
         const s = m.connect(${addr.port}, "127.0.0.1", () => { process.exit(2); });
         s.on("error", () => process.exit(0));
         setTimeout(() => process.exit(3), 2000);
       }).catch(() => process.exit(0));`,
      ],
      { env: { ...env, LD_PRELOAD: socketBlockerPath }, stdio: "ignore" },
    );
    const code = await new Promise<number | null>((r) => probeChild.on("exit", (c) => r(c)));
    // exit=2 means the probe child CONNECTED (shim not enforcing).
    // exit=0 means the connect errored (shim blocked). exit=3 means timeout —
    // treat as NOT enforced (fail-closed).
    enforced = code === 0;
  } catch {
    enforced = false; // fail-closed on any probe error
  } finally {
    listener?.close();
  }
  probeCache.set(key, enforced);
  return enforced;
}

/**
 * Spawn a node child process running `source` in the socket-blocked sandbox.
 * The source is a top-level module evaluated with `--input-type=module`.
 *
 * Fail-closed: on an unsupported platform the child is NOT spawned, AND the
 * shim is LIVE-PROBED — if it does not actually block a socket in this
 * environment, the transform source is NOT executed.
 */
export async function runSandboxedTransform(source: string, opts: SandboxOptions = {}): Promise<SandboxOutcome> {
  const { socketBlockerPath, supported } = buildSocketBlocker();
  if (!supported || !socketBlockerPath) {
    return { refused: true, reason: "platform_unsupported" };
  }
  const probeEnv = buildChildEnv(undefined, socketBlockerPath);
  const enforced = await verifyBlockerEnforced(socketBlockerPath, probeEnv);
  const kernelIsolated = canUnshareNet();
  // Fail-closed: the LD_PRELOAD shim is MANDATORY and must be LIVE-PROBED to
  // actually block a socket. The kernel namespace (`unshare --net`) is used
  // WHEN AVAILABLE — it is a STRONGER guarantee (a kernel wall that a
  // grandchild cannot escape by dropping LD_PRELOAD). On hosts where `unshare`
  // is unavailable (e.g. some CI runners), the shim alone is the isolation
  // and the grandchild escape is DOCUMENTED as a known limitation.
  // Either way, the harness REFUSES to run a transform without the shim.
  if (!enforced) {
    return { refused: true, reason: "platform_unsupported" };
  }
  if (!kernelIsolated && (opts.isolation ?? "kernel-required") === "kernel-required") {
    return { refused: true, reason: "kernel_isolation_unavailable" };
  }
  const env = buildChildEnv(opts.env, socketBlockerPath);
  // Keep a live reference to the child's stdin for the ipcHandler — the
  // handler fires while the promise is still pending, so the parent test
  // can't use the (unresolved) result to send the response back.
  let childStdin: import("node:stream").Writable | undefined;

  return new Promise((resolve, reject) => {
    // When the kernel namespace is available, use it — a STRONGER isolation
    // (a network namespace is a kernel wall; a grandchild spawned with
    // LD_PRELOAD="" is STILL inside the empty namespace). When it is NOT
    // available (some CI runners), fall back to the plain spawn (the
    // LD_PRELOAD shim is still enforced and live-probed above).
    const child: ChildProcess = kernelIsolated
      ? spawn("unshare", ["--user", "--map-root-user", "--net", "node", "--input-type=module", "--eval", source], {
          cwd: opts.cwd,
          env,
          stdio: ["pipe", "pipe", "pipe"],
        })
      : spawn("node", ["--input-type=module", "--eval", source], {
          cwd: opts.cwd,
          env,
          stdio: ["pipe", "pipe", "pipe"],
        });
    childStdin = child.stdin ?? undefined;
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs ?? 30_000);
    // Split stdout by lines so the parent can act on IPC messages BEFORE
    // the child exits (round-trip via `ipcHandler`).
    let lineBuf = "";
    child.stdout?.on("data", (b: Buffer) => {
      stdout += b.toString();
      if (!opts.ipcHandler) return;
      lineBuf += b.toString();
      const lines = lineBuf.split("\n");
      lineBuf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const obj: Record<string, unknown> = JSON.parse(line) as Record<string, unknown>;
          // Give the handler a live stdin handle (the promise that wraps the
          // child hasn't resolved yet — the handler runs while the child is
          // still alive, so `result.stdin` is not usable there).
          opts.ipcHandler(obj, childStdin);
        } catch {
          // Non-JSON stdout line (e.g. `CHILD_SOCKET_BLOCKED`) — not an IPC message.
        }
      }
    });
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
    } else if (child.stdin && !opts.ipcHandler) {
      // No stdin data AND no ipc handler: close stdin so the child's reads get EOF.
      child.stdin.end();
    } else if (child.stdin && opts.ipcHandler) {
      // Round-trip mode: leave stdin OPEN so the parent can write after
      // receiving each message.
    }
  });
}
