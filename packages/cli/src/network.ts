/**
 * Real-network mode for `ir run` (P2-003). This is the production path that joins an investigation case to the
 * internet, and it is narrow on purpose:
 *
 * - Opt-in twice: the operator passes `--network` AND the environment says `IR_ENABLE_NETWORK=1`
 *   (`IR_OFFLINE=1` always wins). Without both, nothing is sent.
 * - Never global: `--allow-host` names every host the run may reach (request and every redirect hop). There is
 *   no wildcard and no "any host" value.
 * - One gateway: the transform's `ctx.http` goes to `createEgressHttpTransport` -> `@ir/egress` (address
 *   classification of every resolved address, a pinned connection, TLS verified for the hostname, content
 *   inventory, redirect policy, size/time/rate limits, cancellation). This module adds no network code.
 * - Isolated: the transform runs in the T-SBX sandbox (`requireIsolation: true` with its module path); its only
 *   network is the IPC channel to this gateway. A transform without a known module path is refused.
 * - Public data only: the subject must be a catalog type the public mode may send (domain, ip, asn, hash, url,
 *   certificate) with normal sensitivity. Natural-person subjects stay refused until P2-013.
 * - Polite: page-fetching transforms (TR-010) obey the source's robots.txt (RFC 9309, ADR-08 decision C). It is
 *   fetched through the same gateway once per origin per run; 4xx means no file (allowed), 5xx or unreachable
 *   means complete disallow. A disallowed page is refused before the gateway is asked for it.
 * - Recorded: every gateway decision (allowed and denied) is written to the case's audit chain with the host,
 *   reason and transport-call count; the response is stored as evidence by the caller (URL, status, fetchedAt).
 */
import { existsSync } from "node:fs";
import { specById } from "@ir/core/identifiers";
import {
  createProductionEgress,
  parseRobots,
  robotsFromStatus,
  sendKindOf,
  type RobotsPolicy,
  type DnsResolver,
  type EgressAuditEvent,
  type EgressGateway,
  type EgressLimits,
  type EgressTransport,
  type ByteBudget,
} from "@ir/egress";
import { createEgressHttpTransport, TransportError, type HttpTransport, type TransportResponse } from "@ir/engine";
import type { Case } from "@ir/store";
import type { RegisteredTransform } from "./registry.ts";

const PUBLIC_SEND_KINDS = new Set(["domain", "ip", "asn", "hash", "url", "certificate"]);

/** Injected only by tests: the real resolver/transport are replaced, every policy and opt-in stays real. */
export interface NetworkDeps {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly resolver?: DnsResolver;
  readonly transport?: EgressTransport;
  /** Tighter gateway limits (tests of the timeout/size refusals). Production uses the gateway defaults. */
  readonly limits?: EgressLimits;
  /** Overrides the module path table (tests of the "unknown module" refusal). */
  readonly isolatedModules?: Readonly<Record<string, string>>;
}

export interface NetworkPlan {
  readonly transport: HttpTransport;
  readonly isolatedModule: string;
  readonly allowedHosts: readonly string[];
  /** Gateway decisions seen during the run (also written to the case audit chain). */
  readonly events: EgressAuditEvent[];
}

/**
 * P2-038 — one gateway for a whole investigation: its per-host rate budget, address checks and audit sink are
 * shared by every run, so a series of transforms against the same source cannot reset the budget run by run.
 */
export interface NetworkGateway {
  readonly gateway: EgressGateway;
  readonly allowedHosts: readonly string[];
  /** Gateway decisions seen so far (also written to the case audit chain). */
  readonly events: EgressAuditEvent[];
}

export function openGateway(c: Case, allowHosts: readonly string[], deps: NetworkDeps): NetworkGateway | { error: string } {
  const events: EgressAuditEvent[] = [];
  const decision = createProductionEgress({
    allowedHosts: allowHosts,
    env: deps.env ?? process.env,
    ...(deps.resolver ? { resolver: deps.resolver } : {}),
    ...(deps.transport ? { transport: deps.transport } : {}),
    ...(deps.limits ? { limits: deps.limits } : {}),
    auditSink: {
      record(e) {
        events.push(e);
        // A refusal before DNS may carry no host; the target is then the transform that asked.
        c.audit(`egress.${e.kind}`, e.host || e.transform || "egress", {
          transform: e.transform ?? null,
          reason: e.reason ?? null,
          transportCalls: e.transportCalls,
          ...(e.detail ? { detail: e.detail } : {}),
        });
      },
    },
  });
  if (!decision.enabled) return { error: `--network: ${decision.reason}` };
  return { gateway: decision.gateway, allowedHosts: decision.allowedHosts, events };
}

