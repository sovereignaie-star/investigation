import { TransportError, type HttpTransport, type TransportRequest, type TransportResponse } from "@ir/engine";

/**
 * Fail-closed engine transport for the server (P2-019). Until the egress gateway
 * (P2-003) and the isolation gates (P2-005) are approved, the engine must never
 * perform real network I/O from the server. This transport refuses every request
 * with `transport:ssrf-blocked` — the same fail-closed posture as the lookup routes.
 * Tests inject a deterministic fake transport instead.
 */
export const FAIL_CLOSED_TRANSPORT: HttpTransport = {
  async fetch(_req: TransportRequest, _signal: AbortSignal): Promise<TransportResponse> {
    throw new TransportError(
      "transport:ssrf-blocked",
      "engine network is disabled on this server until the egress gateway and isolation gates are approved",
    );
  },
};
