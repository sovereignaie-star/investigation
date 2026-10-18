/**
 * Production egress composition (P2-003 / ADR-08). This is the ONLY place that joins the gateway to the real
 * resolver (system-resolver.ts) and the real transport (node-transport.ts). It is deliberately narrow:
 *
 * - Off by default. The network is enabled only when the environment says `IR_ENABLE_NETWORK=1` exactly, and
 *   `IR_OFFLINE=1` always wins (the gateway also honours it on every request).
 * - Never global. An explicit, non-empty list of authorised hosts is mandatory; every request and every redirect
 *   hop must stay on it (`allowedHosts`, T-SEC-SSRF-045). Literal IPs, wildcards, ports and paths are refused as
 *   list entries, so the list names sources, not networks.
 * - Same gateway. All SSRF, address-class, content-inventory, redirect, size, time, rate and cancellation rules
 *   are the gateway's; this module adds none and bypasses none.
 *
 * Returning a decision (not throwing) lets callers report precisely why the network is off.
 */
import { isIP } from "node:net";
import { POST_POLICIES } from "../providers/post-policies.ts";
import {
  createEgressGateway,
  type ProviderQueryAllow,
  type DnsResolver,
  type EgressAuditSink,
  type EgressGateway,
  type EgressLimits,
  type EgressRouting,
  type EgressTransport,
} from "./egress.ts";
import { createNodeTransport } from "./node-transport.ts";
import { createSystemResolver } from "./system-resolver.ts";

export interface ProductionEgressConfig {
  /** Hosts the caller is authorised to reach (exact names, lower case after normalisation). Required, non-empty. */
  readonly allowedHosts: readonly string[];
  /** Environment to read the opt-in from. Default `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly auditSink?: EgressAuditSink;
  readonly limits?: EgressLimits;
  /**
   * ADR-30: the unified POST policy table. Defaults to the ADR-30 registry data
   * (POST_POLICIES — packages/egress/providers/post-policies.ts). Changing or adding a row
   * is an ADR-30 review (a table row + a small PR); the host/path pins of the migrated
   * ADR-27/28/29 exceptions now live in that table, not here.
   */
  readonly postPolicies?: readonly import("./post-policy.ts").PostPolicy[];
  /**
   * Replace the real resolver / transport. ONLY for deterministic tests of the composition itself; the opt-in and
   * the allow-list are enforced exactly as in production.
   */
  readonly resolver?: DnsResolver;
  readonly transport?: EgressTransport;
  /**
   * P2-016: the provider registry (name -> exact hosts) for secret-bearing requests — passed through
   * to the gateway's `providerHosts`. Unset = no secret request can pass (fail-closed, unchanged
   * behavior for existing callers). The CLI derives this from the run's registry entry.
   */
  readonly providerHosts?: Readonly<Record<string, readonly string[]>>;
  /**
   * P2-016: provider name -> exact paths a secret may be sent to (the gateway's `providerPaths`,
   * T-SEC-SSRF-042). Unset disables the path restriction — the CLI always sets both when a secret
   * binding exists, never one without the other.
   */
  readonly providerPaths?: Readonly<Record<string, readonly string[]>>;
  /**
   * P2-016 continuation (owner decision 2026-10-16): provider name -> the closed query-parameter
   * allowlist for secret-bearing requests (the gateway's `providerQueries`). Passed only together
   * with `providerHosts` + `providerPaths` (the registry config is all-or-nothing); a provider
   * absent from the map keeps the fail-closed default (every query refused).
   */
  readonly providerQueries?: Readonly<Record<string, readonly ProviderQueryAllow[]>>;
  /**
   * P2-026 (owner decision 2026-10-17): provider name -> the closed path templates for
   * subject-in-the-path providers (the gateway's `providerPathTemplates`). Passed only together
   * with `providerHosts` + `providerPaths` (the registry config is all-or-nothing); a provider
   * absent from the map keeps the fail-closed default (every path refused unless a literal or
   * template row matches).
   */
  readonly providerPathTemplates?: Readonly<Record<string, readonly import("./path-template.ts").PathParameterTemplate[]>>;
  /**
   * P2-028 (ADR-31): the case's routing — a strict proxy (HTTP CONNECT or SOCKS5, the pinned target
   * IP is handed to the proxy) or Tor (the domain is handed to the exit). Unset = direct (ADR-08).
   * Tor is NEVER implicit: the CLI only sets it from the case's explicit `proxy.set` chain / `--via-tor`.
   */
  readonly routing?: EgressRouting;
}

