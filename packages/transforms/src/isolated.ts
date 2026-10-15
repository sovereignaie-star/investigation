/**
 * P2-005 — isolated transform runner (T-ISO).
 *
 * `runTransformIsolated` executes a transform module in the REAL sandbox
 * (`@ir/sandbox`, seccomp + bubblewrap namespaces) instead of in-process. The
 * transform's only network path is `ctx.http`, which is implemented as a
 * line-delimited JSON channel to the parent; the parent owns the injected
 * `HttpTransport` (the egress gateway in production) and enforces the manifest's
 * declared limits (`rps`, `timeoutMs`, `maxBytes`) and records evidence exactly
 * as the in-process runner does.
 *
 * Trust model: the parent NEVER executes the transform module. It bundles the
 * module with esbuild (no execution), spawns it inside the sandbox, and the
 * child reports its manifest over IPC. The parent validates the manifest against
 * the schema and enforces it. A transform that tries to open a socket, read the
 * host filesystem, or reach the network directly is stopped by the sandbox
 * (seccomp + namespaces) — the T-SBX suite proves those barriers.
 *
 * Cancellation: the run's `AbortSignal` is forwarded to the sandbox, which kills
 * the whole process tree (SIGKILL to the process group). A cancelled run fails
 * with `stage: "cancel"` and is never a success.
 *
 * Fail-closed: if the sandbox cannot provide the required assurance level, the
 * run is refused (`stage: "refused"`) — there is no silent fallback to
 * in-process execution.
 */
import { dirname } from "node:path";
import { CancellationError } from "@ir/engine/cancel";
import type { HttpTransport } from "@ir/engine/transport";
import { TransformManifest as TransformManifestSchema } from "@ir/schema";
import {
  isAborted,
  isRefusal,
  runSandboxedTransform,
  type Assurance,
  type SandboxOutcome,
  type ResourceLimits,
  type SandboxResult,
} from "@ir/transform-sandbox";
import { TransformOutputSchema, type TransformOutput } from "./output.ts";
import { createTransformHttp, type TransformHttp } from "./transform.ts";
import {
  RateLimiter,
  TransformRunError,
  checkFindingEvidence,
  recordingTransport,
  type RunTransformResult,
  type TransformEvidence,
} from "./runner.ts";

export interface RunTransformIsolatedOptions {
  /** The injected transport (the egress gateway in production). */
  readonly transport: HttpTransport;
  /** The canonical input the transform is invoked with. */
  readonly input: unknown;
  /** The run's cancellation signal. */
  readonly signal?: AbortSignal;
  /** The transform id to select from the module's exports. */
  readonly transformId?: string;
  /** Minimum isolation the sandbox must provide. Default "full". */
  readonly requireAssurance?: Assurance;
  /** Wall-clock backstop for the whole sandboxed run. Default 30_000. */
  readonly sandboxTimeoutMs?: number;
  /**
   * Resource limits for the sandboxed process (P2-034; merged over the sandbox defaults: 2 GiB address space,
   * 512 MiB V8 heap, 64 MiB files, 256 descriptors, 60 CPU seconds, 16 MiB output). The timeout is not a
   * memory bound; these are.
   */
  readonly sandboxLimits?: Partial<ResourceLimits>;
  /** Injectable clock for deterministic rate-limit tests. */
  readonly now?: () => number;
  /** Injectable sleep for deterministic rate-limit tests. */
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** P2-036 — stamps each evidence record's fetch time (see `RunTransformOptions.fetchedAt`). */
  readonly fetchedAt?: () => string;
}

/** Classify a transport rejection into a stable evidence kind. */
function classifyKind(err: unknown): string {
  if (err instanceof CancellationError) return "cancel";
  if (err instanceof TransformRunError) {
    const last = err.evidence[err.evidence.length - 1];
    return last?.error?.kind ?? "transform";
  }
  if (err instanceof Error && "kind" in err && typeof (err as { kind: unknown }).kind === "string") {
    return (err as { kind: string }).kind;
  }
  return "transform";
}

/**
 * Bundle a transform module into a single self-contained ESM string. The wrapper
 * selects the transform by id from the module's exports. Bundling does NOT
 * execute the module — the parent never runs the transform's code.
 *
 * esbuild is imported lazily (P2-033): a top-level import made every bundle that
 * reaches `@ir/transforms` (the `ir` CLI in the server image) evaluate esbuild's
 * CommonJS entry at start-up, which crashes an ESM bundle ("Dynamic require of
 * fs is not supported") and needs `node_modules` at runtime. Only isolated runs
 * need the bundler, so only they load it. The specifier is a literal, so the
 * no-direct-network analyzer still sees exactly what is loaded.
 */
