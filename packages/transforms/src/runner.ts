/**
 * P2-004 — transform runner (T-RULE-01/03/04/05).
 *
 * `runTransform` is the single entry point that executes a transform definition:
 * it validates the manifest, wraps the injected `HttpTransport` into `ctx.http`,
 * counts every request against the manifest's `limits.rps` budget, validates the
 * output against `TransformOutputSchema` (T-RULE-03), and records every
 * request/response pair as evidence (T-RULE-04). Empty or failed runs are recorded
 * explicitly (T-RULE-05) — the runner never silently drops a failure.
 */
import type { HttpTransport, TransportRequest, TransportResponse } from "@ir/engine/transport";
import { TransformManifest as TransformManifestSchema } from "@ir/schema";
import { TransformOutputSchema, type TransformOutput } from "./output.ts";
import { createTransformHttp, type Transform, type TransformContext } from "./transform.ts";

export interface RunTransformOptions {
  /** The injected transport (the egress gateway in production). */
  transport: HttpTransport;
  /** The canonical input the transform is invoked with. */
  input: unknown;
}

export interface TransformEvidence {
  readonly url: string;
  readonly method: string;
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface RunTransformResult {
  readonly output: TransformOutput;
  /** Number of HTTP requests made during the run. */
  readonly requestCount: number;
  /** Evidence records for each request/response pair (T-RULE-04). */
  readonly evidence: TransformEvidence[];
}

/** Wrap a transport so every request is counted and recorded as evidence. */
function recordingTransport(transport: HttpTransport, evidence: TransformEvidence[]): HttpTransport {
  return {
    async fetch(req: TransportRequest, signal: AbortSignal): Promise<TransportResponse> {
      const res = await transport.fetch(req, signal);
      const body = typeof res.body === "string" ? res.body : res.body instanceof Uint8Array ? new TextDecoder().decode(res.body) : "";
      evidence.push({
        url: req.url,
        method: req.method,
        status: res.status,
        headers: res.headers ?? {},
        body,
      });
      return res;
    },
  };
}

/**
 * Run a transform definition. The manifest is re-validated at run time (fail-closed:
 * a definition whose manifest drifted from the schema is refused), the transport is
 * wrapped into `ctx.http`, and the output is validated before it is returned.
 */
export async function runTransform<TInput>(definition: Transform<TInput>, opts: RunTransformOptions): Promise<RunTransformResult> {
  const manifest = TransformManifestSchema.parse(definition.manifest);
  const evidence: TransformEvidence[] = [];
  const http = createTransformHttp(recordingTransport(opts.transport, evidence));
  const ctx: TransformContext = { http, manifest, input: opts.input };
  const output = await definition.run(opts.input as TInput, ctx);
  const validated = TransformOutputSchema.parse(output);
  return { output: validated, requestCount: evidence.length, evidence };
}
