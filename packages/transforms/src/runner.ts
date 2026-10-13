/**
 * P2-004 — transform runner (T-RULE-01/03/04/05).
 *
 * `runTransform` is the single entry point that executes a transform definition:
 * it validates the manifest, wraps the injected `HttpTransport` into `ctx.http`,
 * enforces the manifest's declared limits (`rps`, `timeoutMs`, `maxBytes`),
 * validates the output against `TransformOutputSchema` (T-RULE-03), and records
 * every request outcome — success AND failure — as evidence (T-RULE-04/05). The
 * runner never silently drops a failure and never reports a failure as an empty
 * success.
 *
 * Cancellation: the run's `AbortSignal` is threaded through `ctx.http` into every
 * transport call, and a response that arrives after cancellation is refused. A
 * cancelled run fails with `stage: "cancel"` and is never recorded as a success.
 *
 * Trust boundary: `runTransform` executes the transform IN-PROCESS. That provides
 * NO runtime isolation — the transform code can read `process.env`, the file
 * system, and any host capability. The static `no-direct-network` guard is not a
 * substitute for isolation. Real execution of untrusted transforms must go
 * through the sandbox (`@ir/sandbox`, P2-005); `requireIsolation: true` refuses
 * to run in-process so production wiring cannot accidentally execute untrusted
 * code here.
 */
import { CancellationError } from "@ir/engine/cancel";
import type { HttpTransport, TransportRequest, TransportResponse } from "@ir/engine/transport";
import { TransformManifest as TransformManifestSchema } from "@ir/schema";
import { TransformOutputSchema, type TransformOutput } from "./output.ts";
import { createTransformHttp, type Transform, type TransformContext } from "./transform.ts";

export interface RunTransformOptions {
  /** The injected transport (the egress gateway in production). */
  transport: HttpTransport;
  /** The canonical input the transform is invoked with. */
  input: unknown;
  /** The run's cancellation signal (the engine's per-run token in production). */
  signal?: AbortSignal;
  /**
   * When true, refuse to run: in-process execution provides no runtime isolation.
   * Set by production wiring that must not execute untrusted transforms in-process.
   */
  requireIsolation?: boolean;
  /** Injectable clock for deterministic rate-limit tests. */
  now?: () => number;
  /** Injectable sleep for deterministic rate-limit tests. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

/** A recorded request outcome: success (status/headers/body) or failure (error). */
export interface TransformEvidence {
  readonly url: string;
  readonly method: string;
  /** Present only on a successful response. */
  readonly status?: number;
  /** Present only on a successful response. */
  readonly headers?: Readonly<Record<string, string>>;
  /** Present only on a successful response. */
  readonly body?: string;
  /** Present only when the request failed; the run then fails with the same kind. */
  readonly error?: { readonly kind: string; readonly message: string };
}

export interface RunTransformResult {
  readonly output: TransformOutput;
  /** Number of HTTP requests made during the run. */
  readonly requestCount: number;
  /** Evidence records for each request outcome (T-RULE-04/05). */
  readonly evidence: TransformEvidence[];
}

/** Typed failure of a transform run, distinguishing the failing stage. */
export class TransformRunError extends Error {
  readonly stage: "request" | "transform" | "validation" | "cancel" | "refused";
  readonly evidence: TransformEvidence[];
  constructor(stage: TransformRunError["stage"], message: string, evidence: TransformEvidence[]) {
    super(message);
    this.name = "TransformRunError";
    this.stage = stage;
    this.evidence = evidence;
  }
}

/** Classify a transport rejection into a stable evidence kind. */
function classifyTransportError(err: unknown): { kind: string; message: string } {
  if (err instanceof CancellationError) return { kind: "cancel", message: err.message };
  if (err instanceof Error && "kind" in err && typeof (err as { kind: unknown }).kind === "string") {
    return { kind: (err as { kind: string }).kind, message: err.message };
  }
  return { kind: "transport", message: err instanceof Error ? err.message : String(err) };
}

/**
 * A token bucket enforcing the transform's declared `limits.rps` (requests per
 * second). This is the transform's own ceiling, applied at the execution layer;
 * the gateway's per-host limiter is a separate safety net (ADR-08), not a
 * replacement for it. The bucket is per-run, so concurrent runs never share or
 * steal each other's allowance.
 */
class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  constructor(
    private readonly rps: number,
    private readonly now: () => number,
    private readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>,
  ) {
    this.tokens = rps;
    this.lastRefill = now();
  }
  /** Wait until a token is available (or the signal aborts). */
  async take(signal: AbortSignal): Promise<void> {
    for (;;) {
      const t = this.now();
      const elapsedMs = Math.max(0, t - this.lastRefill);
      this.tokens = Math.min(this.rps, this.tokens + (elapsedMs / 1000) * this.rps);
      this.lastRefill = t;
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const waitMs = Math.max(1, Math.ceil(((1 - this.tokens) / this.rps) * 1000));
      await this.sleep(waitMs, signal);
    }
  }
}

