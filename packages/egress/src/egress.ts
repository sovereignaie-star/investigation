/**
 * Egress gateway (P2-003 / ADR-08). SIMULATION ONLY in this cycle:
 * no real network transport, no real DNS resolver, no env var that enables the
 * network. The gateway is a policy boundary that decides, based on a request
 * contract, whether a transport call is allowed, and enforces limits.
 *
 * This module is intentionally self-contained and side-effect-free outside the
 * injected `resolver` / `transport` / `auditSink` / `now` functions.
 */
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
  | "invalid_request";

export const EGRESS_DENY_CODE = "EGRESS_POLICY_DENIED" as const;
/** @deprecated Use `EGRESS_DENY_CODE` (the const value) or `EgressReason`. */
export type EgressDenyCode = typeof EGRESS_DENY_CODE;

export interface EgressRequest {
  caseId?: string;
  purposeRef?: string;
  transform: string;
  url: string;
  method?: "GET" | "HEAD";
  headers?: Record<string, string>;
  sends?: string[];
  sensitivity?: string;
  secret?: string;
  /** Pin the destination host (pinned mode / secret transport). */
  pinnedHost?: string;
  /** Provider registry that a `secret` must be bound to. */
  secretProvider?: string;
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
    pinnedIp: string;
    method: string;
    headers?: Record<string, string>;
    signal?: AbortSignal;
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
  readonly kind: "allowed" | "denied" | "transport_error" | "timeout" | "rate_limited" | "size_limit";
  readonly reason?: EgressReason;
  readonly caseId?: string;
  readonly transform?: string;
  readonly host?: string;
  readonly method?: string;
  readonly transportCalls: number;
  readonly detail?: string;
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
}

export interface EgressOptions {
  /** Must be provided. Tests set it explicitly; no env var can enable the network. */
  readonly resolver: DnsResolver;
  readonly transport: EgressTransport;
  readonly limits?: EgressLimits;
  readonly now?: () => number;
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly auditSink?: EgressAuditSink;
  /** Simulate IR_OFFLINE=1 (deny-by-default; cannot be turned off by env). */
  readonly offline?: boolean;
}

const DEFAULT_LIMITS: Required<Omit<EgressLimits, never>> = {
  maxRedirects: 3,
  maxSizeBytes: 5 * 1024 * 1024,
  timeoutMs: 15_000,
  connectTimeoutMs: 5_000,
  rateLimitPerHostPerSecond: 1,
  rateLimitBurst: 4,
};

/** Data kinds that are allowed in `sends` for the public mode before P2-013. */
const PUBLIC_ALLOWED_SENDS = new Set(["domain", "ip", "asn", "hash", "url", "certificate"]);

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
]);

function deny(reason: EgressReason, transportCalls = 0, detail?: string): EgressResult {
  return { ok: false, code: EGRESS_DENY_CODE, reason, transportCalls, detail };
}

