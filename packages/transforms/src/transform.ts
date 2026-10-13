/**
 * P2-004 — transform interface (T-RULE-01/02/04).
 *
 * A transform receives a `TransformContext` whose only network path is `ctx.http`,
 * a narrow client backed by the engine's `HttpTransport` (which in production is
 * the egress gateway, ADR-08). Transforms never call `fetch` directly; the
 * `no-direct-network` static guard enforces this. URLs are built with `URL` /
 * `URLSearchParams` only (T-RULE-02), and every response is saved as evidence
 * before analysis (T-RULE-04) — the runner records each request/response pair.
 *
 * Cancellation: the run's `AbortSignal` is threaded through the context and into
 * every `ctx.http` call, so a cancelled run aborts in-flight requests and a
 * response that arrives after cancellation is never accepted as a success.
 */
import { CancellationError } from "@ir/engine/cancel";
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
  /**
   * The run's cancellation signal. Aborted when the run is cancelled; every
   * `ctx.http` call is bound to it, and a response that arrives after it is
   * aborted is never accepted as a success.
   */
  readonly signal: AbortSignal;
}

/** A transform: a validated manifest plus a run function. */
export interface Transform<TInput = unknown> {
  readonly manifest: TransformManifest;
  readonly run: (input: TInput, ctx: TransformContext) => Promise<TransformOutput>;
}

/**
 * Wrap an engine `HttpTransport` into the transform HTTP client. The run's signal
 * is forwarded to the transport on every request, and a response that arrives
 * after the signal is aborted is refused (late-completion guard): a cancelled run
 * never resolves to a success at this layer either.
 */
export function createTransformHttp(transport: HttpTransport, signal?: AbortSignal): TransformHttp {
  const runSignal = signal ?? new AbortController().signal;
  const request = async (method: "GET" | "HEAD", url: string, headers?: Readonly<Record<string, string>>) => {
    const res: TransportResponse = await transport.fetch({ method, url, headers }, runSignal);
    // A response that arrives after cancellation is never a success, even if the
    // transport completed it (the engine enforces the same rule on its own path).
    if (runSignal.aborted) {
      throw new CancellationError("cancelled before the response was accepted");
    }
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
