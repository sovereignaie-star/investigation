/**
 * Transform sandbox (T-SBX / P2-005).
 *
 * A transform runs as a separate Node process. Its ONLY legitimate way out is the line-delimited JSON channel on
 * stdin/stdout to the parent, which owns the `@ir/egress` gateway and decides every request.
 *
 * Layers (what each one actually is — do not overstate in review or docs):
 *
 * 1. seccomp-bpf (`seccomp-launcher.c`), KERNEL-enforced, inherited by every descendant and impossible to remove
 *    from inside: no new socket of any family (TCP, UDP, AF_UNIX, netlink, raw), no connect/bind/listen/accept, no
 *    io_uring, no ptrace / process_vm_* / pidfd_getfd, no unshare/setns/mount/bpf. A grandchild with a clean
 *    environment is still filtered. This layer does NOT restrict file access.
 * 2. bubblewrap namespaces (when the host allows unprivileged user namespaces): new user, PID, mount, network,
 *    IPC, UTS and cgroup namespaces; a read-only root with only /usr, /lib*, /bin and the Node installation; an
 *    empty /tmp; a private /proc that shows only the sandbox's own processes. This is what stops a transform from
 *    reading the case files, the vault file or /proc/<parent>/mem.
 *
 * Assurance levels:
 * - "full"          = layers 1 + 2, both live-probed in this process.
 * - "network-only"  = layer 1 only (live-probed). File reads are NOT isolated at this level.
 *
 * Fail-closed: the default requirement is "full". If the host cannot provide the required level (non-Linux, no C
 * compiler, seccomp unavailable, user namespaces disabled) the transform is NOT started and a refusal is
 * returned. There is no "run without isolation" path.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import * as net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildSeccompLauncher } from "./build.ts";

export type Assurance = "full" | "network-only";

export interface SandboxOptions {
  /** Minimum isolation the caller accepts. Default "full". "network-only" leaves file reads unisolated. */
  readonly requireAssurance?: Assurance;
  /** Extra environment for the transform. The parent's environment is NOT inherited. */
  readonly env?: Record<string, string>;
  /** Wall-clock limit in ms (default 30_000); the whole process tree is killed when it expires. */
  readonly timeoutMs?: number;
  /** Data written to the transform's stdin, then stdin is closed. */
  readonly stdinData?: string;
  /**
   * Round-trip IPC: every JSON line the transform prints is passed here, with a handle to write the answer back
   * on its stdin. This is the only legitimate path to the network (the parent's gateway).
   */
  readonly ipcHandler?: (message: Record<string, unknown>, stdin: NonNullable<ChildProcess["stdin"]> | undefined) => void;
  /**
   * Abort the run: the whole process tree is killed (like a timeout) and the promise settles with a
   * `SandboxAborted` outcome instead of a result. The transform cannot observe the abort before it is killed.
   */
  readonly signal?: AbortSignal;
}

export interface SandboxResult {
  readonly ok: boolean;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly assurance: Assurance;
}

export interface SandboxRefusal {
  readonly refused: true;
  readonly reason: "platform_unsupported" | "isolation_unavailable" | "probe_failed";
  readonly detail?: string;
}

/** The run was aborted by the caller's signal before it completed. */
export interface SandboxAborted {
  readonly aborted: true;
  readonly reason: string;
}

export type SandboxOutcome = SandboxResult | SandboxRefusal | SandboxAborted;

export function isRefusal(x: SandboxOutcome): x is SandboxRefusal {
  return (x as SandboxRefusal).refused === true;
}

export function isAborted(x: SandboxOutcome): x is SandboxAborted {
  return (x as SandboxAborted).aborted === true;
}

export interface IsolationReport {
  readonly launcher: boolean;
  readonly networkOnly: boolean;
  readonly full: boolean;
  readonly detail: readonly string[];
}

const ENV_ALLOWLIST = ["PATH", "LANG", "LC_ALL", "TZ"] as const;

function childEnv(extra: Record<string, string> | undefined, assurance: Assurance): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ENV_ALLOWLIST) {
    const v = process.env[key];
    if (v !== undefined) env[key] = v;
  }
  if (assurance === "full") env["HOME"] = "/tmp";
  return { ...env, ...(extra ?? {}) };
}

const LAUNCHER_IN_SANDBOX = "/run/ir/ir-seccomp-exec";

function nodeBinary(): { path: string; prefix: string } {
  const path = realpathSync(process.execPath);
  return { path, prefix: dirname(dirname(path)) };
}

