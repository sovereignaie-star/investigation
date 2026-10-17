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
import path from "node:path";
import { specById } from "@ir/core/identifiers";
import {
  createProductionEgress,
  registryEntryForSecret,
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
  type RequestBudget,
} from "@ir/egress";
import { createEgressHttpTransport, TransportError, type HttpTransport, type TransportResponse, type SecretBinding } from "@ir/engine";
import { vaultFromEnv, type Case, type Vault } from "@ir/store";
import type { RegisteredTransform } from "./registry.ts";

const PUBLIC_SEND_KINDS = new Set(["domain", "ip", "asn", "hash", "url", "certificate"]);

/**
 * E-02 (P2-013): the natural-person subject types the CLI may run when the investigation's purpose
 * confirmation is present. person_name is a screening subject (a name the operator typed); the
 * transforms that take it download fixed files and match locally, so the name never appears in a
 * request URL, header or body. The egress inventory still refuses any natural-person identifier
 * found on the wire (?passport=AB123456), so this set does not weaken outbound inspection.
 */
const PURPOSE_CONFIRMED_SUBJECTS = new Set(["person_name"]);

/** Injected only by tests: the real resolver/transport are replaced, every policy and opt-in stays real. */
export interface NetworkDeps {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly resolver?: DnsResolver;
  readonly transport?: EgressTransport;
  /** Tighter gateway limits (tests of the timeout/size refusals). Production uses the gateway defaults. */
  readonly limits?: EgressLimits;
  /** Overrides the module path table (tests of the "unknown module" refusal). */
  readonly isolatedModules?: Readonly<Record<string, string>>;
  /**
   * P2-016: opens the vault lazily, only when the transform's manifest declares a secret. The
   * default opens the same vault the server uses (IR_VAULT_KEY / IR_VAULT_PASSPHRASE / vault.key
   * beside IR_DATA_DIR or ./data). A run without declared secrets never touches the vault.
   */
  readonly vault?: () => Vault;
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

/** P2-016: the run's transport — the gateway adapter, plus the secret binding when one exists. */
function runTransport(
  gw: NetworkGateway,
  baseRequest: Parameters<typeof createEgressHttpTransport>[0]["baseRequest"],
  secretBinding?: SecretBinding,
): HttpTransport {
  return createEgressHttpTransport(
    secretBinding ? { gateway: gw.gateway, baseRequest, secretBinding } : { gateway: gw.gateway, baseRequest },
  );
}

export function openGateway(
  c: Case,
  allowHosts: readonly string[],
  deps: NetworkDeps,
  /**
   * P2-016: the run's provider registry config (hosts + paths, both or neither; the query allowlist
   * rides along when the provider's registry entry declares one — P2-016 continuation).
   */
  providers?: {
    providerHosts: Record<string, readonly string[]>;
    providerPaths: Record<string, readonly string[]>;
    providerQueries?: Record<string, readonly import("@ir/egress").ProviderQueryAllow[]>;
    providerPathTemplates?: Record<string, readonly import("@ir/egress").PathParameterTemplate[]>;
  },
): NetworkGateway | { error: string } {
  const events: EgressAuditEvent[] = [];
  const decision = createProductionEgress({
    allowedHosts: allowHosts,
    env: deps.env ?? process.env,
    ...(providers
      ? {
          providerHosts: providers.providerHosts,
          providerPaths: providers.providerPaths,
          ...(providers.providerQueries ? { providerQueries: providers.providerQueries } : {}),
          ...(providers.providerPathTemplates ? { providerPathTemplates: providers.providerPathTemplates } : {}),
        }
      : {}),
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
          // P2-014: transport events carry the call's URL, status/error and hop index (every actual
          // transport call — first hop, redirects, failures — is exactly one log row).
          ...(e.url ? { url: e.url } : {}),
          ...(e.status !== undefined ? { status: e.status } : {}),
          ...(e.error !== undefined ? { error: e.error } : {}),
          ...(e.attempt !== undefined ? { attempt: e.attempt } : {}),
        });
      },
    },
  });
  if (!decision.enabled) return { error: `--network: ${decision.reason}` };
  return { gateway: decision.gateway, allowedHosts: decision.allowedHosts, events };
}