export async function bundleTransform(modulePath: string, transformId: string): Promise<string> {
  const { buildSync } = await import("esbuild");
  const wrapper =
    `import * as mod from ${JSON.stringify(modulePath)};\n` +
    `const def = Object.values(mod).find((v) => v && typeof v === "object" && v.manifest && v.manifest.id === ${JSON.stringify(transformId)});\n` +
    `if (!def) throw new Error("no transform with id ${transformId} in module");\n` +
    `export default def;`;
  const result = buildSync({
    stdin: { contents: wrapper, resolveDir: dirname(modulePath), sourcefile: "transform-wrapper.ts", loader: "ts" },
    bundle: true,
    format: "esm",
    platform: "node",
    target: "es2022",
    write: false,
    logLevel: "silent",
    minify: true,
  });
  return result.outputFiles[0].text;
}

/**
 * The child bootstrap: reads the bundled module and the input from stdin (two
 * lines), reports its manifest, then serves `ctx.http` requests over the same
 * stdin/stdout channel. The transform's own console output is redirected to
 * stderr so it can never collide with the IPC protocol.
 */
const BOOTSTRAP = `
import * as readline from "node:readline";
const ipc = (obj) => { process.stdout.write(JSON.stringify(obj) + "\\n"); };
console.log = (...args) => process.stderr.write(args.map(String).join(" ") + "\\n");
console.error = (...args) => process.stderr.write(args.map(String).join(" ") + "\\n");
const rl = readline.createInterface({ input: process.stdin });
// Lines are buffered as they arrive: the bundle import below can take seconds,
// and a line emitted while no listener is registered must not be lost.
const lineQueue = [];
let resolveNext = null;
rl.on("line", (l) => {
  if (resolveNext) { const r = resolveNext; resolveNext = null; r(l); }
  else lineQueue.push(l);
});
const nextLine = () => new Promise((resolve) => {
  if (lineQueue.length) resolve(lineQueue.shift());
  else resolveNext = resolve;
});
const bundleLine = await nextLine();
let def;
try {
  const mod = await import("data:text/javascript;base64," + bundleLine);
  def = mod.default;
} catch (err) {
  ipc({ op: "fatal", error: { kind: "bundle", message: "bundle import failed: " + (err?.message ?? String(err)) } });
  process.exit(1);
}
if (!def || typeof def.run !== "function") {
  ipc({ op: "fatal", error: { kind: "bundle", message: "bundle did not export a transform" } });
  process.exit(1);
}
const inputLine = await nextLine();
let input;
try { input = JSON.parse(inputLine); } catch (err) {
  ipc({ op: "fatal", error: { kind: "bundle", message: "input is not valid JSON" } });
  process.exit(1);
}
ipc({ op: "ready", manifest: def.manifest });
// The parent answers ready with the run-time environment the manifest declared (fail-closed: only
// declared names, only when the parent has them). The line always arrives — an empty values object
// when the manifest declares nothing or the parent lacks a name — so the run never blocks here.
const envLine = await nextLine();
try {
  const envMsg = JSON.parse(envLine);
  for (const [k, v] of Object.entries(envMsg.values ?? {})) process.env[k] = String(v);
} catch { /* a malformed env line leaves the environment untouched; the transform fails closed on its own */ }
const pending = new Map();
let nextId = 1;
rl.on("line", (l) => {
  let msg;
  try { msg = JSON.parse(l); } catch { return; }
  const p = pending.get(msg.id);
  if (!p) return;
  pending.delete(msg.id);
  if (msg.ok) p.resolve({ requestId: msg.requestId, status: msg.status, headers: msg.headers ?? {}, body: msg.body ?? "" });
  else {
    const err = new Error(msg.error?.message ?? "request failed");
    err.kind = msg.error?.kind ?? "transport";
    p.reject(err);
  }
});
const ipcFetch = (method, url) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  ipc({ op: "fetch", id, method, url });
});
const http = {
  get: (url) => ipcFetch("GET", url),
  head: (url) => ipcFetch("HEAD", url),
};
const ctx = { http, manifest: def.manifest, input, signal: new AbortController().signal };
try {
  const output = await def.run(input, ctx);
  ipc({ op: "result", ok: true, output });
} catch (err) {
  ipc({ op: "result", ok: false, error: { kind: err?.kind ?? "transform", message: err?.message ?? String(err) } });
}
process.exit(0);
`;

/**
 * Run a transform module in the real sandbox. The parent bundles the module,
 * spawns it under seccomp + namespaces, and serves its network requests through
 * the injected transport with the manifest's limits enforced and evidence
 * recorded. Failures are typed by stage exactly like the in-process runner.
 */