/** argv for running `node --input-type=module --eval source` at the given assurance level. */
function command(assurance: Assurance, launcherPath: string, source: string): { file: string; args: string[] } {
  const node = nodeBinary();
  const nodeArgs = [node.path, "--input-type=module", "--eval", source];
  if (assurance === "network-only") return { file: launcherPath, args: nodeArgs };
  const binds: string[] = [];
  for (const d of ["/usr", "/lib", "/lib64", "/bin"]) binds.push("--ro-bind-try", d, d);
  // The node prefix is bound AFTER the tmpfs: a node installed under /tmp (or any
  // path later shadowed by --tmpfs) must not be hidden by the tmpfs mount. When
  // node lives under /usr it is already covered by the ro-bind-try above.
  const nodeBind = node.prefix.startsWith("/usr/") ? [] : ["--ro-bind", node.prefix, node.prefix];
  return {
    file: "bwrap",
    args: [
      "--unshare-all",
      "--die-with-parent",
      "--new-session",
      "--cap-drop",
      "ALL",
      ...binds,
      "--ro-bind",
      launcherPath,
      LAUNCHER_IN_SANDBOX,
      "--proc",
      "/proc",
      "--dev",
      "/dev",
      "--tmpfs",
      "/tmp",
      ...nodeBind,
      "--chdir",
      "/tmp",
      LAUNCHER_IN_SANDBOX,
      ...nodeArgs,
    ],
  };
}

function runOnce(
  assurance: Assurance,
  launcherPath: string,
  source: string,
  env: Record<string, string>,
  timeoutMs: number,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const { file, args } = command(assurance, launcherPath, source);
    const p = spawn(file, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const t = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
    p.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
    p.on("error", (e) => {
      clearTimeout(t);
      resolve({ code: -1, stdout, stderr: stderr + String(e) });
    });
    p.on("close", (code) => {
      clearTimeout(t);
      resolve({ code, stdout, stderr });
    });
  });
}

/**
 * The probe transform: tries a TCP connect, an AF_UNIX connect and (for "full") a file read and a /proc scan.
 * Each attempt prints one token; the parent compares the tokens AND checks its own listeners saw nothing.
 */
const PROBE_SOURCE = `
import * as net from "node:net";
import * as fs from "node:fs";
const out = [];
const tryConnect = (opts) => new Promise((r) => {
  let s;
  try { s = net.connect(opts); } catch (e) { r("THROW_" + (e.code || e.message)); return; }
  s.on("connect", () => { s.destroy(); r("CONNECTED"); });
  s.on("error", (e) => r("ERR_" + e.code));
  setTimeout(() => r("TIMEOUT"), 3000);
});
out.push("tcp:" + await tryConnect({ host: "127.0.0.1", port: Number(process.env.IR_PROBE_PORT) }));
out.push("unix:" + await tryConnect({ path: process.env.IR_PROBE_UNIX }));
try { fs.readFileSync(process.env.IR_PROBE_FILE, "utf8"); out.push("file:READ"); } catch (e) { out.push("file:ERR_" + e.code); }
const pids = fs.readdirSync("/proc").filter((x) => /^[0-9]+$/.test(x));
out.push("ppid-visible:" + pids.includes(String(process.env.IR_PROBE_PARENT_PID)));
console.log(out.join(" "));
`;

let reportPromise: Promise<IsolationReport> | undefined;

/** Live-probe what this host can enforce (cached for the process). */
export function probeIsolation(): Promise<IsolationReport> {
  reportPromise ??= doProbe();
  return reportPromise;
}

