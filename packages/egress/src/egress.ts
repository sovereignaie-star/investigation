/**
 * Egress gateway (ADR-08). SIMULATION ONLY in this cycle:
 * there is NO real network adapter, NO real DNS resolver, and NO flag that
 * enables the network. Tests inject fake resolvers/transports.
 *
 * Pipeline (each step denies with a CLOSED reason set):
 *  1. runtime request validation (unknown fields rejected, deny-by-default)
 *  2. offline / no-case / undeclared-data / natural-person denials (pre-DNS)
 *  3. URL normalization + scheme/port/credentials/header checks
 *  4. pinned-host check (manifest allow-list, if pinned)
 *  5. injected resolver → classify EVERY address (all must be public)
 *  6. hand the transport a pinned IP + original hostname (no re-resolve)
 *  7. manual redirects with full policy re-check per hop (max 3)
 *  8. size / timeout limits enforced
 */

import { classifyAddress } from "./address-policy";

export type EgressDenyCode = "EGRESS_POLICY_DENIED";

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
  | "invalid_url";

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
}

export interface EgressResult {
  readonly ok: boolean;
  readonly code?: EgressDenyCode;
  readonly reason?: EgressReason;
  readonly detail?: string;
  /** Number of transport calls made (0 for any pre-transport denial). */
  readonly transportCalls: number;
}

/** Injectable DNS resolver (tests pass a fake). */
export interface DnsResolver {
  resolve(host: string): Promise<string[]>;
}

/** Injectable transport (tests pass a fake). Gets a PINNED address. */
export interface EgressTransport {
  fetch(req: {
    url: string;
    host: string;
    pinnedIp: string;
    method: string;
    headers?: Record<string, string>;
  }): Promise<{ status: number; body: string; headers?: Record<string, string> }>;
}

export interface EgressLimits {
  readonly maxRedirects?: number; // default 3
  readonly maxSizeBytes?: number; // default 5 MB
  readonly timeoutMs?: number; // default 15000
}

export interface EgressOptions {
  /** Must be true. Tests set it explicitly; no env var can enable the network. */
  readonly resolver: DnsResolver;
  readonly transport: EgressTransport;
  readonly limits?: EgressLimits;
  /** Simulate IR_OFFLINE=1 (deny-by-default; cannot be turned off by env). */
  readonly offline?: boolean;
}

const DEFAULT_LIMITS: Required<EgressLimits> = {
  maxRedirects: 3,
  maxSizeBytes: 5 * 1024 * 1024,
  timeoutMs: 15_000,
};

/** Data kinds that are allowed in `sends` for the public mode before P2-013. */
const PUBLIC_ALLOWED_SENDS = new Set(["domain", "ip", "asn", "hash", "url", "certificate"]);

function deny(reason: EgressReason, transportCalls = 0, detail?: string): EgressResult {
  return { ok: false, code: "EGRESS_POLICY_DENIED", reason, transportCalls, detail };
}

/** Pre-DNS policy checks (offline, case, sensitivity, sends, headers). */
function preDnsChecks(req: EgressRequest, offline: boolean): EgressResult | null {
  if (offline) return deny("offline");
  if (!req.caseId || !req.purposeRef) return deny("no_case");
  if (req.sensitivity === "natural_person_gate") return deny("natural_person");
  if (req.sensitivity !== undefined && !["normal", "natural_person_gate", "minor"].includes(req.sensitivity)) {
    return deny("unclassified_data");
  }
  if (req.sends === undefined) return deny("missing_manifest");
  for (const kind of req.sends) {
    if (!PUBLIC_ALLOWED_SENDS.has(kind)) return deny("undeclared_data");
  }
  if (req.headers) {
    for (const [, v] of Object.entries(req.headers)) {
      if (/[\r\n]/.test(v)) return deny("header");
    }
  }
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

export function createEgressGateway(opts: EgressOptions) {
  const limits = { ...DEFAULT_LIMITS, ...(opts.limits ?? {}) };

  async function request(req: EgressRequest): Promise<EgressResult> {
    // --- 1..5: pre-DNS policy (deny-by-default) ---
    const pre = preDnsChecks(req, opts.offline ?? false);
    if (pre) return pre;

    // --- 6: URL normalization ---
    let currentUrl: URL;
    try {
      currentUrl = new URL(req.url);
    } catch {
      return deny("invalid_url");
    }

    // --- 7: scheme / port / credentials ---
    const shape = urlChecks(currentUrl);
    if (shape) return shape;

    // --- 8..11: resolve → classify → pin → transport → redirect loop ---
    return runHops(req, currentUrl);
  }

  async function runHops(req: EgressRequest, initialUrl: URL): Promise<EgressResult> {
    let currentUrl = initialUrl;
    let hopCount = 0;
    while (true) {
      const resolved = await resolveAndClassify(currentUrl, hopCount);
      if ("code" in resolved) return resolved;
      const resp = await opts.transport.fetch({
        url: currentUrl.href,
        host: currentUrl.hostname,
        pinnedIp: resolved.pinnedIp,
        method: req.method ?? "GET",
        headers: req.headers,
      });
      hopCount++;
      const next = redirectOrFinish(currentUrl, resp, hopCount);
      if (next.done) return next.result;
      currentUrl = next.url;
    }
  }

  async function resolveAndClassify(url: URL, hopCount: number): Promise<{ pinnedIp: string } | EgressResult> {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const resolved = await opts.resolver.resolve(host);
    if (!resolved || resolved.length === 0) return deny("address_class", hopCount);
    let firstOk: string | undefined;
    for (const ip of resolved) {
      const v = classifyAddress(ip);
      if (!v.ok) return deny("address_class", hopCount);
      if (firstOk === undefined) firstOk = ip;
    }
    if (firstOk === undefined) return deny("address_class", hopCount);
    return { pinnedIp: firstOk };
  }

  function redirectOrFinish(
    currentUrl: URL,
    resp: { status: number; body?: string; headers?: Record<string, string> },
    hopCount: number,
  ): { done: true; result: EgressResult } | { done: false; url: URL } {
    if (isRedirect(resp) && resp.headers?.location) {
      const nextUrl = new URL(resp.headers.location, currentUrl);
      const nextShape = urlChecks(nextUrl);
      if (nextShape) return { done: true, result: { ...nextShape, transportCalls: hopCount } };
      if (hopCount > limits.maxRedirects) return { done: true, result: deny("redirect_limit", hopCount) };
      return { done: false, url: nextUrl };
    }
    if (resp.body && resp.body.length > limits.maxSizeBytes) {
      return { done: true, result: deny("size_limit", hopCount) };
    }
    return { done: true, result: { ok: true, transportCalls: hopCount } };
  }

  return { request };
}
