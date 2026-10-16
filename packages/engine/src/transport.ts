/**
 * Transport abstraction for transforms (5.8). The real HTTP path goes through the
 * egress gateway (ADR-08, P2-003) and is deliberately NOT implemented here: the
 * engine only depends on the narrow `HttpTransport` port so that tests can pass a
 * deterministic fake. The egress gateway contract is owned by ADR-08; the remaining
 * integration point is `EngineOptions.transport`.
 */
export interface TransportRequest {
  readonly method: "GET" | "HEAD" | "POST";
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  /**
   * Request body — allowed ONLY on the ADR-27 OAuth2 token POST (client-credentials, pinned auth
   * host, form-urlencoded body built from project secrets). Never recorded in evidence or audit.
   */
  readonly body?: string;
  /** Marks the request as the ADR-27 OAuth2 token request — the only legal POST. */
  readonly oauth2Token?: true;
}

export interface TransportResponse {
  readonly status: number;
  readonly body: ReadableStream<Uint8Array> | Uint8Array | string;
  readonly contentType?: string;
  /** Response headers (lower-cased keys), when the transport can provide them. */
  readonly headers?: Readonly<Record<string, string>>;
}

export type TransportErrorKind =
  | "transport:network"
  | "transport:timeout"
  | "transport:rate-limit"
  | "transport:dns"
  | "transport:ssrf-blocked"
  | "transport:http-error"
  | "transport:cancelled";

export class TransportError extends Error {
  readonly kind: TransportErrorKind;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  constructor(kind: TransportErrorKind, message: string, opts: { retryable?: boolean; retryAfterMs?: number } = {}) {
    super(message);
    this.name = "TransportError";
    this.kind = kind;
    this.retryable = opts.retryable ?? false;
    this.retryAfterMs = opts.retryAfterMs;
  }
}

export interface HttpTransport {
  fetch(req: TransportRequest, signal: AbortSignal): Promise<TransportResponse>;
}
