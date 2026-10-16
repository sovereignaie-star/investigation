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
 * P2-015 (D-032): a provider key test — a pinned host, an exact query-free path, and the header the
 * key travels in. No caller-supplied URL reaches the wire, and the gateway refuses any other path for
 * the provider's secret (T-SEC-SSRF-042) and any query on a secret-bearing request. The key NEVER
 * travels in the URL (D-031/P2-016). Endpoints and header names verified against each provider's
 * current official documentation (docs/security/KEY_TESTS.md carries the matrix with sources).
 */
export interface ProviderKeyTest {
  readonly host: string;
  readonly path: string;
  /** Lowercase header name the key travels in. */
  readonly keyHeader: string;
  /** "bearer" sends `<keyHeader>: Bearer <key>`; default sends the key raw. */
  readonly keyFormat?: "bearer";
  /** Fixed non-secret headers the provider requires on the test request (e.g. HIBP's user-agent). */
  readonly extraHeaders?: Readonly<Record<string, string>>;
}

export const PROVIDER_KEY_TESTS: Readonly<Record<string, ProviderKeyTest>> = {
  ipinfo: { host: "ipinfo.io", path: "/8.8.8.8", keyHeader: "authorization", keyFormat: "bearer" },
  virustotal: { host: "www.virustotal.com", path: "/api/v3/ip_addresses/8.8.8.8", keyHeader: "x-apikey" },
  haveibeenpwned: {
    host: "haveibeenpwned.com",
    path: "/api/v3/subscription/status",
    keyHeader: "hibp-api-key",
    // HIBP rejects requests without a descriptive user-agent with 403.
    extraHeaders: { "user-agent": "investigation-key-test/1.0" },
  },
  securitytrails: { host: "api.securitytrails.com", path: "/v1/ping", keyHeader: "apikey" },
  greynoise: { host: "api.greynoise.io", path: "/v3/community/8.8.8.8", keyHeader: "key" },
  binaryedge: { host: "api.binaryedge.io", path: "/v2/user/subscription", keyHeader: "x-key" },
  hunter: { host: "api.hunter.io", path: "/v1/account", keyHeader: "x-api-key" },
  urlscan: { host: "urlscan.io", path: "/api/v1/user/searches/", keyHeader: "api-key" },
};

/**
 * P2-024: how a provider reports its key's quota on the key-test response. DATA, per provider, with
 * each source documented in docs/security/KEY_TESTS.md. Two kinds:
 *
 * - `rate-limit-headers`: the provider documents rate-limit headers on every rate-limited response
 *   with EXACT semantics (limit + remaining for the action's tightest window) — the only kind a
 *   computed percentage (and the 80% alert) is derived from.
 * - `account-fields`: the provider documents usage fields on the account/test response but NOT the
 *   semantics of "available" (total allowance vs remaining) — the raw values are surfaced WITHOUT
 *   a computed percentage until the semantics are verified.
 *
 * Providers absent from this map report an honest status (see PROVIDER_QUOTA_UNSUPPORTED /
 * PROVIDER_QUOTA_UNVERIFIED) — missing data is never a zero balance.
 */
export type ProviderQuotaRead =
  | { readonly kind: "rate-limit-headers"; readonly headerPrefix: string }
  | { readonly kind: "account-fields"; readonly bodyFields: readonly string[] };

/** P2-024: providers whose official documentation reports NO usage/balance on the API (verified absence). */
export const PROVIDER_QUOTA_UNSUPPORTED: Readonly<Record<string, string>> = {
  ipinfo:
    "the official docs report no API usage/balance endpoint (Lite is unlimited; paid plans enforce a monthly limit with 429 + dashboard alerts, not API reporting)",
  securitytrails: "the official docs report no API usage/remaining-quota endpoint (email notifications only)",
  greynoise: "the official docs report no remaining-quota endpoint (the 429 response carries a rate-limit reason only)",
  haveibeenpwned: "the subscription status returns plan info and Rpm but NO usage/balance fields (verified against the official API docs)",
};

