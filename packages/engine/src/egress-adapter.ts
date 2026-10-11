/**
 * Egress adapter (P2-001 / P2-003). Bridges the engine's narrow `HttpTransport`
 * port to the egress gateway. There is NO direct network path in this module:
 * every fetch is forwarded to the gateway, and any gateway denial surfaces as a
 * `TransportError` with a machine-readable kind so the engine can fail the run
 * with an understandable reason.
 *
 * SIMULATION ONLY in this cycle: the gateway is injected; there is no real
 * DNS, no real socket, no env var that enables the network.
 *
 * IMPORTANT: the gateway does NOT expose the response body to the engine in
 * this cycle — `EgressResult` is an allow/deny verdict, not a response. The
 * adapter therefore throws a typed TransportError when the gateway allows the
 * request: the caller must wire the real response through the transport
 * before the engine can consume it. This is documented in ADR-08 and tracked
 * as the remaining integration point (see WORKLOG).
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

/** The sentinel error thrown when the gateway allows a request. */
export const EGRESS_ADAPTER_NO_RESPONSE =
  "egress adapter reached the success path but the gateway contract does not return a response body in this cycle";

/**
 * Returns an `HttpTransport` backed entirely by the egress gateway.
 * There is no fallback to `fetch` here; the gateway is the only path.
 */
export function createEgressHttpTransport(opts: EgressAdapterOptions): HttpTransport {
  const { gateway } = opts;
  const base = opts.baseRequest ?? {};
  return {
    async fetch(req: TransportRequest, signal: AbortSignal): Promise<TransportResponse> {
      void signal; // The gateway owns the transport; the signal reaches it via its own timer.
      const result = await gateway.request({
        ...base,
        url: req.url,
        method: req.method,
        headers: req.headers ? Object.fromEntries(Object.entries(req.headers)) : undefined,
      });
      if (!result.ok) {
        const reason = result.reason ?? "unknown_field";
        const kind = REASON_TO_KIND[reason] ?? "transport:ssrf-blocked";
        const detail = result.detail ?? reason;
        throw new TransportError(kind, `egress denied: ${reason} (${detail})`, { retryable: false });
      }
      throw new TransportError("transport:http-error", EGRESS_ADAPTER_NO_RESPONSE, { retryable: false });
    },
  };
}