export type ProductionEgressDecision =
  | { readonly enabled: true; readonly gateway: EgressGateway; readonly allowedHosts: readonly string[] }
  | { readonly enabled: false; readonly reason: string };

const HOST_LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/**
 * P2-016: hosts + paths together or neither. If only one is configured the other is dropped too —
 * dropping the hosts (or both) is always fail-closed (the gateway refuses every secret request
 * when the provider is missing from `providerHosts`), so a half-configured registry can never
 * weaken the pinning.
 */
function providerRegistryConfig(cfg: ProductionEgressConfig): {
  providerHosts?: ProductionEgressConfig["providerHosts"];
  providerPaths?: ProductionEgressConfig["providerPaths"];
  providerQueries?: ProductionEgressConfig["providerQueries"];
  providerPathTemplates?: ProductionEgressConfig["providerPathTemplates"];
} {
  if (!cfg.providerHosts || !cfg.providerPaths) return {};
  return {
    providerHosts: cfg.providerHosts,
    providerPaths: cfg.providerPaths,
    ...(cfg.providerQueries ? { providerQueries: cfg.providerQueries } : {}),
    ...(cfg.providerPathTemplates ? { providerPathTemplates: cfg.providerPathTemplates } : {}),
  };
}

/**
 * ADR-27: the default pinned OAuth2 token host(s). Currently the OpenSky Network auth realm (TR-040).
 * Any change or addition to this list is an ADR-level decision (ADR-27 condition 4).
 */

/** Validates one allow-list entry: a DNS hostname with at least two labels, no IP, wildcard, port or path. */
export function validAllowedHost(entry: string): string | null {
  const h = entry.trim().toLowerCase().replace(/\.$/, "");
  if (h === "" || h.length > 253 || isIP(h) !== 0) return null;
  const labels = h.split(".");
  if (labels.length < 2 || !labels.every((l) => HOST_LABEL.test(l))) return null;
  if (/^\d+$/.test(labels[labels.length - 1] ?? "")) return null;
  return h;
}

export function createProductionEgress(cfg: ProductionEgressConfig): ProductionEgressDecision {
  const env = cfg.env ?? process.env;
  if (env["IR_OFFLINE"] === "1") return { enabled: false, reason: "IR_OFFLINE=1: the network is disabled" };
  if (env["IR_ENABLE_NETWORK"] !== "1") {
    return { enabled: false, reason: "real network is off: set IR_ENABLE_NETWORK=1 to enable it for an explicit host list" };
  }
  if (cfg.allowedHosts.length === 0) return { enabled: false, reason: "no authorised hosts: the network is never enabled globally" };
  const hosts: string[] = [];
  for (const entry of cfg.allowedHosts) {
    const h = validAllowedHost(entry);
    if (h === null)
      return { enabled: false, reason: `invalid authorised host "${entry}" (a hostname only: no IP, wildcard, port or path)` };
    if (!hosts.includes(h)) hosts.push(h);
  }
  const gateway = createEgressGateway({
    resolver: cfg.resolver ?? createSystemResolver(),
    transport: cfg.transport ?? createNodeTransport(),
    allowedHosts: hosts,
    postPolicies: cfg.postPolicies ?? POST_POLICIES,
    ...(cfg.limits ? { limits: cfg.limits } : {}),
    ...(cfg.auditSink ? { auditSink: cfg.auditSink } : {}),
    // P2-016: the provider registry for secret-bearing runs — hosts + paths together or neither
    // (dropping one alone is always the fail-closed direction: no secret request passes).
    ...providerRegistryConfig(cfg),
    // P2-028 (ADR-31): the case's routing — unset is direct; Tor never implicit.
    ...(cfg.routing ? { routing: cfg.routing } : {}),
  });
  return { enabled: true, gateway, allowedHosts: hosts };
}
