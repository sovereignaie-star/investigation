/**
 * Private vault-key-validation capability (P2-003).
 *
 * This module is intentionally NOT exported from `src/index.ts`. The delegation
 * requires that no engine or public adapter can enable the vault path by
 * merely setting `systemContext: true` (or any other boolean field on the
 * request). The capability is a module-private symbol that only this file can
 * construct; the gateway only honors the `systemContext` caseId exemption
 * when the request carries a capability value obtained from
 * `createVaultKeyValidationCapability()` — which is only reachable via this
 * deep-import path, and `providers.ts` is the only in-repo caller.
 *
 * The capability is bound to an immutable `allowedHosts` list (the provider
 * registry) and an audit sink. The gateway consults the capability for both:
 *   - which hosts are reachable on this request (must intersect the caller's
 *     own `allowedHosts` option — the union is NOT used),
 *   - and which audit sink must receive the event for this request.
 */
import {
  normalizeHost,
  type EgressAuditSink,
  type EgressLimits,
  type EgressOptions,
  type EgressTransport,
  type DnsResolver,
} from "./egress.ts";

/**
 * Module-local symbol (NOT `Symbol.for`, which is a global registry anyone can query). The gateway does not trust
 * the shape anyway: it compares the request's capability with the gateway's own by identity.
 */
const CAPABILITY_SYMBOL = Symbol("ir.egress.vaultKeyValidation");

/**
 * A narrow vault capability object. Constructing one requires the module-private
 * symbol; an engine or adapter importing `@ir/egress` has no way to reach it.
 */
export interface VaultKeyValidationCapability {
  readonly kind: "vault-key-validation";
  readonly allowedHosts: readonly string[];
  /** Provider name -> exact hosts. A secret is only sent to a host of its own provider (T-SEC-SSRF-041). */
  readonly providerHosts: Readonly<Record<string, readonly string[]>>;
  readonly auditSink: EgressAuditSink;
  /** Opaque so external code cannot fabricate one. */
  readonly [CAPABILITY_SYMBOL]: true;
}

/** Build the private vault capability (only this module can). */
export function createVaultKeyValidationCapability(
  providerHosts: Readonly<Record<string, string | readonly string[]>>,
  auditSink: EgressAuditSink,
): VaultKeyValidationCapability {
  const registry: Record<string, readonly string[]> = {};
  for (const [name, hosts] of Object.entries(providerHosts ?? {})) {
    const list = (typeof hosts === "string" ? [hosts] : [...hosts]).map(normalizeHost).filter((h) => h !== "");
    if (list.length > 0) registry[name] = Object.freeze([...new Set(list)]);
  }
  const allowedHosts = [...new Set(Object.values(registry).flat())];
  if (allowedHosts.length === 0) {
    throw new RangeError("vault capability requires a non-empty provider registry");
  }
  return Object.freeze({
    kind: "vault-key-validation",
    allowedHosts: Object.freeze(allowedHosts),
    providerHosts: Object.freeze(registry),
    auditSink,
    [CAPABILITY_SYMBOL]: true,
  }) as VaultKeyValidationCapability;
}

/** Gateway options for a shared vault gateway instance (rate limits are shared). */
export function vaultGatewayOptions(
  capability: VaultKeyValidationCapability,
  resolver: DnsResolver,
  transport: EgressTransport,
  limits?: EgressLimits,
): EgressOptions & { capability: VaultKeyValidationCapability } {
  return {
    resolver,
    transport,
    allowedHosts: capability.allowedHosts,
    providerHosts: capability.providerHosts,
    auditSink: capability.auditSink,
    limits,
    capability,
  } as EgressOptions & { capability: VaultKeyValidationCapability };
}