/** The transform-level E-02 mirror (P2-026/TR-051): a transform whose manifest declares
 *  natural_person_gate — the RESPONSE carries natural-person data (e.g. a domain's people's public
 *  emails) — runs only under a case with a stated purpose. E-01 guarantees a purpose at case
 *  creation, so an empty purpose is the legacy pre-P1-028 database shape — refused fail-closed before
 *  any transport, exactly like the subject-level check in this file. The deeper question — whether
 *  response-side natural-person data should require an EXPLICIT per-run purpose confirmation (the
 *  engine's PurposeConfirmation mechanism, currently unwired in the CLI paths) beyond the case's
 *  stated purpose — is an open owner decision documented in the P2-026 STATUS row. */
function naturalPersonTransformGate(c: Case, entry: RegisteredTransform): string | undefined {
  if (entry.transform.manifest.sensitivity !== "natural_person_gate") return undefined;
  if (c.info().purpose.trim() !== "") return undefined;
  return `--network: ${entry.transform.manifest.id} returns natural-person data (natural_person_gate); this case has no stated purpose (E-01/E-02)`;
}

/** The subject-level E-02 rule (P2-013): a natural-person subject (person_name) may run only when the
 *  investigation's purpose confirmation is present in the run plan; the engine's gate refuses without
 *  one, so the subject never reaches networkRunFor without it. The subject IS the screening input (the
 *  name is what the operator typed), it never appears in a request URL/header/body — the transforms
 *  download fixed files and match locally — and the inventory still refuses any natural-person identifier
 *  found on the wire. Minor subjects stop auto-expansion (E-08). */
function subjectGateRefusal(spec: ReturnType<typeof specById>, kind: ReturnType<typeof sendKindOf>): string | undefined {
  const personGateOk = spec?.sensitivity === "natural_person_gate" && PURPOSE_CONFIRMED_SUBJECTS.has(spec.id);
  if (spec?.sensitivity === "minor" || (!PUBLIC_SEND_KINDS.has(kind) && !personGateOk)) {
    return "--network: subject type is not data the gateway may send (P2-013)";
  }
  return undefined;
}