/** Wrap a transport so every request is counted, limited, and recorded as evidence. */
function recordingTransport(
  transport: HttpTransport,
  evidence: TransformEvidence[],
  limiter: RateLimiter,
  timeoutMs: number,
  maxBytes: number,
  runSignal: AbortSignal,
): HttpTransport {
  return {
    async fetch(req: TransportRequest, _fetchSignal: AbortSignal): Promise<TransportResponse> {
      // The transform's declared per-request timeout, combined with the run signal.
      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      const combined = AbortSignal.any([runSignal, timeoutSignal]);
      let recorded = false;
      const record = (e: TransformEvidence) => {
        if (!recorded) {
          evidence.push(e);
          recorded = true;
        }
      };
      try {
        // A run cancelled before the request is issued never reaches the transport.
        if (runSignal.aborted) {
          const err = { kind: "cancel", message: "cancelled before the request was issued" };
          record({ url: req.url, method: req.method, error: err });
          throw new CancellationError(err.message);
        }
        await limiter.take(combined);
        const res = await transport.fetch(req, combined);
        const body = typeof res.body === "string" ? res.body : res.body instanceof Uint8Array ? new TextDecoder().decode(res.body) : "";
        if (body.length > maxBytes) {
          const err = { kind: "size_limit", message: `response body ${body.length} bytes exceeds manifest.limits.maxBytes (${maxBytes})` };
          record({ url: req.url, method: req.method, error: err });
          throw new TransformRunError("request", err.message, evidence);
        }
        if (runSignal.aborted) {
          const err = { kind: "cancel", message: "cancelled before the response was accepted" };
          record({ url: req.url, method: req.method, error: err });
          throw new CancellationError(err.message);
        }
        record({ url: req.url, method: req.method, status: res.status, headers: res.headers ?? {}, body });
        return res;
      } catch (err) {
        if (err instanceof TransformRunError) throw err;
        if (err instanceof CancellationError) {
          record({ url: req.url, method: req.method, error: { kind: "cancel", message: err.message } });
          throw err;
        }
        // A rejection caused by the run signal aborting is a cancellation, not a
        // transport failure — cancellation wins over the timeout, as in the engine.
        if (runSignal.aborted) {
          const err2 = { kind: "cancel", message: "cancelled during the request" };
          record({ url: req.url, method: req.method, error: err2 });
          throw new CancellationError(err2.message);
        }
        if (timeoutSignal.aborted) {
          const e = { kind: "timeout", message: `request exceeded manifest.limits.timeoutMs (${timeoutMs}ms)` };
          record({ url: req.url, method: req.method, error: e });
          throw new TransformRunError("request", e.message, evidence);
        }
        const e = classifyTransportError(err);
        record({ url: req.url, method: req.method, error: e });
        throw new TransformRunError("request", e.message, evidence);
      }
    },
  };
}

/**
 * Run a transform definition. The manifest is re-validated at run time (fail-closed:
 * a definition whose manifest drifted from the schema is refused), the transport is
 * wrapped into `ctx.http`, the declared limits are enforced, and the output is
 * validated before it is returned. Failures are typed by stage and carry the
 * evidence recorded up to the failure.
 */
export async function runTransform<TInput>(definition: Transform<TInput>, opts: RunTransformOptions): Promise<RunTransformResult> {
  if (opts.requireIsolation === true) {
    throw new TransformRunError("refused", "in-process execution provides no runtime isolation; use the sandbox (P2-005)", []);
  }
  const manifest = TransformManifestSchema.parse(definition.manifest);
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
  const evidence: TransformEvidence[] = [];
  const limiter = new RateLimiter(manifest.limits.rps, now, sleep);
  const http = createTransformHttp(
    recordingTransport(opts.transport, evidence, limiter, manifest.limits.timeoutMs, manifest.limits.maxBytes, signal),
    signal,
  );
  const ctx: TransformContext = { http, manifest, input: opts.input, signal };
  let output: unknown;
  try {
    output = await definition.run(opts.input as TInput, ctx);
  } catch (err) {
    if (err instanceof CancellationError) throw new TransformRunError("cancel", err.message, evidence);
    if (err instanceof TransformRunError) throw err;
    throw new TransformRunError("transform", err instanceof Error ? err.message : String(err), evidence);
  }
  // A run cancelled while the transform was computing is not a success.
  if (signal.aborted) {
    throw new TransformRunError("cancel", "cancelled during transform execution", evidence);
  }
  let validated: TransformOutput;
  try {
    validated = TransformOutputSchema.parse(output);
  } catch (err) {
    throw new TransformRunError("validation", err instanceof Error ? err.message : String(err), evidence);
  }
  return { output: validated, requestCount: evidence.filter((e) => e.status !== undefined).length, evidence };
}
