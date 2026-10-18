/**
 * Egress gateway (P2-003 / ADR-08). The gateway is a policy boundary that decides, based on a request contract,
 * whether a transport call is allowed, and enforces limits. It performs no I/O of its own: the resolver and the
 * transport are injected. The real ones (system-resolver.ts, node-transport.ts) are joined to it in exactly one
 * place, production.ts, which is off unless `IR_ENABLE_NETWORK=1` and always restricted to an explicit host list;
 * its single caller is `ir run --network` (packages/cli). The server keeps FAIL_CLOSED_TRANSPORT (its engine has
 * no case or evidence store) and the vault test path keeps its injected transport. No env var here enables the
 * network, and `IR_OFFLINE=1` refuses every request.
 *
 * This module is intentionally self-contained and side-effect-free outside the
 * injected `resolver` / `transport` / `auditSink` / `now` functions.
 */
import { isByteBudget, isRequestBudget, type ByteBudget, type RequestBudget } from "./byte-budget.ts";
import {
  crossHostHeaders,
  inventoryRequest,
  judgeInventory,
  redirectContentVerdict,
  sentValues,
  STATIC_PATH_ENTRY,
} from "./content-inventory.ts";

/** Upper bound on `staticPaths` entries per request (a list of fixed files, not a policy). */
const MAX_STATIC_PATHS = 16;
import { createHmac, randomBytes } from "node:crypto";
import { domainToASCII } from "node:url";
import { classifyAddress } from "./address-policy";

export type EgressReason =
  | "offline"
  | "no_case"
  | "undeclared_data"
  | "natural_person"
  | "unclassified_data"
  | "unclassifiable"
  | "missing_manifest"
  | "scheme"
  | "port"
  | "credentials"
  | "header"
  | "host_not_allowed"
  | "secret_host_mismatch"
  | "address_class"
  | "redirect_limit"
  | "size_limit"
  | "timeout_total"
  | "timeout_connect"
  | "rate_limit"
  | "unknown_field"
  | "invalid_url"
  | "invalid_request"
  | "cancelled"
  /** The transport failed for a reason that is not a policy decision (connection reset, TLS failure, ...). */
  | "transport_error"
  /** The response used a content-encoding the gateway does not decode, or too many stacked layers. */
  | "content_encoding"
  /**
   * P2-039: the request's shared byte budget (`byteBudget`) is exhausted, or receiving this response would pass it.
   * Refused before DNS when nothing is left; otherwise the transport stops reading at the chunk that would overflow.
   */
  | "byte_budget"
  /**
   * P2-041: the shared request budget (`requestBudget`) is exhausted — a hop (first or redirect) was refused
   * before its DNS because the investigation's total request budget has nothing left.
   */
  | "request_budget"
  /**
   * ADR-31 (P2-028): the configured proxy cannot be used — its host does not resolve, or its address
   * is refused by the address policy (fail-closed: the request fails, there is NO fallback to direct).
   */
  | "proxy_unreachable"
  /**
   * ADR-31 (P2-028): the Tor sensitive-domain blocklist refused the host (localhost, *.local,
   * *.internal, and every private/loopback/link-local address) — fail-closed before any budget or DNS.
   */
  | "tor_blocklist"
  /** ADR-31 (P2-028): the proxy tunnel failed (connect/handshake/auth) — fail-closed, never a direct fallback. */
  | "proxy";

export const EGRESS_DENY_CODE = "EGRESS_POLICY_DENIED" as const;
/** @deprecated Use `EGRESS_DENY_CODE` (the const value) or `EgressReason`. */
export type EgressDenyCode = typeof EGRESS_DENY_CODE;

export interface EgressRequest {
  caseId?: string;
  purposeRef?: string;
  /**
   * System-level request (vault key validation, health checks). When true, the
   * request is exempt from the caseId requirement but MUST have a purposeRef
   * and a pinnedHost + secretProvider if a secret is sent. Recorded in the
   * audit sink with systemContext=true (review log Q4, ADR-08).
   */
  systemContext?: boolean;
  transform: string;
  url: string;
  method?: "GET" | "HEAD" | "POST";
  headers?: Record<string, string>;
  /**
   * ADR-27 / ADR-28: a POST request body. Two legal POST kinds exist, both routed by the pinned
   * host (and path): an OAuth2 client-credentials token body (form-urlencoded, built from project
   * secrets) to a gateway-pinned auth host, or an OpenSanctions /match screening body (a fixed
   * JSON schema built from the subject's name) to a gateway-pinned screening host. Neither body
   * is ever recorded in evidence or audit; the content inventory inspects the body like headers.
   */
  body?: string;
  sends?: string[];
  sensitivity?: string;
  secret?: string;
  /** Pin the destination host (pinned mode / secret transport). */
  pinnedHost?: string;
  /** Provider registry that a `secret` must be bound to. */
  secretProvider?: string;
  /**
   * P2-039: exact `host/path` pairs (or `*` + `/path`) whose path is a constant of the CALLER's code, not case data
   * (`data.iana.org/rdap/ipv4.json`, or `*` + `/robots.txt`). Only the path surface of a matching URL is
   * exempt from the content inventory; its query, fragment and headers are inspected as always, and a natural-person
   * reading is never exempt. Set by trusted parent code, never by a sandboxed transform. See `isStaticPath`.
   */
  staticPaths?: string[];
  /**
   * P2-039: a total byte budget shared with other requests (one investigation). Charged while the response is
   * received; a request starts only while bytes remain, and fails `byte_budget` at the chunk that would pass it.
   */
  byteBudget?: ByteBudget;
  /**
   * P2-041: a total request budget shared with other requests (one investigation), counted PER HOP inside the
   * gateway's redirect loop (the first hop and every redirect). One is taken before each hop's DNS; a hop that
   * would pass the limit is refused with `request_budget`, so `state.requests` matches every actual transport
   * call and no redirect starts after exhaustion.
   */
  requestBudget?: RequestBudget;
  /**
   * Caller-provided AbortSignal. Cancels the whole request (DNS + transport) at
   * any hop; the signal is merged with the per-hop connect timer and the
   * overall deadline. A cancelled request NEVER resolves to a success, even if
   * the transport completes late.
   */
  signal?: AbortSignal;
  /**
   * Private vault-key-validation capability. NOT part of the public request
   * contract: the field is only reachable through `vault-capability.ts`, which
   * is not exported from `src/index.ts`. The gateway ignores `systemContext: true`
   * alone — the capability object itself must be attached by the caller.
   */
  capability?: unknown;
}

export interface EgressResult {
  readonly ok: boolean;
  readonly code?: typeof EGRESS_DENY_CODE;
  readonly reason?: EgressReason;
  readonly detail?: string;
  /** Number of transport calls made (0 for any pre-transport denial). */
  readonly transportCalls: number;
  /** Pinned IP handed to the transport (present only when transport was called). */
  readonly pinnedIp?: string;
  /**
   * Successful transport response (present only when ok=true and the transport
   * completed). status/headers/body are the FINAL hop's response, after redirect
   * resolution, within `maxSizeBytes`. Body length is measured post-decompression.
   */
  readonly response?: EgressSuccessResponse;
}

/** Successful transport response forwarded to the engine/server (ADR-08 contract). */
export interface EgressSuccessResponse {
  readonly status: number;
  readonly headers?: Record<string, string>;
  readonly body?: string;
  readonly contentLength?: number;
  /** Host actually served the response (post-redirect, post-DNS, validated). */
  readonly host: string;
  /** True when the request was aborted (late completion after cancellation). */
  readonly aborted?: boolean;
}

/** Injectable DNS resolver (tests pass a fake). */
export interface DnsResolver {
  resolve(host: string): Promise<string[]>;
}

/**
 * Injectable transport (tests pass a fake). Gets a PINNED address. The transport
 * is responsible for honouring an `AbortSignal` if the caller passes one.
 */
export interface EgressTransport {
  fetch(req: {
    url: string;
    host: string;
    /** Pinned target IP (already address-policy-checked). For a proxy route this is the PROXY's pinned IP. */
    pinnedIp: string;
    /** ADR-31 (P2-028): the route this request takes — informational for the transport. */
    route?: EgressRoute;
    /** ADR-31 (P2-028): the proxy tunnel to use (undefined = direct — the transport connects to the pinned IP itself). */
    proxy?: EgressProxyTunnel;
    method: string;
    headers?: Record<string, string>;
    /** ADR-27: the OAuth2 token POST body (the only request body that ever exists). */
    body?: string;
    signal?: AbortSignal;
    /**
     * P2-039: the gateway's per-response cap (`maxSizeBytes`) for this hop. A streaming transport stops reading past
     * it (`size_limit`); the gateway also re-checks the delivered body.
     */
    maxBodyBytes?: number;
    /**
     * P2-039: charge `n` bytes just read off the wire against the request's byte budget. `false` means the chunk
     * would pass the budget: the transport must stop reading and reject with `EgressTransportError("byte_budget")`.
     * Absent when the request has no budget. Bytes a transport does not meter are charged by the gateway when the
     * response is delivered (and refused then if they do not fit).
     */
    meter?: (n: number) => boolean;
  }): Promise<{ status: number; body?: string; headers?: Record<string, string>; contentLength?: number }>;
}

/**
 * Audit sink. Called with the outcome of every `request()` call, accepted or
 * denied, including transport errors, timeouts and rate-limit hits. Must NOT
 * receive raw secret values — `secret` fields are always redacted to a stable
 * digest prefix before this sink is invoked.
 */
export interface EgressAuditSink {
  record(event: EgressAuditEvent): void;
}

export interface EgressAuditEvent {
  readonly kind: "allowed" | "denied" | "transport_error" | "timeout" | "rate_limited" | "size_limit" | "transport";
  readonly reason?: EgressReason;
  readonly caseId?: string;
  readonly transform?: string;
  readonly host?: string;
  readonly method?: string;
  readonly transportCalls: number;
  readonly detail?: string;
  /** ADR-31 (P2-028): the route this event's request took — injected on every recorded event. */
  readonly route?: EgressRoute;
  /** Present on `transport` events (P2-014): the URL of the actual transport call, secret-redacted. */
  readonly url?: string;
  /** Present on `transport` events (P2-014): the HTTP status the call returned. */
  readonly status?: number;
  /** Present on `transport` events (P2-014): the failure message when the attempt failed. */
  readonly error?: string;
  /** Present on `transport` events (P2-014): the 1-based hop index of the attempt. */
  readonly attempt?: number;
  /** True when the request was a system-level request (no caseId). */
  readonly systemContext?: boolean;
  /** Placeholder for a redacted secret digest. Never the raw secret. */
  readonly secretDigest?: string;
}

export interface EgressLimits {
  readonly maxRedirects?: number; // default 3
  readonly maxSizeBytes?: number; // default 5 MB
  readonly timeoutMs?: number; // default 15000 (whole request, all hops)
  readonly connectTimeoutMs?: number; // default 5000 (per hop)
  readonly rateLimitPerHostPerSecond?: number; // default 1 (temporary; ADR-08)
  readonly rateLimitBurst?: number; // default 4
  /** ADR-31 (P2-028): Tor's own separate LOWER rate budget — a route of last resort is never as fast as direct. */
  readonly torRateLimitPerHostPerSecond?: number; // default 0.2 (one request per 5s sustained)
  readonly torRateLimitBurst?: number; // default 1
}

