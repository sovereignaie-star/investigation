/**
 * Egress adapter (P2-001 / P2-003). Bridges the engine's narrow `HttpTransport`
 * port to the egress gateway. There is NO direct network path in this module:
 * every fetch is forwarded to the gateway, and any gateway denial surfaces as a
 * `TransportError` with a machine-readable kind so the engine can fail the run
 * with an understandable reason.
 *
 * The gateway now returns a full `EgressSuccessResponse` (status/headers/body)
 * on the success path, so the adapter forwards the response body to the engine
 * instead of throwing. The `EGRESS_ADAPTER_NO_RESPONSE` sentinel is removed:
 * there is no fake error path anymore.
 *
 * Cancellation flows end-to-end: the engine's run signal is forwarded to
 * `gateway.request({ signal })`, and the gateway merges it with its per-hop
 * timer and overall deadline. A cancelled run NEVER resolves to a success, even
 * if the transport completes late.
 */
import type { EgressGateway } from "@ir/egress";
import { TransportError, type HttpTransport, type TransportRequest, type TransportResponse } from "./transport.ts";

export interface EgressAdapterOptions {
  /** The gateway instance to use. It is the ONLY network boundary. */
  readonly gateway: EgressGateway;
  /** Extra request fields the caller wants to attach to every fetch. */
  /** Fields the caller wants on every gateway request. `transform` is required. */
  readonly baseRequest: {
    caseId: string;
    purposeRef: string;
    transform: string;
    sends: string[];
    sensitivity: string;
    secret?: string;
    pinnedHost?: string;
    secretProvider?: string;
  };
}

/** Map an egress deny reason to a TransportError kind. */
const REASON_TO_KIND: Record<
  string,
  "transport:ssrf-blocked" | "transport:rate-limit" | "transport:timeout" | "transport:network" | "transport:dns" | "transport:http-error"
> = {
  offline: "transport:ssrf-blocked",
  no_case: "transport:ssrf-blocked",
  undeclared_data: "transport:ssrf-blocked",
  natural_person: "transport:ssrf-blocked",
  unclassified_data: "transport:ssrf-blocked",
  unclassifiable: "transport:ssrf-blocked",
  missing_manifest: "transport:ssrf-blocked",
  scheme: "transport:ssrf-blocked",
  port: "transport:ssrf-blocked",
  credentials: "transport:ssrf-blocked",
  header: "transport:ssrf-blocked",
  host_not_allowed: "transport:ssrf-blocked",
  secret_host_mismatch: "transport:ssrf-blocked",
  address_class: "transport:ssrf-blocked",
  redirect_limit: "transport:ssrf-blocked",
  size_limit: "transport:ssrf-blocked",
  timeout_total: "transport:timeout",
  timeout_connect: "transport:timeout",
  rate_limit: "transport:rate-limit",
  unknown_field: "transport:ssrf-blocked",
  invalid_url: "transport:ssrf-blocked",
  invalid_request: "transport:ssrf-blocked",
};

/** The typed reason for a cancelled transport request (no fake success). */
export const EGRESS_ADAPTER_CANCELLED = "egress adapter request cancelled before a successful transport response";

/**
 * Returns an `HttpTransport` backed entirely by the egress gateway.
 * There is no fallback to `fetch` here; the gateway is the only path.
 */
export function createEgressHttpTransport(opts: EgressAdapterOptions): HttpTransport {
  const { gateway } = opts;
  const base = opts.baseRequest ?? {};
  return {
    async fetch(req: TransportRequest, signal: AbortSignal): Promise<TransportResponse> {
      const result = await gateway.request({
        ...base,
        url: req.url,
        method: req.method,
        headers: req.headers ? Object.fromEntries(Object.entries(req.headers)) : undefined,
        signal,
      });
      if (!result.ok) {
        const reason = result.reason ?? "unknown_field";
        if (reason === "cancelled") {
          throw new TransportError("transport:cancelled", EGRESS_ADAPTER_CANCELLED, { retryable: false });
        }
        const kind = REASON_TO_KIND[reason] ?? "transport:ssrf-blocked";
        const detail = result.detail ?? reason;
        throw new TransportError(kind, `egress denied: ${reason} (${detail})`, { retryable: false });
      }
      const resp = result.response;
      if (!resp) {
        throw new TransportError("transport:cancelled", EGRESS_ADAPTER_CANCELLED, { retryable: false });
      }
      return {
        status: resp.status,
        body: resp.body ?? "",
        contentType: resp.headers?.["content-type"] ?? resp.headers?.["Content-Type"],
      };
    },
  };
}
