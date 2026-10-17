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
import { createHash } from "node:crypto";
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
   * When true, refuse to run in-process: in-process execution provides no runtime
   * isolation. Set by production wiring that must not execute untrusted transforms
   * in-process. When `isolatedModule` is also provided, the run is routed to the
   * real sandbox (`runTransformIsolated`, P2-005) instead of being refused.
   */
  requireIsolation?: boolean;
  /**
   * Module path to run in the sandbox when `requireIsolation` is true. The module
   * is bundled (never executed in the parent) and spawned under seccomp +
   * namespaces; its network goes through the injected transport via IPC.
   */
  isolatedModule?: string;
  /** The transform id to select from `isolatedModule`'s exports. */
  transformId?: string;
  /** Minimum isolation the sandbox must provide (default "full"). */
  requireAssurance?: import("@ir/transform-sandbox").Assurance;
  /** Wall-clock backstop for the whole sandboxed run (default 30_000). */
  sandboxTimeoutMs?: number;
  /** Injectable clock for deterministic rate-limit tests. */
  now?: () => number;
  /** Injectable sleep for deterministic rate-limit tests. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /**
   * P2-036 — the clock that stamps each evidence record's fetch time (ISO 8601). Defaults to the wall clock; the
   * caller passes its case clock so evidence and ledger entries share one time source.
   */
  fetchedAt?: () => string;
}