/**
 * ADR-31 (P2-028): the network route a request took. Every audit event records it — «كل طلب يسجّل مساره».
 * `direct` is the ADR-08 default (pinned IP, local DNS); the proxy routes are the strict mode
 * (the PINNED TARGET IP is sent — the proxy relays bytes and never resolves DNS); `tor` is the ONE
 * explicit exception (the DOMAIN is sent — the essence of Tor).
 */
export type EgressRoute = "direct" | "proxy-http-connect" | "proxy-socks5" | "tor";

/**
 * ADR-31 (P2-028): the proxy tunnel the transport was asked to use. The gateway resolved and
 * policy-checked the proxy itself (`proxyIp`); the target is either the PINNED IP (strict mode —
 * the proxy never resolves it) or the DOMAIN (Tor — the exit resolves it, never us).
 */
export interface EgressProxyTunnel {
  readonly kind: "http-connect" | "socks5";
  /** The proxy's own pinned IP (resolved locally and policy-checked by the gateway — never the proxy's word). */
  readonly proxyIp: string;
  readonly proxyPort: number;
  readonly credentials?: { readonly username: string; readonly password: string };
  /**
   * Strict mode: `{ kind: "ip", ip }` — the pinned target IP. Tor: `{ kind: "host", host }` — the domain.
   * The proxy is handed ONLY this; it relays bytes.
   */
  readonly target: { readonly kind: "ip"; readonly ip: string } | { readonly kind: "host"; readonly host: string };
}

/**
 * ADR-31 (P2-028): this gateway's routing — the strict default for HTTP CONNECT and SOCKS5 non-Tor
 * proxies, and the explicit Tor exception. Credentials travel through the vault, never in events.
 * `undefined` means `direct` (the ADR-08 default); Tor is NEVER implicit.
 */
export interface EgressRouting {
  readonly route: "proxy-http-connect" | "proxy-socks5" | "tor";
  readonly proxy: {
    readonly host: string;
    readonly port: number;
    readonly credentials?: { readonly username: string; readonly password: string };
  };
}

/**
 * P2-016 continuation (owner decision 2026-10-16): one permitted query parameter on a
 * secret-bearing request to a provider. The registry data (packages/egress/providers/) states each
 * item explicitly; the docs/security/KEY_TESTS.md matrix carries each parameter's source.
 */
import type { PostPolicy } from "./post-policy.ts";
import { formSchemaError, jsonSchemaError, POST_POLICY_DEFAULT_MAX_BODY_BYTES } from "./post-policy.ts";
import type { PathParameterTemplate } from "./path-template.ts";
import { matchPathTemplate } from "./path-template.ts";

export interface ProviderQueryAllow {
  /** The exact parameter name (URL query parameters are case-sensitive). */
  readonly param: string;
  /** The declared value type: "string" (any text) or "number" (non-negative digits only). */
  readonly type: "string" | "number";
  /** The declared maximum length of the DECODED value (our bound, stated in the registry data). */
  readonly maxLength: number;
}

export interface EgressOptions {
  /** Must be provided. Tests set it explicitly; no env var can enable the network. */
  readonly resolver: DnsResolver;
  readonly transport: EgressTransport;
  readonly limits?: EgressLimits;
  readonly now?: () => number;
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly auditSink?: EgressAuditSink;
  /** Force offline mode. `IR_OFFLINE=1` in the environment has the same effect and cannot be overridden here. */
  readonly offline?: boolean;
  /**
   * When provided, every request's destination host (or its pinnedHost when
   * set) must be on this list. Used by the vault test path so that only
   * provider hosts can ever be reached (T-SEC-SSRF-045, review log Q4).
   */
  readonly allowedHosts?: readonly string[];
  /** ADR-31 (P2-028): this gateway's routing — undefined = direct (the default); Tor is never implicit. */
  readonly routing?: EgressRouting;
  /** Private capability used only by the vault path (see vault-capability.ts). */
  readonly capability?: unknown;
  /**
   * Provider registry for secret-bearing (pinned) requests: provider name -> exact hosts. A request carrying a
   * `secret` must name a `secretProvider` present here and a `pinnedHost` on that provider's list, otherwise it is
   * denied with `secret_host_mismatch` before DNS (ADR-08 section 3, T-SEC-SSRF-041). No registry = no secret
   * request is ever allowed (fail-closed).
   */
  readonly providerHosts?: Readonly<Record<string, readonly string[]>>;
  /**
   * Provider name -> exact URL paths a secret of that provider may be sent to (T-SEC-SSRF-042). When set, a secret
   * request whose path (on any hop) is not listed, or that carries a query or fragment, is refused, and a provider
   * missing from the map is refused too. Unset means no path restriction (hosts are still checked).
   */
  readonly providerPaths?: Readonly<Record<string, readonly string[]>>;
  /**
   * P2-026 (owner decision 2026-10-17 — the adopted path-parameter proposal, ADR-30 style):
   * provider name -> the CLOSED path templates a secret of that provider may be sent to. A provider
   * whose endpoints carry the SUBJECT in the request path (VT, GreyNoise, OTX, SecurityTrails) is
   * declared as template rows in the policy table (providers/post-policies.ts); the gateway matches
   * the request path against them and validates every parameter centrally against a CLOSED type
   * vocabulary with a declared max length (path-template.ts) — not each transform. The templates are
   * method-bound (GET) and full-path (no prefixes, no wildcards); a mismatch is refused fail-closed
   * exactly like the literal list. A provider may declare literals, templates, or both.
   */
  readonly providerPathTemplates?: Readonly<Record<string, readonly PathParameterTemplate[]>>;
  /**
   * P2-016 continuation (owner decision 2026-10-16): provider name -> the CLOSED list of query
   * parameters a secret-bearing request to that provider may carry (name + value type + declared
   * max length). A provider absent from the map, or with an empty list, refuses EVERY query (the
   * unchanged fail-closed default). A parameter outside the list, a repeated parameter, a value over
   * the declared max length, or a value that does not match the declared type is refused before any
   * transport call. The allowlist data lives in the provider registry (packages/egress/providers/)
   * next to the provider definition, with each parameter's source documented.
   */
  readonly providerQueries?: Readonly<Record<string, readonly ProviderQueryAllow[]>>;
  /**
   * ADR-30 (owner decision 2026-10-17): the unified POST policy table — one complete record per
   * legal POST (pinned host+path, kind, format, FIXED body schema, size cap). The gateway
   * enforces it centrally (`checkRegisteredPost`); a POST to anything outside this table is
   * refused fail-closed. The table itself is DATA (packages/egress/providers/post-policies.ts);
   * adding a provider = a new row + a small PR (no separate ADR — ADR-30 §6). Unset or empty =
   * no POST is ever allowed.
   */
  readonly postPolicies?: readonly PostPolicy[];
}

/**
 * Typed transport failures. A transport (see node-transport.ts) throws one of these so the gateway can report a
 * precise reason instead of a generic failure. Any other thrown value maps to `transport_error`.
 */
export class EgressTransportError extends Error {
  readonly reason: "size_limit" | "content_encoding" | "transport_error" | "byte_budget" | "proxy";
  constructor(reason: "size_limit" | "content_encoding" | "transport_error" | "byte_budget" | "proxy", message: string) {
    super(message);
    this.name = "EgressTransportError";
    this.reason = reason;
  }
}

/**
 * Host normalisation used for every list comparison (ADR-08 section 3): IDNA to punycode (UTS-46 via WHATWG
 * `domainToASCII`), lower case, no trailing dot, no wildcards. Returns "" for a value that is not a valid host,
 * which never matches anything (fail-closed).
 */
export function normalizeHost(host: string): string {
  const bare = host.trim().replace(/^\[|\]$/g, "");
  if (bare === "" || /[*\s/]/.test(bare)) return "";
  if (bare.includes(":")) return bare.toLowerCase(); // IPv6 literal: never punycoded
  const ascii = domainToASCII(bare.replace(/\.$/, ""));
  return ascii.replace(/\.$/, "").toLowerCase();
}

const DEFAULT_LIMITS: Required<Omit<EgressLimits, never>> = {
  maxRedirects: 3,
  maxSizeBytes: 5 * 1024 * 1024,
  timeoutMs: 15_000,
  connectTimeoutMs: 5_000,
  // P2-003 condition 14 (ADR-08 item و), measured 2026-10-15 (rate-measurement.test.ts, real clock):
  // the burst follows the strictest source the platform actually talks to — Nominatim's usage policy
  // is an ABSOLUTE 1 request/second (no burst allowance), so the operational burst is 1: at most one
  // leave per host per second, further requests refused explicitly (rate_limit), the bucket refills
  // at 1/s. Bulk one-shot sources (OFAC/UN/EU) are unaffected; engine concurrency (4) is orthogonal.
  rateLimitPerHostPerSecond: 1,
  // ADR-31 (P2-028): Tor's own separate LOWER budget — a route of last resort is never as fast as direct.
  // A fractional refill rate is deliberate (one request per 5s sustained); the burst is 1.
  torRateLimitPerHostPerSecond: 0.2,
  torRateLimitBurst: 1,
  rateLimitBurst: 1,
};

/** Data kinds that are allowed in `sends` for the public mode before P2-013. */
const PUBLIC_ALLOWED_SENDS = new Set(["domain", "ip", "asn", "hash", "url", "certificate"]);

/**
 * E-02 (P2-013): the extra `sends` kinds a natural-person-subject run may declare. The subject (the name
 * the operator typed) never appears in a URL, header or body: the person transforms download fixed files
 * and match locally, so `person_name` in `sends` is a marker of the gated run, not wire data.
 */
const PERSON_SUBJECT_SENDS = new Set(["person_name"]);

/** Fields allowed on `EgressRequest` at runtime (closed contract). */
const REQUEST_FIELDS = new Set([
  "caseId",
  "purposeRef",
  "transform",
  "url",
  "method",
  "headers",
  "sends",
  "sensitivity",
  "secret",
  "pinnedHost",
  "secretProvider",
  "systemContext",
  "signal",
  "capability",
  "staticPaths",
  "body",
  "byteBudget",
  "requestBudget",
]);

/** Returns true only when `req.capability` is one of the gateway's registered vault capabilities. */
function hasVaultCapability(opts: EgressOptions, req: EgressRequest): boolean {
  if (opts.capability === undefined || req.capability === undefined) return false;
  // Exact object identity is required — a forged object or a copy is rejected.
  return req.capability === opts.capability;
}

function deny(reason: EgressReason, transportCalls = 0, detail?: string): EgressResult {
  return { ok: false, code: EGRESS_DENY_CODE, reason, transportCalls, detail };
}