/** P2-024: providers whose quota reporting could NOT be verified this cycle (the reference pages were unreachable) — NOT "unsupported". */
export const PROVIDER_QUOTA_UNVERIFIED: Readonly<Record<string, string>> = {
  virustotal:
    "the user-level quota endpoints are documented to exist (/users/{id}/overall_quotas) but the response fields could not be verified against the official reference this cycle",
  binaryedge: "the subscription endpoint's documented response fields could not be verified against the official docs this cycle",
};

/**
 * P2-024: the quota reads with verified semantics.
 * - urlscan: the X-Rate-Limit-* headers (the official API docs document every header: Scope, Action,
 *   Window, Limit = "your rate-limit for this action and window", Remaining = "remaining calls for
 *   this action and window, not counting the current request", Reset, Reset-After).
 * - hunter: the account response's requests.* used/available + reset_date (the official docs show the
 *   fields but do NOT document what "available" means — total allowance vs remaining — so the raw
 *   values are surfaced without a computed percentage).
 */
export const PROVIDER_QUOTA: Readonly<Record<string, ProviderQuotaRead>> = {
  urlscan: { kind: "rate-limit-headers", headerPrefix: "x-rate-limit-" },
  hunter: {
    kind: "account-fields",
    bodyFields: [
      "requests.searches.used",
      "requests.searches.available",
      "requests.verifications.used",
      "requests.verifications.available",
      "reset_date",
    ],
  },
};

/** P2-024: the structured quota status (the advisor's metadata: provider, key, scope, action, window, read time, raw values, computed state). */
export interface QuotaStatus {
  /** Always true on this shape (the failure shape carries supported: false with a reason). */
  readonly supported: true;
  readonly provider: string;
  readonly readAt: string;
  readonly source: "rate-limit-headers" | "account-fields";
  /** urlscan: the header's scope (user/team) and the action+window the reported limit refers to. */
  readonly scope?: string;
  readonly action?: string;
  readonly window?: string;
  readonly limit?: number;
  readonly remaining?: number;
  /** Computed ONLY from verified semantics (urlscan's headers): the used fraction of the tightest window. */
  readonly usedPct?: number;
  /** True when usedPct >= 80 — the acceptance alert (surfaced in the key-management response). */
  readonly alert80?: boolean;
  /** hunter: the raw documented fields, surfaced without a percentage (the "available" semantics unverified). */
  readonly raw?: Record<string, unknown>;
}

/**
 * P2-024: parse the quota from a successful key-test response. The body/headers are read here and
 * NEVER returned raw to the client — only the parsed status is.
 */
/** Reads one rate-limit header case-insensitively by its suffix (limit, remaining, scope, ...). */
function rateHeader(headers: Record<string, string>, prefix: string, suffix: string): string | undefined {
  const wanted = `${prefix}${suffix}`.toLowerCase();
  for (const [k, v] of Object.entries(headers)) if (k.toLowerCase() === wanted) return v;
  return undefined;
}

/** urlscan-style: the documented rate-limit headers (limit + remaining for the tightest window). */
function parseRateLimitHeaders(
  name: string,
  headers: Record<string, string>,
  prefix: string,
  now: () => string,
): QuotaStatus | { supported: false; status: "not_supported"; reason: string } {
  const limit = Number(rateHeader(headers, prefix, "limit"));
  const remaining = Number(rateHeader(headers, prefix, "remaining"));
  if (!Number.isFinite(limit) || !Number.isFinite(remaining) || limit <= 0) {
    // the response carried no usable rate-limit headers — an honest refresh failure, never a zero balance
    return { supported: false, status: "not_supported", reason: "the key-test response carried no usable rate-limit headers" };
  }
  const usedPct = Math.round(((limit - remaining) / limit) * 100);
  const opt = (suffix: string) => {
    const v = rateHeader(headers, prefix, suffix);
    return v === undefined ? {} : { [suffix]: v };
  };
  return {
    supported: true,
    provider: name,
    readAt: now(),
    source: "rate-limit-headers",
    ...opt("scope"),
    ...opt("action"),
    ...opt("window"),
    limit,
    remaining: Math.max(0, remaining),
    usedPct,
    alert80: usedPct >= 80,
  };
}

