export { createEgressGateway, EGRESS_DENY_CODE, EgressTransportError, normalizeHost } from "./egress";
export type { EgressGateway } from "./egress";
export type {
  EgressRequest,
  ProviderQueryAllow,
  EgressResult,
  EgressSuccessResponse,
  EgressOptions,
  DnsResolver,
  EgressTransport,
  EgressAuditSink,
  EgressAuditEvent,
  EgressDenyCode,
  EgressReason,
  EgressLimits,
} from "./egress";
export { classifyAddress, classifyV4, classifyV6, isIpv4, isIpv6 } from "./address-policy";
export type { AddressClass, AddressVerdict } from "./address-policy";
export { createNodeTransport, decodeBody, EgressSizeLimitError, MAX_ENCODING_LAYERS } from "./node-transport";
export type { NodeTransportOptions } from "./node-transport";
export { createSystemResolver, DnsResolutionError } from "./system-resolver";
export type { LookupAll, SystemResolverOptions } from "./system-resolver";
export { createProductionEgress, validAllowedHost } from "./production";
export type { ProductionEgressConfig, ProductionEgressDecision } from "./production";
export { sendKindOf, isStaticPath } from "./content-inventory";
export { ByteBudget, RequestBudget, isByteBudget, isRequestBudget } from "./byte-budget";
export { parseRobots, robotsFromStatus, ROBOTS_PRODUCT_TOKEN } from "./robots";
export type { RobotsPolicy } from "./robots";
// P2-016 (ADR-08 §7): the provider registry — pure data, no network capability. Re-exported from
// the main index so trusted callers (the CLI network plan) can read it without a restricted
// subpath import; the subpath export stays for direct references.
export { PROVIDER_REGISTRY, registryEntryForSecret } from "./providers";
export type { ProviderRegistryEntry } from "./providers";
// P2-026 (owner decision 2026-10-17): the central path-template enforcement — the closed type
// vocabulary, the standalone matcher, and the policy-table types. Re-exported so trusted callers
// (the CLI network plan) can carry them to the gateway without a restricted subpath import.
export { matchPathTemplate, validatePathParam } from "./path-template";
export type { PathParamType, PathParamSpec, PathParameterTemplate, PathParameterPolicy, PathMatchResult } from "./path-template";