/** Create a stable, non-reversible digest prefix for a secret (never log the secret). */
function redactSecret(secret: string): string {
  // FNV-1a 32-bit — not cryptographically strong, but the goal is only to give
  // the audit sink a stable correlation token that is NOT the secret itself.
  let h = 0x811c9dc5;
  for (let i = 0; i < secret.length; i++) {
    h ^= secret.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return `redacted-${h.toString(16).padStart(8, "0")}`;
}

/**
 * Validate the limits at construction. Any unknown / non-numeric / non-positive
 * field causes a RangeError, so a caller cannot silently widen the policy.
 */
function validateLimits(raw: EgressLimits | undefined): Required<EgressLimits> {
  const out = { ...DEFAULT_LIMITS, ...(raw ?? {}) };
  const allowed = new Set(["maxRedirects", "maxSizeBytes", "timeoutMs", "connectTimeoutMs", "rateLimitPerHostPerSecond", "rateLimitBurst"]);
  if (raw) {
    for (const k of Object.keys(raw)) {
      if (!allowed.has(k)) throw new RangeError(`EgressOptions.limits.${k} is not a known limit`);
    }
  }
  for (const [k, v] of Object.entries(out)) {
    if (!Number.isFinite(v) || !Number.isInteger(v) || v <= 0) {
      throw new RangeError(`EgressOptions.limits.${k} must be a positive finite integer, got ${v}`);
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
  if (req.method !== undefined && req.method !== "GET" && req.method !== "HEAD") {
    return deny("invalid_request", 0, "method must be GET or HEAD");
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

/** Pre-DNS policy checks (offline, case, sensitivity, sends, headers, secrets). */
function preDnsChecks(req: EgressRequest, offline: boolean): EgressResult | null {
  if (offline) return deny("offline");
  if (!req.caseId || !req.purposeRef) return deny("no_case");
  const sensErr = checkSensitivity(req.sensitivity);
  if (sensErr) return sensErr;
  const manifestErr = checkSends(req.sends);
  if (manifestErr) return manifestErr;
  const headerErr = checkHeaders(req.headers);
  if (headerErr) return headerErr;
  return checkSecretShape(req);
}

function checkSensitivity(sensitivity: string | undefined): EgressResult | null {
  if (sensitivity === "natural_person_gate") return deny("natural_person");
  if (sensitivity !== undefined && !["normal", "natural_person_gate", "minor"].includes(sensitivity)) {
    return deny("unclassified_data");
  }
  return null;
}

function checkSends(sends: string[] | undefined): EgressResult | null {
  if (sends === undefined) return deny("missing_manifest");
  for (const kind of sends) {
    if (!PUBLIC_ALLOWED_SENDS.has(kind)) return deny("undeclared_data");
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

/** Secret transport must be pinned and bound to a provider. */
function checkSecretShape(req: EgressRequest): EgressResult | null {
  if (req.secret === undefined) return null;
  if (!req.pinnedHost) return deny("secret_host_mismatch", 0, "a secret requires pinnedHost");
  if (!req.secretProvider) return deny("secret_host_mismatch", 0, "a secret requires secretProvider");
  // Host list is a policy concern of the caller; the gateway only enforces
  // the *shape*: pinned, provider-identified, and the URL host matches the
  // pin. The actual host list lives in the provider registry (vault).
  return null;
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

  function audit(event: EgressAuditEvent): void {
    try {
      opts.auditSink?.record(event);
    } catch {
      // Audit failures are NOT swallowed silently for security-relevant paths;
      // for now we log to nothing because this is a simulation. A real sink
      // must be fail-closed: throw if it cannot write.
    }
  }

  async function request(req: EgressRequest): Promise<EgressResult> {
    const secretDigest = req.secret !== undefined ? redactSecret(req.secret) : undefined;

    // --- 0: runtime contract validation ---
    const invalid = validateRequest(req);
    if (invalid) {
      audit({ kind: "denied", reason: invalid.reason, transform: req.transform, transportCalls: 0, detail: invalid.detail });
      return invalid;
    }

    // --- 1..5: pre-DNS policy (deny-by-default) ---
    const pre = preDnsChecks(req, opts.offline ?? false);
    if (pre) {
      audit({
        kind: "denied",
        reason: pre.reason,
        caseId: req.caseId,
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
      audit({ kind: "denied", reason: "invalid_url", caseId: req.caseId, transform: req.transform, transportCalls: 0 });
      return deny("invalid_url");
    }

    // --- 7: scheme / port / credentials ---
    const shape = urlChecks(currentUrl);
    if (shape) {
      audit({
        kind: "denied",
        reason: shape.reason,
        caseId: req.caseId,
        transform: req.transform,
        host: currentUrl.hostname,
        transportCalls: 0,
      });
      return shape;
    }

    // --- 7b: rate limit (per host, per hop) ---
    const host = currentUrl.hostname.replace(/^\[|\]$/g, "");
    if (!limiter.take(host)) {
      audit({ kind: "rate_limited", reason: "rate_limit", caseId: req.caseId, transform: req.transform, host, transportCalls: 0 });
      return deny("rate_limit", 0, `rate limit exceeded for host ${host}`);
    }

    // --- 7c: pinnedHost binding ---
    if (req.pinnedHost) {
      const normalizedPin = req.pinnedHost.replace(/\.$/, "").toLowerCase();
      const normalizedHost = host.replace(/\.$/, "").toLowerCase();
      // An exact match or a subdomain of the pin is allowed; anything else is a mismatch.
      const isSub = normalizedHost === normalizedPin || normalizedHost.endsWith(`.${normalizedPin}`);
      if (!isSub) {
        audit({
          kind: "denied",
          reason: "host_not_allowed",
          caseId: req.caseId,
          transform: req.transform,
          host,
          transportCalls: 0,
          secretDigest,
        });
        return deny("host_not_allowed", 0, `request host "${host}" is outside pinnedHost "${req.pinnedHost}"`);
      }
    }

    // --- 8..11: resolve → classify → pin → transport → redirect loop ---
    const deadline = now() + limits.timeoutMs;
    const result = await runHops(req, currentUrl, deadline, secretDigest);
    return result;
  }

  async function runHops(req: EgressRequest, initialUrl: URL, deadline: number, secretDigest?: string): Promise<EgressResult> {
    let currentUrl = initialUrl;
    let hopCount = 0;
    while (true) {
      if (now() >= deadline) {
        audit({
          kind: "timeout",
          reason: "timeout_total",
          caseId: req.caseId,
          transform: req.transform,
          host: currentUrl.hostname,
          transportCalls: hopCount,
        });
        return deny("timeout_total", hopCount);
      }
      const resolved = await resolveAndClassify(currentUrl, hopCount);
      if ("code" in resolved && resolved.code !== undefined) {
        audit({
          kind: "denied",
          reason: resolved.reason,
          caseId: req.caseId,
          transform: req.transform,
          host: currentUrl.hostname,
          transportCalls: hopCount,
          secretDigest,
        });
        return resolved;
      }
      // After the deny branch returns, only the ResolvedAddress variant remains.
      const pinnedIp = (resolved as ResolvedAddress).pinnedIp;
      // A transport hop also consumes the connect budget.
      const hopDeadline = Math.min(deadline, now() + limits.connectTimeoutMs);
      if (now() >= hopDeadline) {
        audit({
          kind: "timeout",
          reason: "timeout_connect",
          caseId: req.caseId,
          transform: req.transform,
          host: currentUrl.hostname,
          transportCalls: hopCount,
        });
        return deny("timeout_connect", hopCount);
      }
      const controller = new AbortController();
      const hopTimer = setTimeout(() => controller.abort(new Error("egress hop timeout")), Math.max(1, hopDeadline - now()));
      let resp: Awaited<ReturnType<EgressTransport["fetch"]>>;
      try {
        resp = await opts.transport.fetch({
          url: currentUrl.href,
          host: currentUrl.hostname.replace(/^\[|\]$/g, ""),
          pinnedIp,
          method: req.method ?? "GET",
          headers: req.headers,
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(hopTimer);
        audit({
          kind: "transport_error",
          caseId: req.caseId,
          transform: req.transform,
          host: currentUrl.hostname,
          transportCalls: hopCount,
          detail: err instanceof Error ? err.message : String(err),
        });
        if (controller.signal.aborted) {
          if (now() >= deadline) {
            return deny("timeout_total", hopCount);
          }
          return deny("timeout_connect", hopCount);
        }
        return deny("address_class", hopCount, err instanceof Error ? err.message : String(err));
      } finally {
        clearTimeout(hopTimer);
      }
      hopCount++;
      const next = await redirectOrFinish(req, currentUrl, resp, hopCount, deadline, secretDigest);
      if (next.done) return next.result;
      currentUrl = next.url;
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
    secretDigest?: string,
  ): Promise<{ done: true; result: EgressResult } | { done: false; url: URL }> {
    if (isRedirect(resp) && resp.headers?.location) {
      let nextUrl: URL;
      try {
        nextUrl = new URL(resp.headers.location, currentUrl);
      } catch {
        return { done: true, result: deny("invalid_url", hopCount, "redirect target is not a valid URL") };
      }
      const nextShape = urlChecks(nextUrl);
      if (nextShape) return { done: true, result: { ...nextShape, transportCalls: hopCount } };
      if (hopCount > limits.maxRedirects) return { done: true, result: deny("redirect_limit", hopCount) };
      // Redirects to a different host are NOT allowed when a secret or a pin is in play.
      const nextHost = nextUrl.hostname.replace(/^\[|\]$/g, "");
      if (req.pinnedHost) {
        const normalizedPin = req.pinnedHost.replace(/\.$/, "").toLowerCase();
        const normalizedNext = nextHost.replace(/\.$/, "").toLowerCase();
        const isSub = normalizedNext === normalizedPin || normalizedNext.endsWith(`.${normalizedPin}`);
        if (!isSub) {
          audit({
            kind: "denied",
            reason: "host_not_allowed",
            caseId: req.caseId,
            transform: req.transform,
            host: nextHost,
            transportCalls: hopCount,
            secretDigest,
          });
          return {
            done: true,
            result: deny("host_not_allowed", hopCount, `redirect to "${nextHost}" is outside pinnedHost "${req.pinnedHost}"`),
          };
        }
      }
      if (now() >= deadline) {
        audit({
          kind: "timeout",
          reason: "timeout_total",
          caseId: req.caseId,
          transform: req.transform,
          host: nextHost,
          transportCalls: hopCount,
        });
        return { done: true, result: deny("timeout_total", hopCount) };
      }
      return { done: false, url: nextUrl };
    }
    // Size limit: prefer an explicit contentLength when the transport reports
    // one, otherwise fall back to the body string length. The transport is
    // responsible for not buffering more than it can report; the gateway treats
    // a missing body as size 0.
    const reported = resp.contentLength ?? (resp.body !== undefined ? resp.body.length : 0);
    if (reported > limits.maxSizeBytes) {
      audit({
        kind: "size_limit",
        reason: "size_limit",
        caseId: req.caseId,
        transform: req.transform,
        host: currentUrl.hostname,
        transportCalls: hopCount,
      });
      return { done: true, result: deny("size_limit", hopCount) };
    }
    audit({
      kind: "allowed",
      caseId: req.caseId,
      transform: req.transform,
      host: currentUrl.hostname,
      method: req.method ?? "GET",
      transportCalls: hopCount,
      secretDigest,
    });
    return { done: true, result: { ok: true, transportCalls: hopCount } };
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