/** Create a stable, non-reversible digest prefix for a secret (never log the secret). */
/**
 * Redact a secret to a stable, non-reversible digest prefix for the audit log.
 * Uses HMAC-SHA256 keyed by an audit-only random key generated once per
 * gateway instance (never persisted). FNV-1a was rejected: it is invertible
 * for short token shapes and is not a MAC, so an attacker with log access
 * could correlate or brute-force the raw secret. The key is fresh per process
 * so a leaked digest cannot be correlated across restarts, and no secret bytes
 * ever reach the log.
 */
const AUDIT_SECRET_REDACT_KEY = randomBytes(32);
/** Replace every occurrence of the secret (raw and percent-encoded) in a free-text detail. */
function redactInText(text: string, secret: string): string {
  if (secret === "") return text;
  return text.split(secret).join("[secret]").split(encodeURIComponent(secret)).join("[secret]");
}

function redactSecret(secret: string): string {
  const mac = createHmac("sha256", AUDIT_SECRET_REDACT_KEY).update(secret, "utf8").digest("hex");
  return `redacted-hmac-sha256-${mac.slice(0, 16)}`;
}

/**
 * Validate the limits at construction. Any unknown / non-numeric / non-positive
 * field causes a RangeError, so a caller cannot silently widen the policy.
 */
function validateLimits(raw: EgressLimits | undefined): Required<EgressLimits> {
  const out = { ...DEFAULT_LIMITS, ...(raw ?? {}) };
  const allowed = new Set([
    "maxRedirects",
    "maxSizeBytes",
    "timeoutMs",
    "connectTimeoutMs",
    "rateLimitPerHostPerSecond",
    "rateLimitBurst",
    // ADR-31 (P2-028): Tor's separate LOWER budget.
    "torRateLimitPerHostPerSecond",
    "torRateLimitBurst",
  ]);
  if (raw) {
    for (const k of Object.keys(raw)) {
      if (!allowed.has(k)) throw new RangeError(`EgressOptions.limits.${k} is not a known limit`);
    }
  }
  // Refill RATES may be fractional (a request every 5s = 0.2/s); everything else is a positive integer.
  const fractionalAllowed = new Set(["rateLimitPerHostPerSecond", "torRateLimitPerHostPerSecond"]);
  for (const [k, v] of Object.entries(out)) {
    if (!Number.isFinite(v) || v <= 0 || (!fractionalAllowed.has(k) && !Number.isInteger(v))) {
      throw new RangeError(
        `EgressOptions.limits.${k} must be a positive finite ${fractionalAllowed.has(k) ? "number" : "integer"}, got ${v}`,
      );
    }
  }
  if (out.connectTimeoutMs > out.timeoutMs) {
    throw new RangeError(`limits.connectTimeoutMs (${out.connectTimeoutMs}) must be <= limits.timeoutMs (${out.timeoutMs})`);
  }
  return Object.freeze(out);
}

/**
 * Runtime validation of the request contract. Rejects unknown fields, wrong
 * types, missing mandatory fields and misleading values before any DNS.
 */
function validateRequest(req: EgressRequest): EgressResult | null {
  if (req === null || typeof req !== "object" || Array.isArray(req)) {
    return deny("invalid_request", 0, "request must be a non-null object");
  }
  const shapeErr = validateRequestShape(req);
  if (shapeErr) return shapeErr;
  const typeErr = validateRequestTypes(req);
  if (typeErr) return typeErr;
  return null;
}

function validateRequestShape(req: EgressRequest): EgressResult | null {
  for (const k of Object.keys(req as unknown as Record<string, unknown>)) {
    if (!REQUEST_FIELDS.has(k)) return deny("unknown_field", 0, `unknown request field "${k}"`);
  }
  if (typeof req.transform !== "string" || req.transform.trim() === "") {
    return deny("invalid_request", 0, "transform must be a non-empty string");
  }
  if (typeof req.url !== "string" || req.url === "") {
    return deny("invalid_request", 0, "url must be a non-empty string");
  }
  if (req.method !== undefined && req.method !== "GET" && req.method !== "HEAD" && req.method !== "POST") {
    return deny("invalid_request", 0, "method must be GET, HEAD or POST");
  }
  const postErr = validatePostShape(req);
  if (postErr) return postErr;
  return null;
}

/** POST shape rules (the host pin + per-policy body shape live in `checkPostPolicy`). */
function validatePostShape(req: EgressRequest): EgressResult | null {
  if (req.method === "POST") {
    // Which POST kind this is (OAuth2 token vs screening) is decided later by the pinned host
    // (and path) in `checkPostPolicy`; here only the carrying shape is enforced.
    if (typeof req.body !== "string" || req.body === "") {
      return deny("invalid_request", 0, "a POST must carry a non-empty body (ADR-27 token / ADR-28 screening)");
    }
    return null;
  }
  // A GET/HEAD must not carry a body at all.
  if (req.body !== undefined) {
    return deny("invalid_request", 0, "a request body is only allowed on a POST (ADR-27 token / ADR-28 screening)");
  }
  return null;
}

function validateRequestTypes(req: EgressRequest): EgressResult | null {
  const err = validateHeadersType(req.headers);
  if (err) return err;
  if (req.sends !== undefined) {
    if (!Array.isArray(req.sends)) return deny("invalid_request", 0, "sends must be an array");
    for (const s of req.sends) {
      if (typeof s !== "string") return deny("invalid_request", 0, "sends entries must be strings");
    }
  }
  if (req.systemContext !== undefined && typeof req.systemContext !== "boolean") {
    return deny("invalid_request", 0, "systemContext must be a boolean when provided");
  }
  if (req.signal !== undefined && !(req.signal instanceof AbortSignal)) {
    return deny("invalid_request", 0, "signal must be an AbortSignal when provided");
  }
  const stringFields: Array<[keyof EgressRequest, string]> = [
    ["caseId", "caseId must be a string when provided"],
    ["purposeRef", "purposeRef must be a string when provided"],
    ["sensitivity", "sensitivity must be a string when provided"],
    ["secret", "secret must be a string when provided"],
    ["pinnedHost", "pinnedHost must be a string when provided"],
    ["secretProvider", "secretProvider must be a string when provided"],
  ];
  for (const [field, message] of stringFields) {
    const v = req[field];
    if (v !== undefined && typeof v !== "string") return deny("invalid_request", 0, message);
  }
  return validateBudgetAndPaths(req);
}

/** P2-039/P2-041 fields: `byteBudget` is a ByteBudget, `requestBudget` a RequestBudget, `staticPaths` a short list of exact `host/path` (or `*` + path). */
function validateBudgetAndPaths(req: EgressRequest): EgressResult | null {
  if (req.byteBudget !== undefined && !isByteBudget(req.byteBudget)) {
    return deny("invalid_request", 0, "byteBudget must be a ByteBudget when provided");
  }
  if (req.requestBudget !== undefined && !isRequestBudget(req.requestBudget)) {
    return deny("invalid_request", 0, "requestBudget must be a RequestBudget when provided");
  }
  if (req.staticPaths === undefined) return null;
  if (!Array.isArray(req.staticPaths) || req.staticPaths.length > MAX_STATIC_PATHS) {
    return deny("invalid_request", 0, `staticPaths must be an array of at most ${MAX_STATIC_PATHS} entries`);
  }
  for (const e of req.staticPaths) {
    if (typeof e !== "string" || !STATIC_PATH_ENTRY.test(e)) {
      return deny("invalid_request", 0, "staticPaths entries must be host/path or */path (unreserved characters only)");
    }
  }
  return null;
}

function validateHeadersType(headers: Record<string, string> | undefined): EgressResult | null {
  if (headers === undefined) return null;
  if (typeof headers !== "object" || headers === null || Array.isArray(headers)) {
    return deny("invalid_request", 0, "headers must be an object");
  }
  for (const [k, v] of Object.entries(headers)) {
    if (typeof k !== "string" || typeof v !== "string") {
      return deny("invalid_request", 0, "headers entries must be string -> string");
    }
  }
  return null;
}

/**
 * ADR-08 "reason precedence": a request labelled with a protected category is refused as such before anything else
 * is looked at. There is no option, field or environment variable that changes this (T-SEC-SSRF-028, 040).
 */
function protectedCategory(req: EgressRequest): EgressResult | null {
  if (typeof req !== "object" || req === null) return null;
  if ((req as { sensitivity?: unknown }).sensitivity !== "natural_person_gate") return null;
  return deny("natural_person", 0, "natural-person data is refused until P2-013 is adopted");
}

/**
 * ADR-08 "reason precedence": a literal host that is not a public address is recorded as `address_class` before the
 * scheme, port and credential checks, so `http://127.0.0.1` is logged as an attempt on loopback, not as a wrong
 * scheme (T-SEC-SSRF-001, 039). Still before DNS and before any transport call.
 */
function literalHostCheck(url: URL): EgressResult | null {
  const literal = classifyLiteral(url.hostname);
  if (literal !== null && !literal.verdict.ok) {
    return deny("address_class", 0, `literal ${literal.form} address is not allowed`);
  }
  return null;
}

/**
 * The ADR-27/ADR-28 POST policy pre-check for `preDnsChecks`: parses the URL only to route the
 * pinned POST kinds; an unparsable URL is left to the URL check (invalid_url) — a typed refusal
 * downstream, not a swallow here.
 */
function postPolicyCheck(req: EgressRequest, postPolicies: readonly PostPolicy[] | undefined): EgressResult | null {
  let postUrl: URL;
  try {
    postUrl = new URL(req.url);
  } catch {
    return null;
  }
  return checkRegisteredPost(req, postUrl, postPolicies);
}

/**
 * The narrow systemContext scope: it exempts the request from caseId ONLY for the approved
 * vault-key-validation purpose/transform (review log Q4), and only with a registered vault
 * capability (see vault-capability.ts). `systemContext: true` alone never enables it.
 */
function checkSystemContext(req: EgressRequest, opts: EgressOptions): EgressResult | null {
  if (!req.systemContext) return null;
  if (req.purposeRef !== "vault-key-validation" || req.transform !== "vault.test@1") {
    return deny("invalid_request", 0, "systemContext is only valid for purposeRef=vault-key-validation with transform=vault.test@1");
  }
  if (!req.caseId && !hasVaultCapability(opts, req)) {
    return deny("no_case", 0, "systemContext exemption requires a vault capability");
  }
  return null;
}

/** Pre-DNS policy checks (offline, case, sensitivity, sends, headers, secrets). */
function preDnsChecks(
  req: EgressRequest,
  offline: boolean,
  opts: EgressOptions,
  postPolicies: readonly PostPolicy[] | undefined,
): EgressResult | null {
  if (offline) return deny("offline");
  if (!req.systemContext && !req.caseId) return deny("no_case");
  if (!req.purposeRef) return deny("no_case");
  const sysErr = checkSystemContext(req, opts);
  if (sysErr) return sysErr;
  const sensErr = checkSensitivity(req.sensitivity);
  if (sensErr) return sensErr;
  const manifestErr = checkSends(req.sends);
  if (manifestErr) return manifestErr;
  // ADR-27 / ADR-28: the POST policy (the pinned kinds) runs BEFORE the content inventory, so
  // a host/path violation is reported as invalid_request, and the content check derives the
  // screening person-name waiver only for a genuinely pinned screening URL. An unparsable URL
  // is left to the URL check (invalid_url).
  const postErr = postPolicyCheck(req, postPolicies);
  if (postErr) return postErr;
  const contentErr = checkContent(req, postPolicies);
  if (contentErr) return contentErr;
  const headerErr = checkHeaders(req.headers);
  if (headerErr) return headerErr;
  return checkSecretShape(req);
}