/** The transport and sandbox module for one transform run on one subject type, through an open gateway. */
export function networkRunFor(
  c: Case,
  gw: NetworkGateway,
  entry: RegisteredTransform,
  subjectType: string,
  deps: NetworkDeps,
  byteBudget?: ByteBudget,
  /**
   * P2-041: the investigation's request budget — one `RequestBudget` shared by every transport of this run
   * (the page transport AND the robots transport). The gateway's `runHops` takes one from it before EVERY hop's
   * DNS (first hop and every redirect), so `state.requests` == actual transport calls == limit, and nothing
   * starts after exhaustion (replaces P2-040's `wrapTransport`, which saw one entry request and could not see
   * the redirect hops inside the gateway's hop loop).
   */
  requestBudget?: RequestBudget,
  /**
   * P2-016 (D-031): the run's secret binding (registry entry + vault reader). When present, the
   * adapter injects the key into the provider's header on requests to the provider's hosts — never
   * the URL — and refuses fail-closed when the credential is unavailable.
   */
  secretBinding?: SecretBinding,
): NetworkPlan | { error: string } {
  const spec = specById(subjectType);
  if (!spec) return { error: `subject type "${subjectType}" is not a catalog identifier type` };
  const kind = sendKindOf(spec.id, spec.category);
  // E-02 (P2-026/TR-051): the transform-level mirror of the natural-person-subject rule below.
  const transformGateRefusal = naturalPersonTransformGate(c, entry);
  if (transformGateRefusal !== undefined) return { error: transformGateRefusal };
  const gateRefusal = subjectGateRefusal(spec, kind);
  if (gateRefusal !== undefined) return { error: `${gateRefusal} (type "${subjectType}")` };
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
    // P2-041: the investigation's shared request budget, counted per hop inside the gateway.
    ...(requestBudget ? { requestBudget } : {}),
  };
  const transport = runTransport(gw, baseRequest, secretBinding);
  // The fixed path "/robots.txt" reads as a domain to the content inventory; it is declared a fixed path of this
  // code on any allowed host (P2-039) instead of declaring `domain` for the robots request.
  const robotsTransport = createEgressHttpTransport({
    gateway: gw.gateway,
    baseRequest: { ...baseRequest, staticPaths: [...(baseRequest.staticPaths ?? []), "*/robots.txt"] },
  });
  // P2-040/P2-041: the request budget is a field of the gateway request (one per hop, taken inside runHops
  // before DNS), shared by the page and robots transports — robots.txt fetches and redirect hops are counted,
  // and nothing is sent once the budget is exhausted.
  const guarded = entry.pageFetch ? robotsGuard(transport, robotsTransport, c) : transport;
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
  // E-02 (P2-013): a natural-person subject runs only under a case whose stated purpose is the
  // confirmation (E-01 requires a >= 10-char purpose at case creation; an empty purpose means the
  // case predates that record and cannot gate a person run).
  const spec0 = specById(subjectType);
  if (spec0?.sensitivity === "natural_person_gate" && c.info().purpose.trim() === "") {
    return { error: `--network: subject type "${subjectType}" is a natural-person subject; this case has no stated purpose (E-01/E-02)` };
  }
  // The subject and module checks come before the gateway is opened (no audit noise for a refused plan).
  const spec = specById(subjectType);
  if (!spec) return { error: `subject type "${subjectType}" is not a catalog identifier type` };
  const kind = sendKindOf(spec.id, spec.category);
  // E-02 (P2-013): the same natural-person-subject rule as networkRunFor (person_name is a screening
  // subject; the transforms that take it download fixed files and match locally, so the name never
  // appears on the wire).
  const personGateOk = spec.sensitivity === "natural_person_gate" && PURPOSE_CONFIRMED_SUBJECTS.has(spec.id);
  if (spec.sensitivity === "minor" || (!PUBLIC_SEND_KINDS.has(kind) && !personGateOk)) {
    return { error: `--network: subject type "${subjectType}" is not data the gateway may send (P2-013)` };
  }
  const isolatedModule = deps.isolatedModules ? deps.isolatedModules[entry.transform.manifest.id] : entry.module;
  if (!isolatedModule || !existsSync(isolatedModule)) {
    return { error: `--network: ${entry.transform.manifest.id} has no sandbox module here; network runs are isolated only` };
  }
  // P2-016 (D-031): the manifest's declared secret resolved to a registry binding — the key
  // travels in the provider's header only (never the URL), read from the vault fresh per request.
  // Refusals come before the gateway is opened (no audit noise for a refused plan); the run is
  // never sent without the key.
  const secret = resolveSecretBinding(entry.transform.manifest, deps);
  if (secret.error) return { error: secret.error };
  const gw = openGateway(c, allowHosts, deps, secret.providers);
  if ("error" in gw) return gw;
  return networkRunFor(c, gw, entry, subjectType, deps, undefined, undefined, secret.binding);
}

/**
 * P2-016: manifest secrets (UPPER_SNAKE) -> the provider registry entry -> the vault. One binding
 * per run (multi-secret manifests are refused explicitly, never silently picked); a secret with no
 * registry entry (key-in-URL-only providers: shodan, etherscan) is refused by policy D-031/P2-016;
 * a locked vault or a missing entry refuses the run rather than sending it keyless.
 */
