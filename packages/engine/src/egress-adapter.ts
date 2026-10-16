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
import type { EgressGateway, EgressRequest } from "@ir/egress";
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
    /** P2-039: fixed `host/path` pairs of the caller's own code (not case data); see the gateway's `staticPaths`. */
    staticPaths?: string[];
    /** P2-039: the total byte budget this transport's requests share, charged while each response is received. */
    byteBudget?: EgressRequest["byteBudget"];
  };
  /**
   * P2-016 (D-031): inject a provider key from the vault into the provider's header — never the
   * URL. The binding is the registry entry (hosts, ONE header, provider name, request paths) plus
   * a per-request reader: the credential is resolved fresh on EVERY request (a planning-time
   * snapshot would go stale), and an unavailable credential refuses the request fail-closed BEFORE
   * the gateway or transport is touched. The transform (sandboxed, above this boundary) never
   * sees the key and cannot override or strip the header: any header it sets whose name matches
   * the registry's (case-insensitively) is replaced by the injected one.
   */
  readonly secretBinding?: SecretBinding;
}

/** The trusted secret injection binding (see EgressAdapterOptions.secretBinding). */
export interface SecretBinding {
  /** The gateway's `secretProvider` name (the registry entry's name). */
  readonly secretProvider: string;
  /** Exact hosts this provider's secret may travel to (the registry entry's hosts). */
  readonly hosts: readonly string[];
  /** The ONE lowercase header the key travels in (the registry entry's header). */
  readonly secretHeader: string;
  /** Exact paths a secret-bearing request may target (the registry entry's request paths). */
  readonly requestPaths?: readonly string[];
  /** Reads the credential fresh per request; undefined = unavailable (fail-closed refusal). */
  readonly readSecret: () => string | undefined;
}

/**
 * P2-016: the injected header replaces any transform-supplied header of the same name
 * (case-insensitive — HTTP header names are case-insensitive, JS object keys are not).
 */
function injectSecretHeader(
  headers: Readonly<Record<string, string>> | undefined,
  secretHeader: string,
  secret: string,
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (name.toLowerCase() !== secretHeader) merged[name] = value;
  }
  merged[secretHeader] = secret;
  return merged;
}

/** P2-016: a provider response echoing the secret header back is redacted before it can reach evidence. */
function redactSecretHeader(
  headers: Readonly<Record<string, string>> | undefined,
  secretHeader: string,
): Record<string, string> | undefined {
  if (!headers) return undefined;
  const kept = Object.entries(headers).filter(([name]) => name.toLowerCase() !== secretHeader);
  return kept.length === 0 && Object.keys(headers).length > 0 ? {} : Object.fromEntries(kept);
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
  transport_error: "transport:network",
  content_encoding: "transport:http-error",
  // P2-039: the investigation's byte budget is a budget refusal, like the request budget.
  byte_budget: "transport:rate-limit",
};

/** The typed reason for a cancelled transport request (no fake success). */
export const EGRESS_ADAPTER_CANCELLED = "egress adapter request cancelled before a successful transport response";

/**
 * Returns an `HttpTransport` backed entirely by the egress gateway.
 * There is no fallback to `fetch` here; the gateway is the only path.
 */
/**
 * P2-016: apply the secret binding to one request. On a request to one of the binding's hosts the
 * credential is resolved fresh and attached — key in the registry's header only, never the URL,
 * with any transform-supplied header of that name replaced (case-insensitive). A host outside the
 * binding carries no secret at all. An unavailable credential refuses the request fail-closed
 * BEFORE the gateway (never a keyless request). Extracted to keep `fetch` within the lint
 * complexity budget.
 */