/** hunter-style: the documented account fields, surfaced raw without a percentage (semantics unverified). */
function parseAccountFields(
  name: string,
  body: string | undefined,
  fields: readonly string[],
  now: () => string,
): QuotaStatus | { supported: false; status: "not_supported"; reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body ?? "");
  } catch {
    return { supported: false, status: "not_supported", reason: "the key-test response body was not readable JSON" };
  }
  const raw: Record<string, unknown> = {};
  for (const field of fields) raw[field] = deepGet(parsed, field);
  return { supported: true, provider: name, readAt: now(), source: "account-fields", raw };
}

/** Walks a dotted path ("requests.searches.used") and yields the value (undefined when absent). */
function deepGet(value: unknown, path: string): unknown {
  let cur: unknown = value;
  for (const part of path.split(".")) {
    if (cur && typeof cur === "object" && part in (cur as Record<string, unknown>)) cur = (cur as Record<string, unknown>)[part];
    else return undefined;
  }
  return cur;
}

export function parseQuotaStatus(
  name: string,
  response: { headers?: Record<string, string>; body?: string },
  now: () => string,
): QuotaStatus | { supported: false; status: "not_supported" | "not_verified"; reason: string } {
  const unsupported = PROVIDER_QUOTA_UNSUPPORTED[name];
  if (unsupported !== undefined) return { supported: false, status: "not_supported", reason: unsupported };
  const unverified = PROVIDER_QUOTA_UNVERIFIED[name];
  if (unverified !== undefined) return { supported: false, status: "not_verified", reason: unverified };
  const read = PROVIDER_QUOTA[name];
  if (!read) return { supported: false, status: "not_supported", reason: "no quota read defined for this provider" };
  if (read.kind === "rate-limit-headers") return parseRateLimitHeaders(name, response.headers ?? {}, read.headerPrefix, now);
  return parseAccountFields(name, response.body, read.bodyFields, now);
}

/**
 * P2-015 (D-032): providers whose key CANNOT be tested under the governing policies, each with its
 * documented reason. "حيث يمكن" — the acceptance criterion is met by an explicit, auditable reason,
 * never by a silent `{ ok: true, tested: false }`.
 */
export const PROVIDER_TEST_BLOCKED: Readonly<Record<string, string>> = {
  shodan:
    "key-in-URL only: the test endpoint (api.shodan.io/api-info) takes the key as a `key` query parameter and no header alternative exists; policy D-031/P2-016 forbids keys in URLs",
  etherscan: "key-in-URL only: api.etherscan.io/v2/api takes `apikey` as a query parameter; policy D-031/P2-016 forbids keys in URLs",
  whoisxml: "key-in-URL only: the API takes `apiKey` as a query parameter; policy D-031/P2-016 forbids keys in URLs",
  numverify: "key-in-URL only: the API takes `access_key` as a query parameter; policy D-031/P2-016 forbids keys in URLs",
  ipgeolocation: "key-in-URL only: the API takes `apiKey` as a query parameter; policy D-031/P2-016 forbids keys in URLs",
  abuseipdb:
    "no query-free testable endpoint: /api/v2/check needs `ipAddress` in the query (T-SEC-SSRF-042 forbids queries on secret-bearing requests) and the query-free /api/v2/blacklist response exceeds the vault gateway's size limit",
  clearbit:
    "no query-free testable endpoint: every key-bearing GET needs a required query parameter (domain/email) and the enrich endpoints are POST (ADR-27/28 restrict POST to pinned token/screening hosts)",
  fullcontact: "all key-bearing endpoints are POST (ADR-27/28 restrict POST to pinned token/screening hosts)",
  censys:
    "two-credential pair (API ID + secret over HTTP Basic): needs a pair storage contract in the vault (a storage design decision, tracked with P2-024 multi-key work)",
};

/**
 * Known provider names the vault UI lists. urlscan and etherscan are the vault-keyed integrated
 * transforms (TR-009, TR-017) — the vault lists the providers its transforms need.
 */