export function resolveSecretBinding(
  manifest: { id: string; secrets?: readonly string[] },
  deps: NetworkDeps,
): {
  binding?: SecretBinding;
  providers?: {
    providerHosts: Record<string, readonly string[]>;
    providerPaths: Record<string, readonly string[]>;
    providerQueries?: Record<string, readonly import("@ir/egress").ProviderQueryAllow[]>;
  };
  error?: string;
} {
  const secretNames = manifest.secrets ?? [];
  if (secretNames.length === 0) return {};
  if (secretNames.length > 1) {
    return {
      error: `--network: ${manifest.id} declares multiple secrets (${secretNames.join(", ")}); one credential binding per run is supported (P2-016)`,
    };
  }
  const secretName = secretNames[0];
  if (!secretName) return {};
  const registryEntry = registryEntryForSecret(secretName);
  if (!registryEntry) {
    return {
      error: `--network: ${manifest.id} requires ${secretName}, which has no header-compatible provider registry entry (providers that accept the key only in the URL — shodan, etherscan — are refused by policy D-031/P2-016)`,
    };
  }
  const openVault = deps.vault ?? (() => vaultFromEnv(process.env, process.env["IR_DATA_DIR"] ?? path.resolve("data")));
  let vault: Vault;
  try {
    vault = openVault();
  } catch {
    // The opener's own error text is not propagated (it could carry anything); a fixed message.
    return {
      error: `--network: ${manifest.id} requires ${secretName} but the vault could not be opened (locked or unreadable); the run is refused rather than sent without the key`,
    };
  }
  if (!vault.has(registryEntry.vaultEntry)) {
    return {
      error: `--network: ${manifest.id} requires ${secretName} but the vault has no entry "${registryEntry.vaultEntry}"; set it before running — the run is refused rather than sent without the key`,
    };
  }
  // P2-026 (owner decision 2026-10-17 — the vault credential_pair extension): a provider whose
  // credential is a PAIR (API ID + secret, e.g. Censys' HTTP Basic auth) reads its pair from the
  // vault entry and the CLI builds the provider's documented pair-credential header value from
  // it; the gateway injects that value in the entry's secretHeader exactly as a single key. A
  // vault entry that is not a pair is a designed refusal — the run is never sent with a
  // half-credential or a misread single secret.
  if (registryEntry.credentialKind === "credential_pair") {
    if (vault.kindOf(registryEntry.vaultEntry) !== "credential_pair") {
      return {
        error: `--network: ${manifest.id} requires ${secretName} as a credential PAIR (API ID + secret) but the vault entry "${registryEntry.vaultEntry}" is not a pair; set it in the pair form — the run is refused rather than sent with a half-credential`,
      };
    }
    return {
      binding: {
        secretProvider: registryEntry.name,
        hosts: registryEntry.hosts,
        secretHeader: registryEntry.secretHeader,
        requestPaths: registryEntry.requestPaths,
        readSecret: () => {
          const pair = vault.revealPair(registryEntry.vaultEntry);
          return pair === undefined ? undefined : `Basic ${Buffer.from(`${pair.id}:${pair.secret}`, "utf8").toString("base64")}`;
        },
      },
      providers: {
        providerHosts: { [registryEntry.name]: registryEntry.hosts },
        providerPaths: { [registryEntry.name]: registryEntry.requestPaths },
        ...(registryEntry.queryAllowlist ? { providerQueries: { [registryEntry.name]: registryEntry.queryAllowlist } } : {}),
        ...(registryEntry.requestPathTemplates
          ? { providerPathTemplates: { [registryEntry.name]: registryEntry.requestPathTemplates } }
          : {}),
      },
    };
  }
  return {
    binding: {
      secretProvider: registryEntry.name,
      hosts: registryEntry.hosts,
      secretHeader: registryEntry.secretHeader,
      requestPaths: registryEntry.requestPaths,
      readSecret: () => vault.reveal(registryEntry.vaultEntry),
    },
    providers: {
      providerHosts: { [registryEntry.name]: registryEntry.hosts },
      providerPaths: { [registryEntry.name]: registryEntry.requestPaths },
      // P2-016 continuation (owner decision 2026-10-16): the entry's closed query allowlist, when
      // it declares one; a provider without an allowlist keeps the fail-closed default (no query).
      ...(registryEntry.queryAllowlist ? { providerQueries: { [registryEntry.name]: registryEntry.queryAllowlist } } : {}),
      // P2-026 (owner decision 2026-10-17): the entry's closed path templates, when it declares
      // them (the subject-carrying-path providers) — enforced centrally by the gateway.
      ...(registryEntry.requestPathTemplates
        ? { providerPathTemplates: { [registryEntry.name]: registryEntry.requestPathTemplates } }
        : {}),
    },
  };
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
