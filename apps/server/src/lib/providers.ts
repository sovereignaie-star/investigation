// D-8 probe on main (never merged)
/**
 * Provider registry (P1-015, P2-003). Every outbound call in this module goes
 * through the egress gateway — there is NO direct `fetch` here. This implements
 * the owner's decision recorded in the D-8 review log (question 4, ADR-08-review-log.md):
 * `/api/vault/:name/test` is routed through the gateway "فوراً ضمن P2-003".
 *
 * The `VaultTransport` interface is what the egress gateway's `EgressTransport`
 * maps onto: it receives a PINNED host/IP and returns a status + body. It is a
 * narrow, typed contract — no `RequestInit`, no `Response`, no ambient `fetch`.
 *
 * SIMULATION ONLY in this cycle: the caller injects a fake transport in tests.
 * There is no code path that enables a real socket from this module.
 */
import { createEgressGateway, type EgressAuditEvent, type EgressResult, type DnsResolver, type EgressTransport } from "@ir/egress";
import { createVaultKeyValidationCapability, vaultGatewayOptions, type VaultKeyValidationCapability } from "@ir/egress/vault-capability";
import { logger } from "./logger";
import type { Vault } from "@ir/store";

/** The pinned transport the gateway hands a request to (an EgressTransport). */
export type VaultEgressTransport = EgressTransport;

/** A resolver so tests can pin a public address without real DNS (a DnsResolver). */
export type VaultDnsResolver = DnsResolver;

/**
 * The pinned provider destinations and the exact key-test request for each. No caller-supplied URL reaches the
 * wire, and the gateway refuses any other path for the provider's secret (T-SEC-SSRF-042).
 * - ipinfo: `GET https://ipinfo.io/8.8.8.8` with `Authorization: Bearer` (IP details endpoint).
 * - VirusTotal: `GET https://www.virustotal.com/api/v3/ip_addresses/8.8.8.8` with `x-apikey` (API v3 IP object).
 */
export const PROVIDER_TESTS: Readonly<Record<string, { readonly host: string; readonly path: string }>> = {
  ipinfo: { host: "ipinfo.io", path: "/8.8.8.8" },
  virustotal: { host: "www.virustotal.com", path: "/api/v3/ip_addresses/8.8.8.8" },
};

/** Known provider names the vault UI lists. */
export const KNOWN_PROVIDERS = [
  "ipinfo",
  "virustotal",
  "haveibeenpwned",
  "shodan",
  "binaryedge",
  "greynoise",
  "securitytrails",
  "whoisxml",
] as const;

/**
 * The function the vault route calls. It builds an egress gateway with a
 * pinned host for the provider, sends the secret as a header (never in the
 * URL), and returns the provider's ok/tested status. The secret is redacted
 * by the gateway's audit sink before any log is written.
 *
 * The `purposeRef` is a stable, non-case identifier because this is a
 * system-level key validation, not an investigation lookup (review log Q4).
 */
/**
 * The server's real vault audit sink. Every allowed/denied/timeout/size/rate
 * event is recorded as a structured log line (no secret, no raw URL if it
 * contains a secret-bearing header value). The gateway redacts the secret
 * itself before this sink is called, and the vault test path never places the
 * secret in a URL (it is in the designated header only).
 */
function makeVaultAuditSink() {
  return {
    record(event: EgressAuditEventShape) {
      // Never log the secret or any raw body from the provider.
      const safe = {
        kind: event.kind,
        reason: event.reason,
        transform: event.transform,
        host: event.host,
        method: event.method,
        transportCalls: event.transportCalls,
        detail: event.detail,
        systemContext: event.systemContext,
        secretDigest: event.secretDigest,
      };
      if (event.kind === "allowed" || event.kind === "transport_error" || event.kind === "rate_limited" || event.kind === "size_limit") {
        logger.info(safe, "vault egress audit");
      } else {
        logger.warn(safe, "vault egress audit");
      }
    },
  };
}

type EgressAuditEventShape = EgressAuditEvent;