interface IpcState {
  readonly evidence: TransformEvidence[];
  readonly transport: HttpTransport;
  readonly signal: AbortSignal;
  readonly now: () => number;
  readonly sleep: (ms: number, sig: AbortSignal) => Promise<void>;
  readonly fetchedAt: (() => string) | undefined;
  http: TransformHttp | undefined;
  manifestError: string | undefined;
  outcome: { ok: boolean; output?: unknown; error?: { kind: string; message: string } } | undefined;
  fatal: { kind: string; message: string } | undefined;
  writeError: string | undefined;
}

/** Handle one IPC message from the sandboxed child (ready / fetch / result / fatal). */
function handleIpcMessage(state: IpcState, msg: Record<string, unknown>, stdin: NodeJS.WritableStream | undefined): void {
  switch (msg.op) {
    case "ready": {
      // The declared environment reaches the sandboxed child over IPC (the sandbox does NOT inherit
      // the parent's environment by design): only names the manifest declares, only when the parent
      // has them. A parse failure still answers with an empty line so the child never blocks.
      const answerEnv = (values: Record<string, string>) => {
        try {
          stdin?.write(JSON.stringify({ op: "env", values }) + "\n");
        } catch (err) {
          // The child may already be gone (cancellation/timeout); the write is best-effort and the
          // child would hang to the sandbox timeout anyway. Record the failure as a typed state
          // field (D-017: no silent catch) so the settled run reports the write failure, not a timeout.
          state.writeError = err instanceof Error ? err.message : String(err);
        }
      };
      let manifest;
      try {
        manifest = TransformManifestSchema.parse(msg.manifest);
      } catch (err) {
        // The child is still answered (an empty env line) so it never blocks; the run then fails
        // on the manifest error below, exactly as before.
        answerEnv({});
        state.manifestError = err instanceof Error ? err.message : String(err);
        return;
      }
      const values: Record<string, string> = {};
      for (const name of manifest.env) {
        const v = process.env[name];
        if (v !== undefined) values[name] = v;
      }
      answerEnv(values);
      const limiter = new RateLimiter(manifest.limits.rps, state.now, state.sleep);
      state.http = createTransformHttp(
        recordingTransport(
          state.transport,
          state.evidence,
          limiter,
          manifest.limits.timeoutMs,
          manifest.limits.maxBytes,
          state.signal,
          state.fetchedAt,
        ),
        state.signal,
      );
      return;
    }
    case "fetch": {
      if (!state.http) return;
      const method = msg.method === "HEAD" ? "head" : "get";
      const answer = (payload: string) => {
        try {
          stdin?.write(payload);
        } catch (err) {
          // The child may already be gone (cancellation/timeout); the write is best-effort.
          // Record the failure as a typed state field (D-017: no silent catch).
          state.writeError = err instanceof Error ? err.message : String(err);
        }
      };
      state.http[method](String(msg.url)).then(
        (res) =>
          answer(
            JSON.stringify({
              id: msg.id,
              ok: true,
              requestId: res.requestId,
              status: res.status,
              headers: res.headers ?? {},
              body: res.body,
            }) + "\n",
          ),
        (err) =>
          answer(
            JSON.stringify({
              id: msg.id,
              ok: false,
              error: { kind: classifyKind(err), message: err instanceof Error ? err.message : String(err) },
            }) + "\n",
          ),
      );
      return;
    }
    case "result": {
      state.outcome = { ok: msg.ok === true, output: msg.output, error: msg.error as { kind: string; message: string } | undefined };
      return;
    }
    case "fatal": {
      state.fatal = {
        kind: String((msg.error as { kind?: string } | undefined)?.kind ?? "bundle"),
        message: String((msg.error as { message?: string } | undefined)?.message ?? "bundle failed"),
      };
      return;
    }
  }
}

/** Map a child-reported error kind to a run stage (mirrors the in-process runner). */
function stageForKind(kind: string): TransformRunError["stage"] {
  if (kind === "cancel") return "cancel";
  if (kind === "transform") return "transform";
  if (kind === "bundle") return "refused";
  return "request";
}

/** Build the failure message for a non-zero sandbox exit. */
function exitMessage(sandboxOutcome: SandboxResult, sandboxTimeoutMs: number): string {
  if (sandboxOutcome.timedOut) return `sandboxed run timed out after ${sandboxTimeoutMs}ms`;
  if (sandboxOutcome.outputLimitExceeded) {
    return `sandboxed run killed: output exceeded ${sandboxOutcome.limits.maxOutputBytes} bytes`;
  }
  const stderr = sandboxOutcome.stderr.trim().slice(0, 1000);
  return `sandboxed run failed: exit ${sandboxOutcome.exitCode}${stderr ? `: ${stderr}` : ""}`;
}