/**
 * T-SEC-SSRF-043: what the request actually carries must be what `sends` declares (content-inventory.ts). Before
 * DNS; an unparsable URL is left to the URL check (invalid_url).
 */
function checkContent(req: EgressRequest, postPolicies: readonly PostPolicy[] | undefined): EgressResult | null {
  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    return null;
  }
  // ADR-28: the OpenSanctions /match screening POST is the ONE wire surface where the screening
  // subject's own name (a person_name reading on the body) is allowed — it is the essence of the
  // query, the run is gated upstream by E-02 (natural_person_gate sensitivity requires purpose
  // confirmation before the run starts), and the body never enters evidence/audit/disk. The
  // gateway re-derives the fact from the pinned host+path, never from a transform-supplied marker.
  const allowPersonNameOnBody = isRegisteredMatchPostUrl(req, url, postPolicies);
  const verdict = judgeInventory(inventoryRequest(url, req.headers, req.secret, req.staticPaths, req.body), req.sends ?? [], {
    allowPersonNameOnBody,
  });
  return verdict ? deny(verdict.reason, 0, verdict.detail) : null;
}

function checkSensitivity(sensitivity: string | undefined): EgressResult | null {
  // Section 2 (reference model): a missing or unknown classification never becomes an implicit allow.
  if (sensitivity === undefined) return deny("unclassified_data", 0, "sensitivity is required");
  if (!["normal", "natural_person_gate", "minor"].includes(sensitivity)) return deny("unclassified_data");
  // Natural person: refused until P2-013 is adopted. There is deliberately no option, env var or field that
  // turns this off (T-SEC-SSRF-040).
  if (sensitivity === "natural_person_gate") return deny("natural_person");
  return null;
}

function checkSends(sends: string[] | undefined): EgressResult | null {
  if (sends === undefined) return deny("missing_manifest");
  // E-02 (P2-013): a natural-person subject's run declares person_name as its only extra kind; the
  // run itself is gated by the engine (a case with a stated purpose), and the subject never appears
  // in a URL or header (the person transforms download fixed files and match locally — and since
  // ADR-28, the OpenSanctions /match screening POST carries the subject's name in its fixed-schema
  // body, the single allowed body surface, see judgeInventory). The wire-level inspection
  // (judgeInventory) is unchanged otherwise: any natural-person identifier found on the wire is
  // refused whatever sends says.
  for (const kind of sends) {
    if (!PUBLIC_ALLOWED_SENDS.has(kind) && !PERSON_SUBJECT_SENDS.has(kind)) return deny("undeclared_data");
  }
  return null;
}

function checkHeaders(headers: Record<string, string> | undefined): EgressResult | null {
  if (!headers) return null;
  for (const [k, v] of Object.entries(headers)) {
    if (/[\r\n]/.test(v)) return deny("header", 0, `header "${k}" contains CR/LF`);
    if (/[\r\n]/.test(k)) return deny("header", 0, "header name contains CR/LF");
  }
  return null;
}

/**
 * Secret transport must be pinned, bound to a registered provider, and the pinned host must be one of that
 * provider's exact hosts (ADR-08 section 3). The secret must never be part of the URL.
 */
function checkSecretShape(req: EgressRequest): EgressResult | null {
  if (req.secret === undefined) return null;
  if (req.secret === "") return deny("secret_host_mismatch", 0, "an empty secret is not a secret");
  if (!req.pinnedHost) return deny("secret_host_mismatch", 0, "a secret requires pinnedHost");
  if (!req.secretProvider) return deny("secret_host_mismatch", 0, "a secret requires secretProvider");
  if (secretInUrl(req.url, req.secret)) return deny("credentials", 0, "the secret must not appear in the URL");
  return null;
}

/**
 * ADR-30 (owner decision 2026-10-17): the unified, table-driven POST check. The policy records
 * live in packages/egress/providers/post-policies.ts (DATA); this check enforces them centrally:
 * https, no query/fragment, the EXACT declared path, the size cap, and the FIXED body schema —
 * the generic walker (post-policy.ts) names the expected shape only, never the actual values.
 * A POST to a host with no registered policy is refused fail-closed before DNS.
 */
function checkRegisteredPost(req: EgressRequest, url: URL, policies: readonly PostPolicy[] | undefined): EgressResult | null {
  if (req.method !== "POST") return null;
  const host = normalizeHost(url.hostname);
  const matching = (policies ?? []).filter((p) => normalizeHost(p.host) === host);
  if (matching.length === 0) {
    return deny("invalid_request", 0, `POST to "${host}" is not a registered POST provider (ADR-30)`);
  }
  if (url.protocol !== "https:") {
    return deny("invalid_request", 0, "a registered-provider POST must use https (ADR-30)");
  }
  if (url.search !== "" || url.hash !== "") {
    return deny("invalid_request", 0, "a registered-provider POST must carry no query or fragment (ADR-30)");
  }
  const byPath = matching.filter((p) => p.path === url.pathname);
  if (byPath.length === 0) {
    return deny("invalid_request", 0, `POST to "${host}" has no policy for the path "${url.pathname}" (ADR-30)`);
  }
  if (byPath.length > 1) {
    return deny(
      "invalid_request",
      0,
      `POST to "${host}${url.pathname}" matches more than one policy row (ADR-30 — the table must be unambiguous)`,
    );
  }
  const policy = byPath[0];
  if (typeof req.body !== "string" || req.body === "") {
    return deny("invalid_request", 0, `a ${policy.kind} POST must carry a non-empty body (ADR-30)`);
  }
  const cap = policy.maxBodyBytes ?? POST_POLICY_DEFAULT_MAX_BODY_BYTES;
  if (Buffer.byteLength(req.body, "utf8") > cap) {
    return deny("invalid_request", 0, `the ${policy.kind} POST body exceeds ${cap} bytes (ADR-30)`);
  }
  const err =
    policy.format === "form" ? formSchemaError(policy.schema, req.body, `the ${policy.kind} POST body`) : jsonBodyError(policy, req.body);
  return err ? deny("invalid_request", 0, err.message) : null;
}

/** A JSON body against the policy's declared schema (the walker names the shape, never the values). */
function jsonBodyError(policy: PostPolicy, body: string): { message: string } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { message: `the ${policy.kind} POST body must be a JSON object (ADR-30)` };
  }
  return jsonSchemaError(policy.schema, parsed, `the ${policy.kind} POST body`);
}

/**
 * ADR-28 (migrated to ADR-30): a registered `match` POST is the ONE wire surface where the
 * screening subject's own name (a person_name reading on the body) is allowed. The gateway
 * re-derives the fact from the registered match policy (host+path), never from a marker.
 */
function isRegisteredMatchPostUrl(req: EgressRequest, url: URL, policies: readonly PostPolicy[] | undefined): boolean {
  if (req.method !== "POST" || policies === undefined) return false;
  return policies.some((p) => p.kind === "match" && normalizeHost(p.host) === normalizeHost(url.hostname) && p.path === url.pathname);
}

/**
 * Provider registry binding for a secret (checked after the destination/allowlist checks, still before DNS): the
 * provider must be registered and the pinned host must be one of its exact hosts.
 */
function checkSecretRegistry(req: EgressRequest, opts: EgressOptions): EgressResult | null {
  if (req.secret === undefined || !req.secretProvider || req.pinnedHost === undefined) return null;
  const registry = opts.providerHosts;
  const hosts = registry && Object.prototype.hasOwnProperty.call(registry, req.secretProvider) ? registry[req.secretProvider] : undefined;
  if (!hosts || hosts.length === 0) return deny("secret_host_mismatch", 0, "secretProvider is not in the provider registry");
  const pin = normalizeHost(req.pinnedHost);
  if (pin === "" || !hosts.some((h) => normalizeHost(h) === pin)) {
    return deny("secret_host_mismatch", 0, "pinnedHost is not a registered host of secretProvider");
  }
  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    return null; // the URL shape check reports invalid_url
  }
  return checkProviderPath(req, url, opts, 0);
}

/** The provider's registered rows in both registries (literal list and templates). */
function providerPathRows(
  paths: Readonly<Record<string, readonly string[]>> | undefined,
  templates: Readonly<Record<string, readonly PathParameterTemplate[]>> | undefined,
  provider: string,
): { literals: readonly string[] | undefined; tpls: readonly PathParameterTemplate[] | undefined } {
  return {
    literals: paths !== undefined && Object.prototype.hasOwnProperty.call(paths, provider) ? paths[provider] : undefined,
    tpls: templates !== undefined && Object.prototype.hasOwnProperty.call(templates, provider) ? templates[provider] : undefined,
  };
}

/**
 * P2-026: the path-template half of the provider path check — method-bound (the policy rows are
 * GET), full-path, every parameter validated centrally against its closed type. Standalone so the
 * path check itself stays simple: a refusal names the same rule as the literal list.
 */
function matchesProviderTemplates(req: EgressRequest, url: URL, tpls: readonly PathParameterTemplate[] | undefined): boolean {
  if (tpls === undefined || url.hash !== "" || (req.method ?? "GET") !== "GET") return false;
  return tpls.some((t) => matchPathTemplate(url.pathname, t).ok);
}

/** T-SEC-SSRF-042: a secret only goes to a registered path (literal or template) of its own provider, on every hop. */
function checkProviderPath(req: EgressRequest, url: URL, opts: EgressOptions, hop: number): EgressResult | null {
  const paths = opts.providerPaths;
  const templates = opts.providerPathTemplates;
  if (paths === undefined && templates === undefined) return null;
  if (req.secret === undefined || !req.secretProvider) return null;
  const { literals, tpls } = providerPathRows(paths, templates, req.secretProvider);
  if ((literals === undefined || literals.length === 0) && (tpls === undefined || tpls.length === 0)) {
    return deny("secret_host_mismatch", hop, "secretProvider has no registered paths");
  }
  const literalOk = url.hash === "" && literals !== undefined && literals.includes(url.pathname);
  if (!literalOk && !matchesProviderTemplates(req, url, tpls)) {
    return deny("secret_host_mismatch", hop, "path is not a registered path of secretProvider");
  }
  if (url.search !== "") return checkProviderQuery(req, url, opts, hop);
  return null;
}

/**
 * P2-016 continuation (owner decision 2026-10-16): the per-provider query allowlist. A secret-bearing
 * request may carry ONLY parameters the provider's registry entry lists (name + type + declared max
 * length); anything else — a parameter outside the list, a repeated parameter, an over-long value or
 * a value that does not match the declared type — is refused before any transport call. A provider
 * with no allowlist entry refuses every query: the unchanged fail-closed default.
 */
