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
  type EgressRouting,
  type EgressTransport,
  type ByteBudget,
  type RequestBudget,
} from "@ir/egress";
import {
  createEgressHttpTransport,
  naturalPersonGate,
  TransportError,
  type HttpTransport,
  type PurposeConfirmation,
  type TransportResponse,
  type SecretBinding,
} from "@ir/engine";
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

/** P2-028 (ADR-31): the case's proxy configuration, as recorded on its audit chain. */
export interface CaseProxyConfig {
  readonly route: "proxy-http-connect" | "proxy-socks5" | "tor";
  readonly host: string;
  readonly port: number;
  readonly secretName: string;
}

/**
 * P2-028 (ADR-31): the case's CURRENT proxy configuration — the LATEST `proxy.set`/`proxy.clear`
 * event on the case's audit chain wins (the same latest-wins rule as P2-029's source toggles).
 * `undefined` means direct (no proxy configured).
 */
export function caseProxyConfig(c: Case): CaseProxyConfig | undefined {
  let config: CaseProxyConfig | undefined;
  for (const ev of c.auditTrail()) {
    if (ev.action === "proxy.clear") {
      config = undefined;
      continue;
    }
    if (ev.action !== "proxy.set") continue;
    const d = (ev.detail ?? {}) as Record<string, unknown>;
    const route = d["route"];
    const host = d["host"];
    const port = d["port"];
    const secretName = d["secretName"];
    if (
      (route === "proxy-http-connect" || route === "proxy-socks5" || route === "tor") &&
      typeof host === "string" &&
      typeof port === "number" &&
      typeof secretName === "string"
    ) {
      config = { route, host, port, secretName };
    }
  }
  return config;
}

/**
 * P2-028 (ADR-31): builds the gateway's routing from the case's proxy configuration. Fail-closed,
 * twice: the proxy's credentials are a VAULT credential_pair entry (username + password) resolved
 * by name — a missing entry, or one that is not a pair, refuses the run BEFORE the gateway opens;
 * and `--via-tor` is only honoured when the case's routing IS the tor route (Tor is never implicit —
 * a tor `proxy.set` is the case's EXPLICIT activation, ADR-31).
 */
/**
 * ADR-31 (P2-028, item هـ): did the case's proxy configuration CHANGE since the last network run?
 * True when the most recent proxy.set/proxy.clear on the chain is NEWER than the last egress event —
 * the next run's first liveness check is then labelled `rotation` instead of `startup`.
 */
function proxyRotatedSinceLastRun(c: Case): boolean {
  // The trail is in chain (seq) order; the parsed audit events carry no seq, so the POSITION decides.
  // A ROTATION means: the case has already run through a proxy before (a proxied egress event exists)
  // AND the proxy config changed since that run. The FIRST-ever proxied run is a startup, not a rotation.
  const trail = c.auditTrail();
  let lastProxied = -1;
  let lastConfig = -1;
  trail.forEach((ev, i) => {
    const route = (ev.detail as Record<string, unknown> | undefined)?.["route"];
    if (ev.action.startsWith("egress.") && typeof route === "string" && route !== "direct") lastProxied = i;
    if (ev.action === "proxy.set" || ev.action === "proxy.clear") lastConfig = i;
  });
  return lastProxied >= 0 && lastConfig > lastProxied;
}

export function proxyRoutingFor(c: Case, deps: NetworkDeps, viaTor: boolean): { routing?: EgressRouting } | { error: string } {
  const config = caseProxyConfig(c);
  if (config === undefined) {
    return viaTor
      ? {
          error:
            "--via-tor requires a Tor proxy configured for this case (ir proxy set tor --host <socks-host> --port <port> --secret <vault-entry>)",
        }
      : {};
  }
  if (viaTor && config.route !== "tor") {
    return {
      error: `--via-tor requires the case's routing to be the tor route (currently ${config.route}); reconfigure with ir proxy set tor`,
    };
  }
  // The vault entry must be a credential_pair (username + password) — a single-secret shape is not a proxy credential.
  const openVault = deps.vault ?? (() => vaultFromEnv(process.env, process.env["IR_DATA_DIR"] ?? path.resolve("data")));
  let vault: Vault;
  try {
    vault = openVault();
  } catch (x) {
    return { error: `proxy: the vault could not be opened (${(x as Error).message})` };
  }
  const pair = vault.revealPair(config.secretName);
  if (pair === undefined || pair.id.length === 0 || pair.secret.length === 0) {
    return {
      error: `proxy: the vault entry "${config.secretName}" is missing or not a credential pair (username + password) — fail-closed`,
    };
  }
  return {
    routing: {
      route: config.route,
      proxy: {
        host: config.host,
        port: config.port,
        credentials: { username: pair.id, password: pair.secret },
      },
    },
  };
}