function applySecretBinding(
  req: TransportRequest,
  binding: SecretBinding | undefined,
): {
  headers?: Record<string, string>;
  secretFields: Partial<Pick<EgressRequest, "secret" | "secretProvider" | "pinnedHost">>;
  /** The raw secret when one was attached (for the response reflection guard); never logged. */
  secret?: string;
} {
  let headers = req.headers ? Object.fromEntries(Object.entries(req.headers)) : undefined;
  let secretFields: Partial<Pick<EgressRequest, "secret" | "secretProvider" | "pinnedHost">> = {};
  if (!binding) return { headers, secretFields };
  const host = hostOf(req.url);
  // A credentialed run is pinned to its provider (the manifest's pinned mode): a request to any
  // other host is refused, never silently sent keyless — the binding must not turn a pinned,
  // credentialed run into an unrestricted keyless one (robots.txt and other auxiliary fetches go
  // through their own transport, built without a binding).
  if (!binding.hosts.some((h) => h.toLowerCase() === host)) {
    throw new TransportError(
      "transport:ssrf-blocked",
      `the request to ${host || "(unparsable URL)"} is outside the pinned provider hosts (${binding.hosts.join(", ")}) of this credentialed run; refused`,
      { retryable: false },
    );
  }
  let secret: string | undefined;
  try {
    secret = binding.readSecret();
  } catch {
    // The reader's own error text is not propagated (it could carry anything); the refusal is
    // fail-closed with a fixed message.
    secret = undefined;
  }
  if (secret === undefined || secret === "") {
    // Fail-closed BEFORE the gateway: an unavailable credential is never a keyless request.
    throw new TransportError(
      "transport:ssrf-blocked",
      `secret for ${binding.secretProvider} is unavailable (vault entry missing or locked); the request is refused rather than sent without the key`,
      { retryable: false },
    );
  }
  headers = injectSecretHeader(headers, binding.secretHeader, secret);
  secretFields = { secret, secretProvider: binding.secretProvider, pinnedHost: host };
  return { headers, secretFields, secret };
}

/** True when the raw secret value appears anywhere in the response (body, headers — any case). */
function responseReflectsSecret(resp: { body?: unknown; headers?: Record<string, string> }, secret: string | undefined): boolean {
  if (secret === undefined) return false;
  const body = typeof resp.body === "string" ? resp.body : resp.body instanceof Uint8Array ? new TextDecoder().decode(resp.body) : "";
  if (body.includes(secret)) return true;
  return Object.entries(resp.headers ?? {}).some(([, value]) => value.includes(secret));
}

/** The request URL's lowercase hostname, or "" for a URL that does not parse. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function createEgressHttpTransport(opts: EgressAdapterOptions): HttpTransport {
  const { gateway } = opts;
  const base = opts.baseRequest ?? {};
  const binding = opts.secretBinding;
  return {
    async fetch(req: TransportRequest, signal: AbortSignal): Promise<TransportResponse> {
      // P2-016: on a request to one of the binding's hosts the credential is resolved fresh and
      // attached — key in the registry's header only, never the URL. The gateway (already
      // configured with the entry's providerHosts/providerPaths) pins the secret to those hosts
      // and paths and refuses any query on the wire (T-SEC-SSRF-042). A host outside the binding
      // carries no secret at all.
      const injected = applySecretBinding(req, binding);
      const result = await gateway.request({
        ...base,
        url: req.url,
        method: req.method,
        headers: injected.headers,
        // ADR-27 / ADR-28: a POST request body (the only legal POST kinds are the OAuth2 token
        // and the OpenSanctions screening — both host-pinned by the gateway). The gateway enforces
        // the pinned host (+path) and the fixed body shape; the body never enters evidence or audit.
        body: req.body,
        signal,
        ...injected.secretFields,
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
      // A response flagged as aborted is a late completion after cancellation: never a success.
      if (!resp || resp.aborted === true || signal.aborted) {
        throw new TransportError("transport:cancelled", EGRESS_ADAPTER_CANCELLED, { retryable: false });
      }
      // P2-016: credential-reflection guard. If the raw secret appears anywhere in the response —
      // the body, any header (a hostile or echoing origin), a Location — the response is REFUSED
      // (fail-closed): it must never reach the sandboxed transform or the recorded evidence.
      // The response is not rewritten: a body that echoes the credential is not accepted with the
      // echo scrubbed out, it is rejected outright.
      if (responseReflectsSecret(resp, injected.secret)) {
        throw new TransportError(
          "transport:ssrf-blocked",
          "the provider response echoed the credential; the response is refused rather than delivered or recorded",
          { retryable: false },
        );
      }
      return {
        status: resp.status,
        body: resp.body ?? "",
        contentType: resp.headers?.["content-type"] ?? resp.headers?.["Content-Type"],
        // P2-016: a response echoing the injected secret header is redacted here, before the
        // recording layer can persist it as evidence.
        headers: binding ? redactSecretHeader(resp.headers, binding.secretHeader) : resp.headers,
      };
    },
  };
}