function checkProviderQuery(req: EgressRequest, url: URL, opts: EgressOptions, hop: number): EgressResult | null {
  const allow = opts.providerQueries;
  const items =
    allow && Object.prototype.hasOwnProperty.call(allow, req.secretProvider ?? "") ? allow[req.secretProvider ?? ""] : undefined;
  if (!items || items.length === 0) {
    return deny("secret_host_mismatch", hop, "path is not a registered path of secretProvider");
  }
  const seen = new Set<string>();
  for (const [name, value] of url.searchParams.entries()) {
    const item = items.find((a) => a.param === name);
    if (!item) {
      return deny("secret_host_mismatch", hop, `query parameter "${name}" is not in secretProvider's query allowlist`);
    }
    if (seen.has(name)) {
      return deny("secret_host_mismatch", hop, `query parameter "${name}" is repeated`);
    }
    seen.add(name);
    if (value.length > item.maxLength) {
      return deny("secret_host_mismatch", hop, `query parameter "${name}" exceeds the declared max length ${item.maxLength}`);
    }
    if (item.type === "number" && !/^\d+$/.test(value)) {
      return deny("secret_host_mismatch", hop, `query parameter "${name}" is not a number`);
    }
  }
  return null;
}

/** True when the secret appears in the URL, raw or percent-encoded (any case). */
function secretInUrl(url: string, secret: string): boolean {
  if (url.includes(secret)) return true;
  if (url.toLowerCase().includes(encodeURIComponent(secret).toLowerCase())) return true;
  try {
    return decodeURIComponent(url).includes(secret);
  } catch {
    return false;
  }
}

/** URL shape checks (scheme, port, credentials). */
function urlChecks(url: URL): EgressResult | null {
  if (url.protocol !== "https:") return deny("scheme");
  if (url.port !== "" && url.port !== "443") return deny("port");
  if (url.username || url.password) return deny("credentials");
  return null;
}

function isRedirect(resp: { status: number; headers?: Record<string, string> }): boolean {
  return resp.status >= 300 && resp.status < 400 && Boolean(resp.headers?.location);
}

/**
 * Per-host token-bucket rate limiter. Not a global mutex; keyed on the lower-
 * case normalized hostname.
 */
class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; lastRefill: number }>();
  constructor(
    private readonly perSecond: number,
    private readonly burst: number,
    private readonly now: () => number,
  ) {}
  take(host: string): boolean {
    const key = host.toLowerCase();
    const now = this.now();
    let b = this.buckets.get(key);
    if (!b) {
      b = { tokens: this.burst, lastRefill: now };
      this.buckets.set(key, b);
    } else {
      const elapsedMs = Math.max(0, now - b.lastRefill);
      const refill = (elapsedMs / 1000) * this.perSecond;
      b.tokens = Math.min(this.burst, b.tokens + refill);
      b.lastRefill = now;
    }
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }
}

/** The narrow interface the engine depends on. */
export interface EgressGateway {
  request(req: EgressRequest): Promise<EgressResult>;
}

export interface EgressGatewayWithLimits extends EgressGateway {
  readonly limits: Readonly<Required<EgressLimits>>;
}