export const KNOWN_PROVIDERS = [
  "ipinfo",
  "virustotal",
  "haveibeenpwned",
  "shodan",
  "binaryedge",
  "greynoise",
  "securitytrails",
  "whoisxml",
  "abuseipdb",
  "hunter",
  "numverify",
  "ipgeolocation",
  "clearbit",
  "fullcontact",
  "censys",
  "urlscan",
  "etherscan",
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
    Object.fromEntries(Object.entries(PROVIDER_KEY_TESTS).map(([name, t]) => [name, { hosts: t.host, paths: [t.path] }])),
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
function keyTestHeaders(test: ProviderKeyTest, key: string): Record<string, string> {
  const headers: Record<string, string> = { accept: "application/json", ...test.extraHeaders };
  headers[test.keyHeader] = test.keyFormat === "bearer" ? `Bearer ${key}` : key;
  return headers;
}

/**
 * P2-015 (D-032): an untestable provider is never reported ok:true — a documented reason
 * (blocked policy) or an explicit no_test_defined is returned with tested:false.
 */
function resolveKeyTest(name: string): { refusal?: { ok: false; tested: false; reason: string }; test?: ProviderKeyTest } {
  const blocked = Object.prototype.hasOwnProperty.call(PROVIDER_TEST_BLOCKED, name) ? PROVIDER_TEST_BLOCKED[name] : undefined;
  if (blocked !== undefined) return { refusal: { ok: false, tested: false, reason: `test_not_possible: ${blocked}` } };
  const test = Object.prototype.hasOwnProperty.call(PROVIDER_KEY_TESTS, name) ? PROVIDER_KEY_TESTS[name] : undefined;
  if (!test) return { refusal: { ok: false, tested: false, reason: "no_test_defined" } };
  return { test };
}

/**
 * P2-024: the final contract of a key test — the provider's status plus, on success, the parsed quota
 * from the SAME response (no extra request, no extra quota consumption). The body/headers are read
 * here only; the parsed status is returned, never the raw response.
 */
function finalizeKeyTest(
  name: string,
  response: { status: number; headers?: Record<string, string>; body?: string } | undefined,
): {
  ok: boolean;
  tested: boolean;
  reason?: string;
  providerStatus?: number;
  quota?: QuotaStatus | { supported: false; status: string; reason: string };
} {
  const status = response?.status;
  if (response === undefined || status === undefined) return { ok: false, tested: false, reason: "provider_response_unavailable" };
  const ok = status >= 200 && status < 300;
  const quota = ok ? parseQuotaStatus(name, { headers: response.headers, body: response.body }, () => new Date().toISOString()) : undefined;
  return { ok, tested: true, providerStatus: status, reason: ok ? undefined : `provider_status_${status}`, ...(quota ? { quota } : {}) };
}

export async function testProviderKey(
  name: string,
  vault: Vault,
  transport: VaultEgressTransport,
  resolver: VaultDnsResolver,
): Promise<{
  ok: boolean;
  tested: boolean;
  reason?: string;
  providerStatus?: number;
  quota?: QuotaStatus | { supported: false; status: string; reason: string };
}> {
  const resolved = resolveKeyTest(name);
  if (resolved.refusal) return resolved.refusal;
  const test = resolved.test;
  if (!test) throw new Error("resolveKeyTest returned neither a refusal nor a test");
  const host = test.host;
  const key = vault.reveal(name);
  if (!key) return { ok: false, tested: false, reason: "no_key_saved" };

  if (!sharedVaultGateway || sharedVaultTransport !== transport || sharedVaultResolver !== resolver) {
    sharedVaultCapability = buildSharedVaultGateway(transport, resolver);
    sharedVaultTransport = transport;
    sharedVaultResolver = resolver;
  }
  if (!sharedVaultGateway || !sharedVaultCapability) throw new Error("vault gateway failed to build");
  const gateway = sharedVaultGateway;
  const cap: VaultKeyValidationCapability = sharedVaultCapability;

  const headers = keyTestHeaders(test, key);

  // The secret is sent in the designated header only (never URL, never
  // audit, never evidence). The gateway's own audit redacts the secret.
  const result: EgressResult = await gateway.request({
    systemContext: true,
    purposeRef: "vault-key-validation",
    transform: "vault.test@1",
    url: `https://${host}${test.path}`,
    method: "GET",
    headers,
    // both key-test paths carry a public IP (8.8.8.8); the gateway inspects the path (T-SEC-SSRF-043)
    sends: ["ip"],
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
  return finalizeKeyTest(name, result.response);
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