/** The transport and sandbox module for one transform run on one subject type, through an open gateway. */
export function networkRunFor(
  c: Case,
  gw: NetworkGateway,
  entry: RegisteredTransform,
  subjectType: string,
  deps: NetworkDeps,
  byteBudget?: ByteBudget,
  /** P2-040: applied to EVERY transport the plan hands out (the page transport AND the robots transport), so the investigation's request counter sees robots.txt fetches and redirect hops too. */
  wrapTransport?: (t: HttpTransport) => HttpTransport,
): NetworkPlan | { error: string } {
  const spec = specById(subjectType);
  if (!spec) return { error: `subject type "${subjectType}" is not a catalog identifier type` };
  const kind = sendKindOf(spec.id, spec.category);
  if (spec.sensitivity !== "normal" || !PUBLIC_SEND_KINDS.has(kind)) {
    return { error: `--network: subject type "${subjectType}" is not public data the gateway may send (P2-013 pending)` };
  }
  const transform = entry.transform;
  // P2-037: the sandbox module comes from the registry entry (one explicit path per registered transform).
  const isolatedModule = deps.isolatedModules ? deps.isolatedModules[transform.manifest.id] : entry.module;
  if (!isolatedModule || !existsSync(isolatedModule)) {
    return { error: `--network: ${transform.manifest.id} has no sandbox module here; network runs are isolated only` };
  }
  const caseId = c.info().id;
  const baseRequest = {
    caseId,
    purposeRef: `case:${caseId}`,
    transform: `${transform.manifest.id}@${transform.manifest.version}`,
    // P2-037: the subject's kind plus every kind the transform's request URLs inevitably carry (registry `sends`).
    sends: [...new Set([kind, ...entry.sends])],
    sensitivity: "normal",
    // P2-039: the registry's fixed bootstrap paths (not case data) and the investigation's shared byte budget.
    ...(entry.staticPaths && entry.staticPaths.length > 0 ? { staticPaths: [...entry.staticPaths] } : {}),
    ...(byteBudget ? { byteBudget } : {}),
  };
  const transport = createEgressHttpTransport({ gateway: gw.gateway, baseRequest });
  // The fixed path "/robots.txt" reads as a domain to the content inventory; it is declared a fixed path of this
  // code on any allowed host (P2-039) instead of declaring `domain` for the robots request.
  const robotsTransport = createEgressHttpTransport({
    gateway: gw.gateway,
    baseRequest: { ...baseRequest, staticPaths: [...(baseRequest.staticPaths ?? []), "*/robots.txt"] },
  });
  // P2-040: the counter wraps both transports (page + robots) BEFORE robotsGuard combines them, so every request
  // that reaches the gateway — a page, a redirect hop, or a robots.txt fetch — is counted once, and none is sent
  // once the budget is exhausted. Without this, a robots.txt fetch was invisible to maxRequests.
  const wrap = wrapTransport ?? ((t: HttpTransport) => t);
  const guarded = entry.pageFetch ? robotsGuard(wrap(transport), wrap(robotsTransport), c) : wrap(transport);
  return { transport: guarded, isolatedModule, allowedHosts: gw.allowedHosts, events: gw.events };
}

/** One `ir run --network`: its own gateway and one transform run. */
export function planNetworkRun(
  c: Case,
  entry: RegisteredTransform,
  subjectType: string,
  allowHosts: readonly string[],
  deps: NetworkDeps,
): NetworkPlan | { error: string } {
  // The subject and module checks come before the gateway is opened (no audit noise for a refused plan).
  const spec = specById(subjectType);
  if (!spec) return { error: `subject type "${subjectType}" is not a catalog identifier type` };
  const kind = sendKindOf(spec.id, spec.category);
  if (spec.sensitivity !== "normal" || !PUBLIC_SEND_KINDS.has(kind)) {
    return { error: `--network: subject type "${subjectType}" is not public data the gateway may send (P2-013 pending)` };
  }
  const isolatedModule = deps.isolatedModules ? deps.isolatedModules[entry.transform.manifest.id] : entry.module;
  if (!isolatedModule || !existsSync(isolatedModule)) {
    return { error: `--network: ${entry.transform.manifest.id} has no sandbox module here; network runs are isolated only` };
  }
  const gw = openGateway(c, allowHosts, deps);
  if ("error" in gw) return gw;
  return networkRunFor(c, gw, entry, subjectType, deps);
}

async function bodyText(r: TransportResponse): Promise<string> {
  if (typeof r.body === "string") return r.body;
  if (r.body instanceof Uint8Array) return new TextDecoder().decode(r.body);
  return new Response(r.body).text();
}

/**
 * Wraps the gateway transport with the robots.txt policy. The robots.txt request is an ordinary gateway request
 * (same host list, address checks, limits, audit). Its outcome and each refusal are written to the audit chain
 * with the host only (no path: the path may carry the subject).
 */
export function robotsGuard(inner: HttpTransport, robotsTransport: HttpTransport, c: Case): HttpTransport {
  const policies = new Map<string, Promise<RobotsPolicy>>();
  const policyFor = (origin: string, host: string, signal: AbortSignal): Promise<RobotsPolicy> => {
    let p = policies.get(origin);
    if (!p) {
      p = (async () => {
        let policy: RobotsPolicy;
        try {
          const r = await robotsTransport.fetch({ method: "GET", url: `${origin}/robots.txt` }, signal);
          policy = r.status >= 200 && r.status < 300 ? parseRobots(await bodyText(r)) : robotsFromStatus(r.status);
        } catch (x) {
          // A gateway refusal (address class, host list, content) or a cancellation is the answer for the page
          // too: report it as is. Only a failure to reach the source makes robots.txt "unreachable".
          if (x instanceof TransportError && (x.kind === "transport:cancelled" || x.kind === "transport:ssrf-blocked")) throw x;
          policy = robotsFromStatus("unreachable");
        }
        c.audit("robots.policy", host, { basis: policy.basis });
        return policy;
      })();
      policies.set(origin, p);
    }
    return p;
  };
  return {
    async fetch(req, signal) {
      const u = new URL(req.url);
      if (u.pathname === "/robots.txt") return robotsTransport.fetch(req, signal);
      const policy = await policyFor(u.origin, u.hostname, signal);
      if (!policy.isAllowed(u.pathname + u.search)) {
        c.audit("robots.disallowed", u.hostname, { basis: policy.basis });
        throw new TransportError("transport:ssrf-blocked", `robots.txt on ${u.hostname} disallows this path (${policy.basis})`, {
          retryable: false,
        });
      }
      return inner.fetch(req, signal);
    },
  };
}
