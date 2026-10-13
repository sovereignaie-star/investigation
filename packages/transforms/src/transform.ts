/**
 * P2-004 — transform interface (T-RULE-01/02/04).
 *
 * A transform receives a `TransformContext` whose only network path is `ctx.http`,
 * a narrow client backed by the engine's `HttpTransport` (which in production is
 * the egress gateway, ADR-08). Transforms never call `fetch` directly; the
 * `no-direct-network` static guard enforces this. URLs are built with `URL` /
 * `URLSearchParams` only (T-RULE-02), and every response is saved as evidence
 * before analysis (T-RULE-04) — the runner records each request/response pair.
 */
import type { HttpTransport, TransportResponse } from "@ir/engine/transport";
import type { TransformManifest } from "@ir/schema";
import type { TransformOutput } from "./output.ts";

/** The HTTP client a transform may use. Only GET/HEAD, matching the engine port. */
export interface TransformHttp {
  get(url: string, headers?: Readonly<Record<string, string>>): Promise<TransformHttpResponse>;
  head(url: string, headers?: Readonly<Record<string, string>>): Promise<TransformHttpResponse>;
}

/** A response as seen by a transform: status, headers, and body text. */
export interface TransformHttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/** The context handed to a transform's `run`. */
export interface TransformContext {
  /** The only network path (backed by the egress gateway in production). */
  readonly http: TransformHttp;
  /** The manifest of the running transform. */
  readonly manifest: TransformManifest;
  /** The canonical input the transform was invoked with. */
  readonly input: unknown;
}

/** A transform: a validated manifest plus a run function. */
export interface Transform<TInput = unknown> {
  readonly manifest: TransformManifest;
  readonly run: (input: TInput, ctx: TransformContext) => Promise<TransformOutput>;
}

/** Wrap an engine `HttpTransport` into the transform HTTP client. */
export function createTransformHttp(transport: HttpTransport): TransformHttp {
  const request = async (method: "GET" | "HEAD", url: string, headers?: Readonly<Record<string, string>>) => {
    const res: TransportResponse = await transport.fetch({ method, url, headers }, new AbortController().signal);
    const body = typeof res.body === "string" ? res.body : res.body instanceof Uint8Array ? new TextDecoder().decode(res.body) : "";
    return {
      status: res.status,
      headers: res.headers ?? {},
      body,
    } satisfies TransformHttpResponse;
  };
  return {
    get: (url, headers) => request("GET", url, headers),
    head: (url, headers) => request("HEAD", url, headers),
  };
}