/** ADR-31 (P2-028, item هـ): the liveness check's fields — what triggered it and what it found. */
function livenessFields(e: EgressAuditEvent): Record<string, unknown> {
  return {
    ...(e.alive !== undefined ? { alive: e.alive } : {}),
    ...(e.trigger ? { trigger: e.trigger } : {}),
    ...(e.proxyHost ? { proxyHost: e.proxyHost } : {}),
    ...(e.proxyPort !== undefined ? { proxyPort: e.proxyPort } : {}),
    ...(e.latencyMs !== undefined ? { latencyMs: e.latencyMs } : {}),
  };
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
  /** P2-028 (ADR-31): the case's routing (a strict proxy or Tor) — undefined is direct. */
  routing?: EgressRouting,
): NetworkGateway | { error: string } {
  const events: EgressAuditEvent[] = [];
  const decision = createProductionEgress({
    allowedHosts: allowHosts,
    env: deps.env ?? process.env,
    ...(routing ? { routing } : {}),
    // P2-028 (ADR-31, item هـ): the proxy liveness — the rotation hint from the case's own chain.
    ...(routing ? { liveness: { rotated: proxyRotatedSinceLastRun(c) } } : {}),
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
          // P2-028 (ADR-31): the route is mandatory on EVERY network event — no exception.
          ...(e.route ? { route: e.route } : {}),
          transportCalls: e.transportCalls,
          ...(e.detail ? { detail: e.detail } : {}),
          // P2-014: transport events carry the call's URL, status/error and hop index (every actual
          // transport call — first hop, redirects, failures — is exactly one log row).
          ...(e.url ? { url: e.url } : {}),
          ...(e.status !== undefined ? { status: e.status } : {}),
          ...(e.error !== undefined ? { error: e.error } : {}),
          ...(e.attempt !== undefined ? { attempt: e.attempt } : {}),
          ...livenessFields(e),
        });
      },
    },
  });
  if (!decision.enabled) return { error: `--network: ${decision.reason}` };
  return { gateway: decision.gateway, allowedHosts: decision.allowedHosts, events };
}

/**
 * P2-026 (owner decision 2026-10-17 — item 3): the CENTRAL PurposeConfirmation wiring. The engine's
 * natural-person gate (naturalPersonGate) is the single enforcement point for natural-person-gated
 * runs in the CLI paths — `ir run --network` (planNetworkRun) AND `ir investigate` (networkRunFor):
 * the confirmation is built from the CASE itself (the stated purpose + the ledger's actor — the
 * confirmer), and every natural-person-gated run — subject-level (a person_name subject) or
 * transform-level (a natural_person_gate manifest) — routes through the engine's gate, fail-closed:
 * no purpose, no confirmer, no run. Not per-transform; there is deliberately no option or env var
 * that turns this off (mirroring the egress gateway's natural_person refusal, T-SEC-SSRF-040).
 * E-01 guarantees a purpose at case creation, so an empty purpose is the legacy pre-P1-028
 * database shape — refused fail-closed before any transport, on BOTH paths (the investigate path
 * previously did not enforce the subject-level requirement at all — the gap this wiring closes).
 */
export function purposeConfirmationFor(c: Case): PurposeConfirmation {
  // A case whose ledger exposes no actor (a legacy double shape) confirms nothing: the empty
  // confirmer is a fail-closed refusal in the engine's gate, never a pass-through.
  const confirmedBy = c.ledger?.actor ?? "";
  return { purpose: c.info().purpose, confirmedBy };
}

/** The engine's gate, run against the case's own confirmation — the shared refusal for both
 *  subject-level and transform-level natural-person runs. */
function naturalPersonGateRefusal(c: Case, what: string): string | undefined {
  const gate = naturalPersonGate({ sensitivity: "natural_person_gate" }, purposeConfirmationFor(c));
  if (gate.allowed) return undefined;
  return `--network: ${what} requires a purpose confirmation (E-02: the engine's natural-person gate — a stated purpose and a confirmer); this case has none`;
}

/** The transform-level E-02 mirror (P2-026/TR-051): a transform whose manifest declares
 *  natural_person_gate — the RESPONSE carries natural-person data (e.g. a domain's people's public
 *  emails) — runs only under a case whose purpose confirmation passes the engine's gate. */
function naturalPersonTransformGate(c: Case, entry: RegisteredTransform): string | undefined {
  if (entry.transform.manifest.sensitivity !== "natural_person_gate") return undefined;
  return naturalPersonGateRefusal(c, `${entry.transform.manifest.id} returns natural-person data (natural_person_gate)`);
}

/** The subject-level E-02 gate (P2-026 item 3): a natural-person SUBJECT's run routes through the
 *  same engine gate with the case's purpose confirmation — enforced centrally on BOTH CLI paths. */
function personSubjectPurposeGate(c: Case, spec: ReturnType<typeof specById>): string | undefined {
  if (spec?.sensitivity !== "natural_person_gate") return undefined;
  return naturalPersonGateRefusal(c, `subject type "${spec.id}" is a natural-person subject`);
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
  // P2-026 (item 3): the central subject-level gate on the investigate path too — the engine's
  // naturalPersonGate with the case's own purpose confirmation (the gap this wiring closes).
  const subjectPurposeRefusal = personSubjectPurposeGate(c, spec);
  if (subjectPurposeRefusal !== undefined) return { error: subjectPurposeRefusal };
  const kind = sendKindOf(spec.id, spec.category);
  // E-02 (P2-026/TR-051): the transform-level mirror of the natural-person-subject rule above.
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
  /** P2-028 (ADR-31): the case's routing (a strict proxy or Tor) — undefined is direct. */
  routing?: EgressRouting,
): NetworkPlan | { error: string } {
  // E-02 (P2-013): a natural-person subject runs only under a case whose stated purpose is the
  // confirmation (E-01 requires a >= 10-char purpose at case creation; an empty purpose means the
  // case predates that record and cannot gate a person run).
  // P2-026 (item 3): the central subject-level gate — the engine's naturalPersonGate with the
  // case's own purpose confirmation (previously an ad-hoc purpose check here, and NOT enforced at
  // all on the investigate path).
  const spec0 = specById(subjectType);
  const subjectPurposeRefusal = personSubjectPurposeGate(c, spec0);
  if (subjectPurposeRefusal !== undefined) return { error: subjectPurposeRefusal };
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
  const gw = openGateway(c, allowHosts, deps, secret.providers, routing);
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