async function doProbe(): Promise<IsolationReport> {
  const detail: string[] = [];
  const build = buildSeccompLauncher();
  if (!build.supported || !build.launcherPath) {
    detail.push(build.detail ?? "launcher unavailable");
    return { launcher: false, networkOnly: false, full: false, detail };
  }
  const dir = mkdtempSync(join(realpathSync(tmpdir()), "ir-sbx-probe-"));
  const canary = join(dir, "canary.txt");
  writeFileSync(canary, "IR_SANDBOX_CANARY", { mode: 0o600 });
  let seen = 0;
  const tcp = net.createServer((s) => {
    seen++;
    s.destroy();
  });
  const unixPath = join(dir, "probe.sock");
  const unix = net.createServer((s) => {
    seen++;
    s.destroy();
  });
  try {
    await new Promise<void>((r) => tcp.listen(0, "127.0.0.1", r));
    await new Promise<void>((r) => unix.listen(unixPath, r));
    const env = {
      IR_PROBE_PORT: String((tcp.address() as net.AddressInfo).port),
      IR_PROBE_UNIX: unixPath,
      IR_PROBE_FILE: canary,
      IR_PROBE_PARENT_PID: String(process.pid),
    };
    const netOnly = await runOnce("network-only", build.launcherPath, PROBE_SOURCE, childEnv(env, "network-only"), 10_000);
    const netOnlyOk = netOnly.code === 0 && /tcp:ERR_EACCES unix:ERR_EACCES/.test(netOnly.stdout) && seen === 0;
    if (!netOnlyOk)
      detail.push(`network-only probe failed: code=${netOnly.code} out=${netOnly.stdout.trim()} err=${netOnly.stderr.trim()} seen=${seen}`);
    let fullOk = false;
    const hasBwrap = spawnSync("bwrap", ["--version"], { encoding: "utf8" }).status === 0;
    if (!hasBwrap) detail.push("bubblewrap not installed");
    else if (netOnlyOk) {
      const full = await runOnce("full", build.launcherPath, PROBE_SOURCE, childEnv(env, "full"), 10_000);
      fullOk =
        full.code === 0 &&
        /tcp:ERR_EACCES/.test(full.stdout) &&
        /unix:ERR_(EACCES|ENOENT)/.test(full.stdout) &&
        /file:ERR_ENOENT/.test(full.stdout) &&
        /ppid-visible:false/.test(full.stdout) &&
        seen === 0;
      if (!fullOk) detail.push(`full probe failed: code=${full.code} out=${full.stdout.trim()} err=${full.stderr.trim()} seen=${seen}`);
    }
    return { launcher: true, networkOnly: netOnlyOk, full: fullOk, detail };
  } finally {
    tcp.close();
    unix.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Run `source` (an ES module body) as a sandboxed transform at the best live-probed assurance level that meets
 * `requireAssurance`. Returns a refusal instead of running when the requirement cannot be met.
 */
export async function runSandboxedTransform(source: string, opts: SandboxOptions = {}): Promise<SandboxOutcome> {
  const required = opts.requireAssurance ?? "full";
  const report = await probeIsolation();
  if (!report.launcher) return { refused: true, reason: "platform_unsupported", detail: report.detail.join("; ") };
  if (!report.networkOnly) return { refused: true, reason: "probe_failed", detail: report.detail.join("; ") };
  if (required === "full" && !report.full) return { refused: true, reason: "isolation_unavailable", detail: report.detail.join("; ") };
  return runAtLevel(report.full ? "full" : "network-only", source, opts);
}

/**
 * Run at EXACTLY `level` (refusing if it was not live-probed). Not exported from the package index: it exists so
 * the T-SBX suite can exercise the seccomp layer alone on hosts that also provide namespaces. Production callers
 * use `runSandboxedTransform`, which always picks the strongest available level.
 */
export async function runAtLevel(
  level: Assurance,
  source: string,
  opts: Omit<SandboxOptions, "requireAssurance"> = {},
): Promise<SandboxOutcome> {
  const build = buildSeccompLauncher();
  if (!build.supported || !build.launcherPath) return { refused: true, reason: "platform_unsupported", detail: build.detail };
  const report = await probeIsolation();
  if (!report.networkOnly) return { refused: true, reason: "probe_failed", detail: report.detail.join("; ") };
  if (level === "full" && !report.full) return { refused: true, reason: "isolation_unavailable", detail: report.detail.join("; ") };
  const assurance: Assurance = level;
  const { file, args } = command(assurance, build.launcherPath, source);

  return new Promise((resolve, reject) => {
    // detached: the transform gets its own process group so a timeout kills grandchildren too.
    const child: ChildProcess = spawn(file, args, { env: childEnv(opts.env, assurance), stdio: ["pipe", "pipe", "pipe"], detached: true });
    const stdin = child.stdin ?? undefined;
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      fn();
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, opts.timeoutMs ?? 30_000);
    const onAbort = () => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
      settle(() => resolve({ aborted: true, reason: signal?.reason instanceof Error ? signal.reason.message : "aborted" }));
    };
    const signal = opts.signal;
    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
    let lineBuf = "";
    child.stdout?.on("data", (b: Buffer) => {
      const text = b.toString();
      stdout += text;
      if (!opts.ipcHandler) return;
      lineBuf += text;
      const lines = lineBuf.split("\n");
      lineBuf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let msg: unknown;
        try {
          msg = JSON.parse(line);
        } catch {
          continue; // not an IPC message
        }
        if (msg !== null && typeof msg === "object" && !Array.isArray(msg)) opts.ipcHandler(msg as Record<string, unknown>, stdin);
      }
    });
    child.stderr?.on("data", (b: Buffer) => (stderr += b.toString()));
    child.on("error", (e) => {
      settle(() => reject(e));
    });
    child.on("close", (code, sig) => {
      settle(() => resolve({ ok: code === 0 && !timedOut, exitCode: code, signal: sig, stdout, stderr, timedOut, assurance }));
    });
    if (stdin) {
      if (opts.stdinData !== undefined) {
        // Initial data (e.g. a bootstrap payload) is written first. When an ipcHandler is
        // present the stream stays open so the parent can answer the transform's requests;
        // otherwise it is closed after the initial data.
        stdin.write(opts.stdinData);
        if (!opts.ipcHandler) stdin.end();
      } else if (!opts.ipcHandler) {
        stdin.end();
      }
    }
  });
}