/** Shared gateway so rate limits and the limiter's per-host token bucket are shared across requests. */
let sharedVaultGateway: ReturnType<typeof createEgressGateway> | undefined;
/** The capability bound to the shared gateway (so the request can reference the exact same object). */
let sharedVaultCapability: VaultKeyValidationCapability | undefined;
/** The transport/resolver the shared gateway was built for (identity). */
let sharedVaultTransport: VaultEgressTransport | undefined;
let sharedVaultResolver: VaultDnsResolver | undefined;

function buildSharedVaultGateway(transport: VaultEgressTransport, resolver: VaultDnsResolver): VaultKeyValidationCapability {
  const cap = createVaultKeyValidationCapability(
    Object.fromEntries(Object.entries(PROVIDER_TESTS).map(([name, t]) => [name, { hosts: t.host, paths: [t.path] }])),
    makeVaultAuditSink(),
  );
  const opts = vaultGatewayOptions(cap, resolver, transport, {
    maxRedirects: 1,
    maxSizeBytes: 10_000,
    timeoutMs: 10_000,
    connectTimeoutMs: 5_000,
    rateLimitPerHostPerSecond: 1,
    rateLimitBurst: 5,
  });
  sharedVaultGateway = createEgressGateway(opts);
  return cap;
}

/** The key travels only in the provider's designated header (never the URL). */
function keyTestHeaders(name: string, key: string): Record<string, string> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (name === "ipinfo") headers["authorization"] = `Bearer ${key}`;
  if (name === "virustotal") headers["x-apikey"] = key;
  return headers;
}

export async function testProviderKey(
  name: string,
  vault: Vault,
  transport: VaultEgressTransport,
  resolver: VaultDnsResolver,
): Promise<{ ok: boolean; tested: boolean; reason?: string; providerStatus?: number }> {
  const test = Object.prototype.hasOwnProperty.call(PROVIDER_TESTS, name) ? PROVIDER_TESTS[name] : undefined;
  if (!test) return { ok: true, tested: false };
  const host = test.host;
  const key = vault.reveal(name);
  if (!key) return { ok: false, tested: false };

  if (!sharedVaultGateway || sharedVaultTransport !== transport || sharedVaultResolver !== resolver) {
    sharedVaultCapability = buildSharedVaultGateway(transport, resolver);
    sharedVaultTransport = transport;
    sharedVaultResolver = resolver;
  }
  if (!sharedVaultGateway || !sharedVaultCapability) throw new Error("vault gateway failed to build");
  const gateway = sharedVaultGateway;
  const cap: VaultKeyValidationCapability = sharedVaultCapability;

  const headers = keyTestHeaders(name, key);

  // The secret is sent in the designated header only (never URL, never
  // audit, never evidence). The gateway's own audit redacts the secret.
  const result: EgressResult = await gateway.request({
    systemContext: true,
    purposeRef: "vault-key-validation",
    transform: "vault.test@1",
    url: `https://${host}${test.path}`,
    method: "GET",
    headers,
    sends: ["domain"],
    sensitivity: "normal",
    secret: key,
    pinnedHost: host,
    secretProvider: name,
    capability: cap,
  });
  if (!result.ok) {
    return { ok: false, tested: false, reason: result.reason };
  }
  // The response contract is now complete: the gateway returns the provider's
  // HTTP status (the FINAL hop, post-redirect). Report the provider status so
  // the caller can distinguish a valid key (2xx) from an invalid one
  // (401/403) or an upstream fault (5xx). The body is NOT returned — it may
  // contain provider-specific data that is out of scope for this route.
  const status = result.response?.status;
  if (status === undefined) return { ok: false, tested: false, reason: "provider_response_unavailable" };
  const ok = status >= 200 && status < 300;
  return { ok, tested: true, providerStatus: status, reason: ok ? undefined : `provider_status_${status}` };
}

/**
 * Fail-closed (P2-003 / C): the two keyed lookup routes (ipinfo ip-lookup,
 * haveibeenpwned breachedaccount) are DISABLED until their dedicated gateway
 * capability exists. Direct fetch is PROHIBITED anywhere in the server. The
 * automated check (`scripts/checks/no-direct-network.test.ts`) fails if a new
 * direct network path appears outside `packages/egress`.
 */
export const LOOKUPS_GATEWAY_PENDING = {
  error: "external lookups are routed through the egress gateway (pending); direct fetch is prohibited",
} as const;