export function createEgressGateway(opts: EgressOptions): EgressGatewayWithLimits {
  const limits = validateLimits(opts.limits);
  const now = opts.now ?? (() => Date.now());
  const limiter = new RateLimiter(limits.rateLimitPerHostPerSecond, limits.rateLimitBurst, now);
  // ADR-31 (P2-028): Tor's own separate LOWER rate budget — a route of last resort is never as fast as direct.
  const torLimiter = new RateLimiter(limits.torRateLimitPerHostPerSecond ?? 0.2, limits.torRateLimitBurst ?? 1, now);
  // ADR-31 (P2-028): this gateway's routing. undefined = direct (the ADR-08 default); Tor is NEVER implicit.
  const routing = opts.routing;
  const route = (): EgressRoute => routing?.route ?? "direct";
  // The proxy's pinned IP, resolved and policy-checked ONCE per gateway (it is configuration, not a target).
  let proxyIpCache: { readonly ip: string } | { readonly failure: EgressResult } | undefined;

  /**
   * ADR-31 (P2-028): the Tor sensitive-domain blocklist — localhost, *.local, *.internal and every
   * private/loopback/link-local/reserved address. Enforced fail-closed BEFORE any budget or DNS: the
   * exit resolves the name, so only the NAME can be checked on our side (the residual risk is L-35).
   */
  function torBlockedHost(hostname: string): boolean {
    const h = hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (
      h === "localhost" ||
      h.endsWith(".localhost") ||
      h.endsWith(".local") ||
      h.endsWith(".internal") ||
      h.endsWith(".home") ||
      h.endsWith(".corp")
    )
      return true;
    // An IP literal: blocked unless it is a public address (the exit must never reach our internal networks).
    // Hostnames are not classified here — the suffix list above is their only gate (the exit resolves them).
    if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(":")) return classifyAddress(h).kind !== "public";
    return false;
  }

  /** Resolves and policy-checks the configured proxy ONCE; a failure is a fail-closed `proxy_unreachable`. */
  async function resolveProxy(req: EgressRequest, hopCount: number, secretDigest?: string): Promise<{ ip: string } | EgressResult> {
    if (proxyIpCache !== undefined) return "ip" in proxyIpCache ? proxyIpCache : proxyIpCache.failure;
    const host = routing?.proxy.host;
    if (host === undefined) return deny("proxy_unreachable", hopCount, "routing configuration missing a proxy host");
    let ips: string[];
    try {
      ips = await (opts.resolver as DnsResolver).resolve(host);
    } catch {
      ips = [];
    }
    // A literal IP is used as-is (Tor's 127.0.0.1 SocksPort is the operator's own machine — allowed for the PROXY).
    const literal = host.replace(/^\[|\]$/g, "");
    const isLiteral = /^\d+\.\d+\.\d+\.\d+$/.test(literal) || literal.includes(":");
    const candidate = ips.length > 0 ? ips : isLiteral ? [literal] : [];
    const okIp = candidate.find((ip) => (host === "127.0.0.1" || host === "localhost" ? true : classifyAddress(ip).kind === "public"));
    if (okIp === undefined) {
      // Fail-closed: the request fails; there is NO fallback to direct. Recorded with the route.
      audit({
        kind: "denied",
        reason: "proxy_unreachable",
        ...auditCtx(req, host, hopCount, secretDigest),
        detail: `proxy host "${host}" did not resolve to a usable address`,
      });
      const failure = deny("proxy_unreachable", 0, `proxy host "${host}" did not resolve to a usable address`);
      proxyIpCache = { failure };
      return failure;
    }
    proxyIpCache = { ip: okIp };
    return { ip: okIp };
  }
  // An explicitly empty allowedHosts list allows nothing (fail-closed); undefined means public mode.
  const allowedSet: ReadonlySet<string> | undefined =
    opts.allowedHosts === undefined ? undefined : new Set(opts.allowedHosts.map(normalizeHost).filter((h) => h !== ""));
  // ADR-30: the unified POST policy table (unset or empty = no POST is ever allowed, fail-closed).
  const postPolicies: readonly PostPolicy[] | undefined = opts.postPolicies;

  function audit(event: EgressAuditEvent): void {
    // D-017 / P2-006: an audit failure is never swallowed silently. When a sink is configured
    // but cannot record, the request fails closed (the audit trail is security-relevant). When no
    // sink is configured there is nothing to record — that is an explicit absence, not a silent catch.
    if (opts.auditSink === undefined) return;
    // ADR-31 (P2-028): every recorded event carries its route — injected at the single recording point.
    opts.auditSink.record({ ...event, route: route() });
  }

  /**
   * Request-scoped AbortController merging the caller's signal with the overall
   * deadline and the per-hop connect timer. Listeners are cleaned up: the hop
   * timer is always cleared; the caller-signal listener is added once at the
   * start of the request and removed when the request settles.
   */
  function makeRequestAbort(req: EgressRequest): {
    controller: AbortController;
    dispose: () => void;
    abortWith: (reason?: unknown) => void;
  } {
    const controller = new AbortController();
    let disposed = false;
    const onCallerAbort = () => controller.abort(req.signal?.reason ?? new Error("caller cancelled"));
    if (req.signal) {
      if (req.signal.aborted) controller.abort(req.signal.reason);
      else req.signal.addEventListener("abort", onCallerAbort, { once: true });
    }
    return {
      controller,
      abortWith: (reason?: unknown) => controller.abort(reason),
      dispose: () => {
        if (disposed) return;
        disposed = true;
        req.signal?.removeEventListener("abort", onCallerAbort);
      },
    };
  }

  /** Steps 7c: allowedHosts (system-context vault path) and pinnedHost bindings; audits and returns the denial. */
  function hostBinding(req: EgressRequest, host: string, secretDigest: string | undefined): EgressResult | null {
    // --- 7c: allowedHosts binding (system-context vault path) ---
    if (allowedSet) {
      // Both the request host and (when set) the pinned host must be on the list (exact match after normalisation).
      const targetHost = normalizeHost(host);
      const pinTarget = req.pinnedHost !== undefined ? normalizeHost(req.pinnedHost) : targetHost;
      if (!allowedSet.has(targetHost) || !allowedSet.has(pinTarget)) {
        audit({
          kind: "denied",
          reason: "host_not_allowed",
          caseId: req.caseId,
          systemContext: req.systemContext,
          transform: req.transform,
          host,
          transportCalls: 0,
          secretDigest,
        });
        return deny("host_not_allowed", 0, `destination host "${targetHost || host}" is not on the allowedHosts list`);
      }
    }

    // --- 7c: pinnedHost binding ---
    if (req.pinnedHost !== undefined) {
      // ADR-08 section 3: pinned mode is an EXACT match after normalisation — no subdomains, no wildcards.
      const normalizedPin = normalizeHost(req.pinnedHost);
      if (normalizedPin === "" || normalizeHost(host) !== normalizedPin) {
        audit({
          kind: "denied",
          reason: "host_not_allowed",
          caseId: req.caseId,
          systemContext: req.systemContext,
          transform: req.transform,
          host,
          transportCalls: 0,
          secretDigest,
        });
        return deny("host_not_allowed", 0, `request host "${host}" is outside pinnedHost "${req.pinnedHost}"`);
      }
    }

    return null;
  }

  async function request(req: EgressRequest): Promise<EgressResult> {
    const secretDigest = req.secret !== undefined ? redactSecret(req.secret) : undefined;

    // --- 0a: protected category first (ADR-08 "reason precedence"): a natural-person request is recorded as
    // `natural_person` even when it also breaks the request contract, so an extra field cannot mask the attempt.
    const protectedRefusal = protectedCategory(req);
    if (protectedRefusal) {
      audit({
        kind: "denied",
        reason: protectedRefusal.reason,
        transform: req.transform,
        transportCalls: 0,
        detail: protectedRefusal.detail,
      });
      return protectedRefusal;
    }

    // --- 0: runtime contract validation ---
    const invalid = validateRequest(req);
    if (invalid) {
      audit({ kind: "denied", reason: invalid.reason, transform: req.transform, transportCalls: 0, detail: invalid.detail });
      return invalid;
    }

    // --- 1..5: pre-DNS policy (deny-by-default) ---
    // IR_OFFLINE=1 in the process environment always wins, read per request (so setting it later still applies);
    // `offline: false` in the options cannot override it.
    const offline = opts.offline === true || process.env["IR_OFFLINE"] === "1";
    const pre = preDnsChecks(req, offline, opts, postPolicies);
    if (pre) {
      audit({
        kind: "denied",
        reason: pre.reason,
        caseId: req.caseId,
        systemContext: req.systemContext,
        transform: req.transform,
        transportCalls: 0,
        detail: pre.detail,
        secretDigest,
      });
      return pre;
    }

    // --- 6: URL normalization ---
    let currentUrl: URL;
    try {
      currentUrl = new URL(req.url);
    } catch {
      audit({
        kind: "denied",
        reason: "invalid_url",
        caseId: req.caseId,
        systemContext: req.systemContext,
        transform: req.transform,
        transportCalls: 0,
      });
      return deny("invalid_url");
    }

    // --- 6b: POST policy (ADR-27 OAuth2 token + ADR-28 OpenSanctions screening) — enforced in
    // preDnsChecks (before the content inventory) so host/path violations surface as
    // invalid_request and the screening waiver is only derived for pinned screening URLs ---
    // --- ADR-31 (P2-028): Tor's sensitive-domain blocklist — fail-closed BEFORE the URL-shape checks,
    // any budget or DNS: the exit resolves the name, so only the NAME can be checked on our side.
    if (route() === "tor" && torBlockedHost(currentUrl.hostname)) {
      audit({
        kind: "denied",
        reason: "tor_blocklist",
        caseId: req.caseId,
        systemContext: req.systemContext,
        transform: req.transform,
        host: currentUrl.hostname.replace(/^\[|\]$/g, ""),
        transportCalls: 0,
      });
      return deny("tor_blocklist", 0, `host "${currentUrl.hostname}" is on the Tor sensitive-domain blocklist`);
    }

    // --- 7: literal address class, then scheme / port / credentials ---
    const shape = literalHostCheck(currentUrl) ?? urlChecks(currentUrl);
    if (shape) {
      audit({
        kind: "denied",
        reason: shape.reason,
        caseId: req.caseId,
        systemContext: req.systemContext,
        transform: req.transform,
        host: currentUrl.hostname,
        transportCalls: 0,
      });
      return shape;
    }

    // --- 7b: rate limit (per host, per hop) — Tor uses its own separate LOWER budget (ADR-31) ---
    const host = currentUrl.hostname.replace(/^\[|\]$/g, "");
    const activeLimiter = route() === "tor" ? torLimiter : limiter;
    if (!activeLimiter.take(host)) {
      audit({
        kind: "rate_limited",
        reason: "rate_limit",
        caseId: req.caseId,
        systemContext: req.systemContext,
        transform: req.transform,
        host,
        transportCalls: 0,
      });
      return deny("rate_limit", 0, `rate limit exceeded for host ${host}`);
    }

    const binding = hostBinding(req, host, secretDigest);
    if (binding) return binding;

    // --- 8..11: resolve → classify → pin → transport → redirect loop ---
    const registryErr = checkSecretRegistry(req, opts);
    if (registryErr) {
      audit({
        kind: "denied",
        reason: registryErr.reason,
        caseId: req.caseId,
        systemContext: req.systemContext,
        transform: req.transform,
        host,
        transportCalls: 0,
        detail: registryErr.detail,
        secretDigest,
      });
      return registryErr;
    }

    const deadline = now() + limits.timeoutMs;
    const abort = makeRequestAbort(req);
    try {
      return await runHops(req, currentUrl, deadline, abort, secretDigest);
    } finally {
      abort.dispose();
    }
  }

  type AbortCtl = ReturnType<typeof makeRequestAbort>;
  /** P2-032: the first hop's normalised host and the case-data values the transform sent to it. */
  type FirstHop = { readonly firstHost: string; readonly sent: ReadonlySet<string> };
  type TransportResp = Awaited<ReturnType<EgressTransport["fetch"]>>;

  function isCancelled(req: EgressRequest, abort: AbortCtl): boolean {
    return Boolean(req.signal?.aborted) || abort.controller.signal.aborted;
  }

  function auditCtx(req: EgressRequest, host: string, transportCalls: number, secretDigest?: string) {
    return {
      caseId: req.caseId,
      systemContext: req.systemContext,
      transform: req.transform,
      host,
      transportCalls,
      secretDigest,
    };
  }

  /**
   * P2-042: refuse before DNS when the request's shared byte budget has nothing left. Checked BEFORE the
   * request budget takes a hop, so a byte-refused hop consumes no request slot.
   */
  function budgetExhausted(req: EgressRequest, host: string, hops: number, secretDigest?: string): EgressResult | null {
    const b = req.byteBudget;
    if (!b?.exhausted) return null;
    audit({ kind: "size_limit", reason: "byte_budget", ...auditCtx(req, host, hops, secretDigest) });
    return deny("byte_budget", hops, `byte budget exhausted (${b.used}/${b.limit} bytes)`);
  }

  /** P2-039: charge the delivered bytes the transport did not meter; refuse the response if they do not fit. */
  function chargeUnmetered(
    req: EgressRequest,
    resp: TransportResp,
    meteredBytes: number,
    host: string,
    hops: number,
    secretDigest?: string,
  ): EgressResult | null {
    const b = req.byteBudget;
    if (!b) return null;
    const delivered = resp.body !== undefined ? Buffer.byteLength(resp.body, "utf8") : 0;
    const unmetered = delivered - meteredBytes;
    if (unmetered <= 0 || b.take(unmetered)) return null;
    audit({ kind: "size_limit", reason: "byte_budget", ...auditCtx(req, host, hops, secretDigest) });
    return deny("byte_budget", hops, `response would pass the byte budget (${b.used}/${b.limit} bytes used)`);
  }

  /**
   * Per-hop pre-DNS checks. The ADR-27/ADR-28 POST policy runs on EVERY hop's URL — a redirect
   * must never carry a POST body (case data / secrets) to an unpinned host+path, whatever the
   * redirect status implies about method preservation. Then cancellation, deadline and the
   * P2-041/P2-042 budgets (the byte budget first: a hop it would refuse consumes no request slot).
   */
  function hopPreFlight(
    req: EgressRequest,
    currentUrl: URL,
    hopCount: number,
    deadline: number,
    abort: AbortCtl,
    secretDigest?: string,
  ): EgressResult | null {
    const hopPostErr = checkRegisteredPost(req, currentUrl, postPolicies);
    if (hopPostErr) {
      audit({ kind: "denied", reason: hopPostErr.reason, ...auditCtx(req, currentUrl.hostname, hopCount, secretDigest) });
      return hopPostErr;
    }
    // Cancellation before DNS: no resolver call, no transport call.
    if (isCancelled(req, abort)) {
      audit({ kind: "denied", reason: "cancelled", ...auditCtx(req, currentUrl.hostname, hopCount, secretDigest) });
      return deny("cancelled", hopCount, "request cancelled by caller before DNS");
    }
    if (now() >= deadline) {
      audit({ kind: "timeout", reason: "timeout_total", ...auditCtx(req, currentUrl.hostname, hopCount) });
      return deny("timeout_total", hopCount);
    }
    // P2-041/P2-042: the shared request budget sees EVERY hop (the first hop and every redirect) — take one
    // BEFORE DNS, so `state.requests` reflects every DNS+connect+bytes+rate-consuming transport call, and
    // no redirect hop can start once the investigation's request budget is exhausted (the outer requestMeter
    // wraps gateway.request() once per entry request and cannot see hops inside runHops).
    const spent = budgetExhausted(req, currentUrl.hostname, hopCount, secretDigest);
    if (spent) return spent;
    const reqBudget = req.requestBudget;
    if (reqBudget !== undefined && !reqBudget.take()) {
      audit({ kind: "denied", reason: "request_budget", ...auditCtx(req, currentUrl.hostname, hopCount, secretDigest) });
      return deny(
        "request_budget",
        hopCount,
        `investigation request budget exhausted (${reqBudget.usedCount}/${reqBudget.limit} requests)`,
      );
    }
    return null;
  }

  /**
   * ADR-31 (P2-028): resolves WHAT this hop hands the transport — the pinned target IP (direct and
   * strict proxy mode; the proxy relays bytes and never resolves DNS) or the DOMAIN (Tor — the exit
   * resolves it). Strict mode also resolves and policy-checks the PROXY itself, fail-closed.
   */
  async function resolveRoute(
    req: EgressRequest,
    currentUrl: URL,
    hopCount: number,
    deadline: number,
    abort: AbortCtl,
    secretDigest?: string,
  ): Promise<{ tunnel: EgressProxyTunnel | undefined; hopPinnedIp: string } | EgressResult> {
    if (routing === undefined) {
      const resolved = await resolveBounded(currentUrl, hopCount, deadline, abort);
      if ("code" in resolved && resolved.code !== undefined) {
        audit({ kind: "denied", reason: resolved.reason, ...auditCtx(req, currentUrl.hostname, hopCount, secretDigest) });
        return resolved;
      }
      return { tunnel: undefined, hopPinnedIp: (resolved as ResolvedAddress).pinnedIp };
    }
    const proxy = await resolveProxy(req, hopCount, secretDigest);
    if ("code" in proxy && proxy.code !== undefined) return proxy;
    const proxyIp = (proxy as { ip: string }).ip;
    const proxyCommon = {
      proxyIp,
      proxyPort: routing.proxy.port,
      ...(routing.proxy.credentials ? { credentials: routing.proxy.credentials } : {}),
    };
    if (routing.route === "tor") {
      // Tor: the target is NEVER resolved locally — the exit resolves it; the transport connects to the PROXY.
      const tunnel: EgressProxyTunnel = {
        kind: "socks5",
        ...proxyCommon,
        target: { kind: "host", host: currentUrl.hostname.replace(/^\[|\]$/g, "") },
      };
      return { tunnel, hopPinnedIp: proxyIp };
    }
    // Strict mode: the target is pinned locally as always (resolveBounded); the transport hands the
    // PROXY the pinned target IP and relays bytes — DNS never happens at the proxy.
    const resolved = await resolveBounded(currentUrl, hopCount, deadline, abort);
    if ("code" in resolved && resolved.code !== undefined) {
      audit({ kind: "denied", reason: resolved.reason, ...auditCtx(req, currentUrl.hostname, hopCount, secretDigest) });
      return resolved;
    }
    const tunnel: EgressProxyTunnel = {
      kind: routing.route === "proxy-http-connect" ? "http-connect" : "socks5",
      ...proxyCommon,
      target: { kind: "ip", ip: (resolved as ResolvedAddress).pinnedIp },
    };
    return { tunnel, hopPinnedIp: proxyIp };
  }

  async function runHops(
    req: EgressRequest,
    initialUrl: URL,
    deadline: number,
    abort: AbortCtl,
    secretDigest?: string,
  ): Promise<EgressResult> {
    let currentUrl = initialUrl;
    let hopCount = 0;
    // P2-032: the first hop's host and the values the transform sent to it; later hops are judged against them.
    const firstHost = normalizeHost(initialUrl.hostname);
    const sent = sentValues(initialUrl, req.headers, req.secret, req.staticPaths, req.body);
    let hopHeaders = req.headers;
    while (true) {
      // Per-hop pre-DNS checks: the POST policy (every hop — a redirect must never carry a
      // POST body to an unpinned host+path), cancellation, deadline and budgets.
      const pre = hopPreFlight(req, currentUrl, hopCount, deadline, abort, secretDigest);
      if (pre) return pre;
      // ADR-31 (P2-028): the routing decides WHAT is resolved and WHAT the transport is handed —
      // see resolveRoute (strict mode pins the target and the proxy relays bytes; Tor sends the domain).
      const routed = await resolveRoute(req, currentUrl, hopCount, deadline, abort, secretDigest);
      if ("code" in routed && routed.code !== undefined) return routed;
      const { tunnel, hopPinnedIp } = routed as { tunnel: EgressProxyTunnel | undefined; hopPinnedIp: string };
      const metered = { bytes: 0 };
      const hop = await transportHopRecorded(req, currentUrl, hopPinnedIp, hopHeaders, hopCount, deadline, abort, metered, tunnel);
      if ("code" in hop && hop.code !== undefined) return hop;
      const resp = hop as TransportResp;
      // A cancelled request is NEVER a success, even if the transport completed late.
      if (isCancelled(req, abort)) {
        audit({ kind: "denied", reason: "cancelled", ...auditCtx(req, currentUrl.hostname, hopCount + 1, secretDigest) });
        return deny("cancelled", hopCount + 1, "request cancelled by caller after transport");
      }
      // P2-039: charge what the transport did not meter (a body returned whole, or decoded past its wire size).
      const over = chargeUnmetered(req, resp, metered.bytes, currentUrl.hostname, hopCount + 1, secretDigest);
      if (over) return over;
      hopCount++;
      const next = await redirectOrFinish(req, currentUrl, resp, hopCount, deadline, abort, { firstHost, sent }, secretDigest);
      if (next.done) return next.result;
      currentUrl = next.url;
      // P2-032: the transform's headers go only to the host it chose; another host gets the safe list only.
      hopHeaders = normalizeHost(currentUrl.hostname) === firstHost ? req.headers : crossHostHeaders(req.headers);
    }
  }

  /**
   * P2-014 (T-ETH-006): every ACTUAL transport call is one `transport` audit event, recorded at the
   * `opts.transport.fetch` boundary itself — the first hop, every redirect hop, and attempts that FAIL
   * are all rows. Allow/deny decisions stay separate (`egress.allowed`/`egress.denied`); this row proves
   * an attempt was made, never that it was allowed or that it succeeded. On `transport` events the
   * required `transportCalls` field carries the 1-based attempt index (which hop this was). The URL is
   * secret-redacted (defense in depth: a hostile origin can echo request material back in a redirect's
   * query — the raw secret must never reach the case chain).
   */
  /**
   * P2-014: wraps transportHop so the SUCCESS row is emitted outside the transport catch — an audit-sink
   * failure in the success path must fail the request closed (the audit trail is security-relevant) without
   * being misread as a transport failure or double-emitting a row.
   */
  async function transportHopRecorded(
    req: EgressRequest,
    currentUrl: URL,
    pinnedIp: string,
    headers: Readonly<Record<string, string>> | undefined,
    hopCount: number,
    deadline: number,
    abort: AbortCtl,
    metered: { bytes: number },
    tunnel?: EgressProxyTunnel,
  ): Promise<TransportResp | EgressResult> {
    const outcome = await transportHop(req, currentUrl, pinnedIp, headers, hopCount, deadline, abort, metered, tunnel);
    if (!("code" in outcome && outcome.code !== undefined)) {
      // P2-014: the call was actually made — record it at the fetch boundary (success carries its status).
      auditTransportCall(req, currentUrl, hopCount + 1, (outcome as TransportResp).status);
    }
    return outcome;
  }

  function auditTransportCall(req: EgressRequest, url: URL, attempt: number, status?: number, error?: string): void {
    const href = req.secret !== undefined ? redactInText(url.href, req.secret) : url.href;
    const secretDigest = req.secret !== undefined ? redactSecret(req.secret) : undefined;
    audit({
      kind: "transport",
      ...auditCtx(req, url.hostname, attempt, secretDigest),
      url: href,
      attempt,
      ...(status !== undefined ? { status } : {}),
      ...(error !== undefined ? { error } : {}),
    });
  }

  /**
   * One transport hop. The hop AbortController merges (a) the per-hop connect
   * timer and (b) the request-level abort (caller signal). Both the timer and
   * the request-abort listener are always released, so no listener or timer
   * leaks across hops or requests.
   */
  /** Maps a transport failure to its deny result (P2-014 rows included) — shared by every hop's catch. */
  function transportFailureResult(
    req: EgressRequest,
    currentUrl: URL,
    hopCount: number,
    err: unknown,
    abort: AbortCtl,
    deadline: number,
    fetchInitiated: boolean,
    hopAborted: boolean,
  ): EgressResult {
    const detail = err instanceof Error ? err.message : String(err);
    const safeDetail = req.secret ? redactInText(detail, req.secret) : detail;
    // P2-014: a failed attempt is still an attempt — a row with the error, never silently absent.
    if (fetchInitiated) auditTransportCall(req, currentUrl, hopCount + 1, undefined, safeDetail);
    if (isCancelled(req, abort)) {
      audit({ kind: "transport_error", reason: "cancelled", ...auditCtx(req, currentUrl.hostname, hopCount + 1), detail: safeDetail });
      return deny("cancelled", hopCount + 1, "request cancelled by caller during transport");
    }
    if (hopAborted) {
      const reason = now() >= deadline ? "timeout_total" : "timeout_connect";
      audit({ kind: "timeout", reason, ...auditCtx(req, currentUrl.hostname, hopCount + 1), detail: safeDetail });
      return deny(reason, hopCount + 1);
    }
    // A typed transport failure keeps its reason; anything else is a transport error, never a policy reason.
    const reason: EgressReason = err instanceof EgressTransportError ? err.reason : "transport_error";
    audit({
      kind: reason === "size_limit" || reason === "byte_budget" ? "size_limit" : "transport_error",
      reason,
      ...auditCtx(req, currentUrl.hostname, hopCount + 1),
      detail: safeDetail,
    });
    return deny(reason, hopCount + 1, safeDetail);
  }

  async function transportHop(
    req: EgressRequest,
    currentUrl: URL,
    pinnedIp: string,
    headers: Readonly<Record<string, string>> | undefined,
    hopCount: number,
    deadline: number,
    abort: AbortCtl,
    metered: { bytes: number },
    tunnel?: EgressProxyTunnel,
  ): Promise<TransportResp | EgressResult> {
    const hopDeadline = Math.min(deadline, now() + limits.connectTimeoutMs);
    if (now() >= hopDeadline) {
      audit({ kind: "timeout", reason: "timeout_connect", ...auditCtx(req, currentUrl.hostname, hopCount) });
      return deny("timeout_connect", hopCount);
    }
    const hopController = new AbortController();
    const hopTimer = setTimeout(() => hopController.abort(new Error("egress hop timeout")), Math.max(1, hopDeadline - now()));
    const onReqAbort = () => hopController.abort(abort.controller.signal.reason);
    abort.controller.signal.addEventListener("abort", onReqAbort, { once: true });
    // P2-014: set once the transport was actually invoked — declared here so the catch block can see it
    // (a failure after the call is still an attempt; a synchronous throw before it is not).
    let fetchInitiated = false;
    try {
      // The gateway does not rely on the transport honouring the signal: the hop settles when the signal fires even
      // if the transport keeps running (its late result is discarded), so a deadline is a real upper bound.
      const aborted = new Promise<never>((_resolve, reject) => {
        const fire = () => reject(hopController.signal.reason ?? new Error("egress hop aborted"));
        if (hopController.signal.aborted) fire();
        else hopController.signal.addEventListener("abort", fire, { once: true });
      });
      // P2-014: marked BEFORE the call — a transport whose fetch() throws synchronously was still
      // invoked, and that attempt is a row (a synchronous throw is a failed attempt, not a non-attempt).
      fetchInitiated = true;
      const fetching = opts.transport.fetch({
        url: currentUrl.href,
        host: currentUrl.hostname.replace(/^\[|\]$/g, ""),
        pinnedIp,
        // ADR-31 (P2-028): the route (informational) and the proxy tunnel (undefined = direct).
        route: route(),
        ...(tunnel !== undefined ? { proxy: tunnel } : {}),
        method: req.method ?? "GET",
        headers: headers === undefined ? undefined : { ...headers },
        // ADR-27: the OAuth2 token POST body (the only request that ever has one).
        body: req.body,
        signal: hopController.signal,
        maxBodyBytes: limits.maxSizeBytes,
        ...(req.byteBudget
          ? {
              meter: (n: number) => {
                // A late chunk after the hop settled (timeout, cancel) is not charged: the stream is being torn down.
                if (hopController.signal.aborted) return false;
                const budget = req.byteBudget as ByteBudget;
                if (!budget.take(n)) return false;
                metered.bytes += n;
                return true;
              },
            }
          : {}),
      });
      fetching.catch(() => {}); // a late rejection after the race is settled must not become unhandled
      aborted.catch(() => {});
      return await Promise.race([fetching, aborted]);
    } catch (err) {
      return transportFailureResult(req, currentUrl, hopCount, err, abort, deadline, fetchInitiated, hopController.signal.aborted);
    } finally {
      clearTimeout(hopTimer);
      abort.controller.signal.removeEventListener("abort", onReqAbort);
    }
  }

  /**
   * DNS resolution + classification. For a literal IP the address is classified
   * DIRECTLY (no DNS round-trip), so `https://[::1]/x` is rejected because the
   * address itself is a loopback, not because the resolver returned an empty
   * list. For a hostname, EVERY address returned by the resolver is classified.
   */
  interface ResolvedAddress {
    readonly resolved: true;
    readonly pinnedIp: string;
  }

  /**
   * DNS is bounded by the same overall deadline and the caller's cancellation as the transport: a resolver that
   * never answers cannot hold a request open past `timeoutMs` (fail-closed `timeout_total` / `cancelled`).
   */
  async function resolveBounded(url: URL, hopCount: number, deadline: number, abort: AbortCtl): Promise<ResolvedAddress | EgressResult> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    const stop = new Promise<EgressResult>((resolve) => {
      timer = setTimeout(
        () => resolve(deny("timeout_total", hopCount, "DNS resolution exceeded the request deadline")),
        Math.max(1, deadline - now()),
      );
      onAbort = () => resolve(deny("cancelled", hopCount, "request cancelled by caller during DNS"));
      abort.controller.signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      return await Promise.race([
        resolveAndClassify(url, hopCount).catch(() => deny("address_class", hopCount, "DNS resolution failed")),
        stop,
      ]);
    } finally {
      clearTimeout(timer);
      if (onAbort) abort.controller.signal.removeEventListener("abort", onAbort);
    }
  }

  async function resolveAndClassify(url: URL, hopCount: number): Promise<ResolvedAddress | EgressResult> {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    // Literal IP: classify directly, do NOT consult the resolver.
    // (Classify first; only fall through to DNS for hostnames.)
    const literal = classifyLiteral(host);
    if (literal !== null) {
      if (!literal.verdict.ok) {
        return deny("address_class", hopCount, `literal ${literal.form} address is not allowed`);
      }
      return { resolved: true, pinnedIp: literal.form };
    }
    const resolved = await opts.resolver.resolve(host);
    if (!resolved || resolved.length === 0) return deny("address_class", hopCount, "DNS returned no addresses");
    let firstOk: string | undefined;
    for (const ip of resolved) {
      const lit = classifyLiteral(ip);
      if (lit === null) return deny("address_class", hopCount, `resolver returned a non-IP "${ip}"`);
      if (!lit.verdict.ok) return deny("address_class", hopCount, `resolved address ${ip} is not allowed`);
      if (firstOk === undefined) firstOk = ip;
    }
    if (firstOk === undefined) return deny("address_class", hopCount);
    return { resolved: true, pinnedIp: firstOk };
  }

  async function redirectOrFinish(
    req: EgressRequest,
    currentUrl: URL,
    resp: { status: number; body?: string; headers?: Record<string, string>; contentLength?: number },
    hopCount: number,
    deadline: number,
    abort: ReturnType<typeof makeRequestAbort>,
    first: FirstHop,
    secretDigest?: string,
  ): Promise<{ done: true; result: EgressResult } | { done: false; url: URL }> {
    if (isRedirect(resp) && resp.headers?.location) {
      return redirectHop(req, currentUrl, resp, hopCount, deadline, first, secretDigest);
    }
    return finishHop(req, currentUrl, resp, hopCount, abort, secretDigest);
  }

  /** Redirect target host: the same allowedHosts and pinnedHost checks the original request passed (T-SEC-SSRF-045). */
  function redirectHostCheck(req: EgressRequest, nextHost: string, hopCount: number, secretDigest?: string): EgressResult | null {
    if (allowedSet) {
      if (!allowedSet.has(normalizeHost(nextHost))) {
        audit({
          kind: "denied",
          reason: "host_not_allowed",
          caseId: req.caseId,
          systemContext: req.systemContext,
          transform: req.transform,
          host: nextHost,
          transportCalls: hopCount,
          secretDigest,
        });
        return deny("host_not_allowed", hopCount, `redirect to "${nextHost}" is not on the allowedHosts list`);
      }
    }
    // Redirects to a different host are NOT allowed when a secret or a pin is in play.
    if (req.pinnedHost !== undefined) {
      const normalizedPin = normalizeHost(req.pinnedHost);
      if (normalizedPin === "" || normalizeHost(nextHost) !== normalizedPin) {
        audit({
          kind: "denied",
          reason: "host_not_allowed",
          caseId: req.caseId,
          systemContext: req.systemContext,
          transform: req.transform,
          host: nextHost,
          transportCalls: hopCount,
          secretDigest,
        });
        return deny("host_not_allowed", hopCount, `redirect to "${nextHost}" is outside pinnedHost "${req.pinnedHost}"`);
      }
    }
    return null;
  }

  /** Redirect hop: validate the target and either continue or deny. */
  /**
   * ADR-31 (P2-028): the Tor redirect gate — the blocklist refusal for a redirect target. The exit
   * resolves the name, so only the NAME can be checked on our side; `undefined` means not blocked.
   */
  function torRedirectRefusal(
    req: EgressRequest,
    nextUrl: URL,
    hopCount: number,
    secretDigest: string | undefined,
    nextHostForAudit: string,
  ): { done: true; result: EgressResult } | undefined {
    if (route() !== "tor" || !torBlockedHost(nextUrl.hostname.replace(/^\[|\]$/g, ""))) return undefined;
    const result = deny("tor_blocklist", hopCount, `redirect target "${nextUrl.hostname}" is on the Tor sensitive-domain blocklist`);
    audit({ kind: "denied", reason: result.reason, ...auditCtx(req, nextHostForAudit, hopCount, secretDigest), detail: result.detail });
    return { done: true, result };
  }

  async function redirectHop(
    req: EgressRequest,
    currentUrl: URL,
    resp: { status: number; body?: string; headers?: Record<string, string>; contentLength?: number },
    hopCount: number,
    deadline: number,
    first: FirstHop,
    secretDigest?: string,
  ): Promise<{ done: true; result: EgressResult } | { done: false; url: URL }> {
    const location = resp.headers?.location;
    if (!location) {
      return { done: true, result: deny("invalid_url", hopCount, "redirect target is missing a location header") };
    }
    let nextUrl: URL;
    try {
      nextUrl = new URL(location, currentUrl);
    } catch {
      return { done: true, result: deny("invalid_url", hopCount, "redirect target is not a valid URL") };
    }
    const nextHostForAudit = nextUrl.hostname.replace(/^\[|\]$/g, "");
    const refuse = (result: EgressResult, kind: EgressAuditEvent["kind"] = "denied") => {
      audit({ kind, reason: result.reason, ...auditCtx(req, nextHostForAudit, hopCount, secretDigest), detail: result.detail });
      return { done: true as const, result };
    };
    const nextShape = literalHostCheck(nextUrl) ?? urlChecks(nextUrl);
    if (nextShape) return refuse({ ...nextShape, transportCalls: hopCount, detail: "redirect target refused" });
    // ADR-31 (P2-028): a redirect target over Tor is blocklist-checked like a first hop — the exit
    // resolves it, so only the NAME can be checked on our side.
    const torRefused = torRedirectRefusal(req, nextUrl, hopCount, secretDigest, nextHostForAudit);
    if (torRefused !== undefined) return torRefused;
    if (hopCount > limits.maxRedirects) return refuse(deny("redirect_limit", hopCount));
    // Every hop is charged against its own host's rate limit, like a first request (ADR-08) —
    // Tor's hops use Tor's own separate LOWER budget (ADR-31).
    const redirectLimiter = route() === "tor" ? torLimiter : limiter;
    if (!redirectLimiter.take(nextHostForAudit)) {
      return refuse(deny("rate_limit", hopCount, `rate limit exceeded for host ${nextHostForAudit}`), "rate_limited");
    }
    // --- ACTUAL-DESTINATION check (T-SEC-SSRF-045 / Q4 condition): the redirect
    // target host must pass the same allowedHosts + pinnedHost checks that the
    // original request passed. A redirect to an unlisted host is denied, even
    // for public-mode requests when allowedHosts is set.
    const nextHost = nextUrl.hostname.replace(/^\[|\]$/g, "");
    const hostErr = redirectHostCheck(req, nextHost, hopCount, secretDigest);
    if (hostErr) return { done: true, result: hostErr };
    const pathErr = checkProviderPath(req, nextUrl, opts, hopCount);
    if (pathErr) return refuse(pathErr);
    // P2-032 (ADR-08 section 4): the server-chosen URL is inventoried before it is sent.
    const contentVerdict = redirectContentVerdict(
      nextUrl,
      normalizeHost(nextHost) !== first.firstHost,
      first.sent,
      req.sends ?? [],
      req.staticPaths,
    );
    if (contentVerdict) return refuse(deny(contentVerdict.reason, hopCount, contentVerdict.detail));
    if (now() >= deadline) {
      audit({
        kind: "timeout",
        reason: "timeout_total",
        caseId: req.caseId,
        systemContext: req.systemContext,
        transform: req.transform,
        host: nextHost,
        transportCalls: hopCount,
      });
      return { done: true, result: deny("timeout_total", hopCount) };
    }
    return { done: false, url: nextUrl };
  }

  /** Finish hop: enforce the size limit and attach the response to the result. */
  async function finishHop(
    req: EgressRequest,
    currentUrl: URL,
    resp: { status: number; body?: string; headers?: Record<string, string>; contentLength?: number },
    hopCount: number,
    abort: ReturnType<typeof makeRequestAbort>,
    secretDigest?: string,
  ): Promise<{ done: true; result: EgressResult }> {
    // Size limit: prefer an explicit contentLength when the transport reports
    // one, otherwise fall back to the body string length. The transport is
    // responsible for not buffering more than it can report; the gateway treats
    // a missing body as size 0.
    // Both the declared length and the ACTUAL body bytes are checked: a short Content-Length must not let a larger
    // body through (T-SEC-SSRF-032), and a missing one must not either (T-SEC-SSRF-031).
    const declared = resp.contentLength ?? 0;
    const actual = resp.body !== undefined ? Buffer.byteLength(resp.body, "utf8") : 0;
    if (declared > limits.maxSizeBytes || actual > limits.maxSizeBytes) {
      audit({
        kind: "size_limit",
        reason: "size_limit",
        caseId: req.caseId,
        systemContext: req.systemContext,
        transform: req.transform,
        host: currentUrl.hostname,
        transportCalls: hopCount,
      });
      return { done: true, result: deny("size_limit", hopCount) };
    }
    audit({
      kind: "allowed",
      caseId: req.caseId,
      systemContext: req.systemContext,
      transform: req.transform,
      host: currentUrl.hostname,
      method: req.method ?? "GET",
      transportCalls: hopCount,
      secretDigest,
    });
    // Attach the transport response to the SUCCESS result so the caller
    // (engine adapter / vault route) can consume status+headers+body without
    // a second fetch. Only present when ok=true.
    const successResp: EgressSuccessResponse = {
      status: resp.status,
      headers: resp.headers,
      body: resp.body,
      contentLength: resp.contentLength,
      host: currentUrl.hostname.replace(/^\[|\]$/g, ""),
      aborted: req.signal?.aborted || abort.controller.signal.aborted || undefined,
    };
    return { done: true, result: { ok: true, transportCalls: hopCount, response: successResp } };
  }

  return { request, limits };
}

/** Classify a literal IP string, or return null if it is not an IP literal. */
function classifyLiteral(s: string): { form: string; verdict: { ok: boolean } } | null {
  const clean = s.trim().replace(/^\[|\]$/g, "");
  if (clean === "") return null;
  // A dotted quad or a colon-separated hex string.
  const isDotted = /^\d{1,3}(\.\d{1,3}){3}$/.test(clean);
  const isHex = clean.includes(":");
  if (!isDotted && !isHex) return null;
  const v = classifyAddress(clean);
  return { form: clean, verdict: v };
}