/** Throw the typed error for a failed sandbox outcome (refusal / abort / fatal / manifest / exit). */
function throwSandboxFailure(sandboxOutcome: SandboxOutcome, state: IpcState, sandboxTimeoutMs: number): never {
  const evidence = state.evidence;
  if (isRefusal(sandboxOutcome)) {
    throw new TransformRunError(
      "refused",
      `sandbox refused to run: ${sandboxOutcome.reason}${sandboxOutcome.detail ? ` (${sandboxOutcome.detail})` : ""}`,
      evidence,
    );
  }
  if (isAborted(sandboxOutcome)) {
    throw new TransformRunError("cancel", `sandboxed run aborted: ${sandboxOutcome.reason}`, evidence);
  }
  if (state.fatal) {
    throw new TransformRunError("refused", `isolated run could not start: ${state.fatal.message}`, evidence);
  }
  if (state.manifestError) {
    throw new TransformRunError("refused", `transform manifest rejected: ${state.manifestError}`, evidence);
  }
  if (!sandboxOutcome.ok) {
    throw new TransformRunError("transform", exitMessage(sandboxOutcome as SandboxResult, sandboxTimeoutMs), evidence);
  }
  if (!state.outcome) {
    throw new TransformRunError("transform", "sandboxed run produced no result", evidence);
  }
  const kind = state.outcome.error?.kind ?? "transform";
  throw new TransformRunError(stageForKind(kind), state.outcome.error?.message ?? "transform failed", evidence);
}

/** Map a sandbox outcome to a typed TransformRunError, or return the validated result. */
function settleIsolatedRun(sandboxOutcome: SandboxOutcome, state: IpcState, sandboxTimeoutMs: number): RunTransformResult {
  const evidence = state.evidence;
  if (
    isRefusal(sandboxOutcome) ||
    isAborted(sandboxOutcome) ||
    state.fatal ||
    state.manifestError ||
    !sandboxOutcome.ok ||
    !state.outcome ||
    !state.outcome.ok
  ) {
    throwSandboxFailure(sandboxOutcome, state, sandboxTimeoutMs);
  }
  let validated: TransformOutput;
  try {
    validated = TransformOutputSchema.parse(state.outcome.output);
  } catch (err) {
    throw new TransformRunError("validation", err instanceof Error ? err.message : String(err), evidence);
  }
  // P2-036: the same evidence contract as the in-process runner. The child cannot mint request ids: the ids it
  // cites are checked against the records the parent made for the requests it actually served.
  checkFindingEvidence(validated, evidence);
  return { output: validated, requestCount: evidence.filter((e) => e.status !== undefined).length, evidence };
}

/**
 * Run a transform module in the real sandbox. The parent bundles the module,
 * spawns it under seccomp + namespaces, and serves its network requests through
 * the injected transport with the manifest's limits enforced and evidence
 * recorded. Failures are typed by stage exactly like the in-process runner.
 */
export async function runTransformIsolated(modulePath: string, opts: RunTransformIsolatedOptions): Promise<RunTransformResult> {
  const transformId = opts.transformId ?? "TR-010";
  const signal = opts.signal ?? new AbortController().signal;
  const now = opts.now ?? (() => Date.now());
  const sleep =
    opts.sleep ??
    ((ms, sig) =>
      new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, ms);
        sig.addEventListener(
          "abort",
          () => {
            clearTimeout(t);
            reject(sig.reason);
          },
          { once: true },
        );
      }));
  const state: IpcState = {
    evidence: [],
    transport: opts.transport,
    signal,
    now,
    sleep,
    fetchedAt: opts.fetchedAt,
    http: undefined,
    manifestError: undefined,
    outcome: undefined,
    fatal: undefined,
    writeError: undefined,
  };

  let bundle: string;
  try {
    bundle = await bundleTransform(modulePath, transformId);
  } catch (err) {
    throw new TransformRunError("refused", `could not bundle transform module: ${err instanceof Error ? err.message : String(err)}`, []);
  }

  const sandboxTimeoutMs = opts.sandboxTimeoutMs ?? 30_000;
  const sandboxOutcome = await runSandboxedTransform(BOOTSTRAP, {
    requireAssurance: opts.requireAssurance,
    timeoutMs: sandboxTimeoutMs,
    limits: opts.sandboxLimits,
    stdinData: Buffer.from(bundle).toString("base64") + "\n" + JSON.stringify(opts.input) + "\n",
    ipcHandler: (msg, stdin) => handleIpcMessage(state, msg, stdin),
    signal,
  });

  return settleIsolatedRun(sandboxOutcome, state, sandboxTimeoutMs);
}
