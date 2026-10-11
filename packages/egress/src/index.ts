export { createEgressGateway, EGRESS_DENY_CODE } from "./egress";
export type {
  EgressRequest,
  EgressResult,
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