/** A recorded request outcome: success (status/headers/body) or failure (error). */
export interface TransformEvidence {
  /**
   * P2-036 — run-local request id (0, 1, 2, ... in issue order), assigned before the request is sent. Findings cite
   * it (`TransformFinding.evidence`); records are appended when the request settles, so the array order is the
   * completion order and only this id says which request a record belongs to.
   */
  readonly requestId: number;
  /** When the outcome was recorded (ISO 8601, `RunTransformOptions.fetchedAt`): the fetch time of the evidence. */
  readonly fetchedAt: string;
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
export class RateLimiter {
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

/** A response from the recording transport: the transport's response plus the request id it was recorded under. */
export interface RecordedTransportResponse extends TransportResponse {
  readonly requestId: number;
}

/**
 * P2-036 — the evidence contract between a run's findings and its recorded requests. Applied by both runners after
 * the output passes `TransformOutputSchema`, so a run that does not satisfy it is a failure, never a success:
 *
 * - a request that failed (transport error, refusal, timeout, size limit, cancellation) fails the run even when the
 *   transform caught the error and returned normally: a swallowed failure must not become an empty or partial
 *   success (stage `request`, the failed request's own kind and message);
 * - once the run made a request, every finding says what it rests on: `evidence` (the `requestId` of each response
 *   it was derived from) or `derivedFrom: "input"`, never both, never neither (stage `validation`);
 * - every cited id names a request of this run that received a response (a status); an unknown id or a request
 *   without a response is refused (stage `validation`);
 * - a run that made no request has no response to cite: `evidence` is refused there.
 *
 * Nothing is inferred: a single-request run states its one id like any other run.
 */
export function checkFindingEvidence(output: TransformOutput, evidence: readonly TransformEvidence[]): void {
  const failed = evidence.find((e) => e.error !== undefined);
  if (failed?.error) {
    throw new TransformRunError(
      failed.error.kind === "cancel" ? "cancel" : "request",
      `request ${failed.requestId} failed (${failed.error.kind}) and the transform still returned an output: ${failed.error.message}`,
      [...evidence],
    );
  }
  const answered = new Set(evidence.filter((e) => e.status !== undefined).map((e) => e.requestId));
  output.findings.forEach((f, i) => {
    const where = `finding ${i} (${f.predicate} ${f.objectType})`;
    if (f.evidence !== undefined && f.derivedFrom !== undefined) {
      throw new TransformRunError("validation", `${where} cites both source responses and the input; it must cite one`, [...evidence]);
    }
    if (f.evidence === undefined) {
      if (evidence.length > 0 && f.derivedFrom === undefined) {
        throw new TransformRunError(
          "validation",
          `${where} cites no evidence: a run that makes requests must bind each finding to the response(s) it was derived from (evidence: [requestId]) or mark it derivedFrom "input"`,
          [...evidence],
        );
      }
      return;
    }
    for (const ref of f.evidence) {
      if (!answered.has(ref)) {
        throw new TransformRunError("validation", `${where} cites request ${ref}, which is not a recorded response of this run`, [
          ...evidence,
        ]);
      }
    }
  });
}

/** Wrap a transport so every request is counted, limited, and recorded as evidence. */
export function recordingTransport(
  transport: HttpTransport,
  evidence: TransformEvidence[],
  limiter: RateLimiter,
  timeoutMs: number,
  maxBytes: number,
  runSignal: AbortSignal,
  stamp: () => string = () => new Date().toISOString(),
  restrictedEvidence = false,
): HttpTransport {
  let nextRequestId = 0;
  return {
    async fetch(req: TransportRequest, _fetchSignal: AbortSignal): Promise<RecordedTransportResponse> {
      // P2-036: the id is fixed when the request is issued, before any await, so concurrent requests keep the id of
      // the call that made them whatever order they settle in.
      const requestId = nextRequestId++;
      // The transform's declared per-request timeout, combined with the run signal.
      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      const combined = AbortSignal.any([runSignal, timeoutSignal]);
      let recorded = false;
      const record = (e: Omit<TransformEvidence, "requestId" | "fetchedAt">) => {
        if (!recorded) {
          evidence.push({ requestId, fetchedAt: stamp(), ...e });
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
        // ADR-27 + ADR-28: a POST response body is NEVER recorded in evidence — the OAuth2
        // token response (the access token, a secret) and the OpenSanctions /match screening
        // response (candidate names, case data) both stay out of the records. The request body
        // is never recorded either (evidence carries no request bodies at all).
        if (req.method === "POST") {
          record({ url: req.url, method: req.method, status: res.status });
        } else if (restrictedEvidence) {
          // P2-026 (owner decision 2026-10-17 — TR-053): a restricted-evidence manifest keeps the
          // raw response OUT of the records (Brave's terms forbid storing Search Results). The
          // evidence body becomes the digest envelope — the sha256 of the exact raw response and
          // its byte count — so the record still proves WHAT was received without storing it.
          // The query (the URL), the time, the links (the findings) and the hash are stored;
          // nothing else. The size check above still ran on the RAW body (fail-closed).
          record({
            url: req.url,
            method: req.method,
            status: res.status,
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sha256: createHash("sha256").update(body).digest("hex"), bytes: body.length }),
          });
        } else {
          record({ url: req.url, method: req.method, status: res.status, headers: res.headers ?? {}, body });
        }
        return { ...res, requestId };
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
export async function runTransform<TInput>(
  definition: Transform<TInput> | undefined,
  opts: RunTransformOptions,
): Promise<RunTransformResult> {
  if (opts.requireIsolation === true) {
    if (opts.isolatedModule) {
      const { runTransformIsolated } = await import("./isolated.ts");
      return runTransformIsolated(opts.isolatedModule, {
        transport: opts.transport,
        input: opts.input,
        signal: opts.signal,
        transformId: opts.transformId,
        requireAssurance: opts.requireAssurance,
        sandboxTimeoutMs: opts.sandboxTimeoutMs,
        now: opts.now,
        fetchedAt: opts.fetchedAt,
        sleep: opts.sleep,
      });
    }
    throw new TransformRunError(
      "refused",
      "in-process execution provides no runtime isolation; pass isolatedModule to run in the sandbox (P2-005)",
      [],
    );
  }
  if (!definition) {
    throw new TransformRunError("refused", "a transform definition is required for in-process execution", []);
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
    recordingTransport(
      opts.transport,
      evidence,
      limiter,
      manifest.limits.timeoutMs,
      manifest.limits.maxBytes,
      signal,
      opts.fetchedAt,
      manifest.restrictedEvidence,
    ),
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
  checkFindingEvidence(validated, evidence);
  return { output: validated, requestCount: evidence.filter((e) => e.status !== undefined).length, evidence };
}
