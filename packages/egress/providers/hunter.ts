/**
 * ADR-08 §7 — the Hunter provider registry entry (DATA, not code). The key travels ONLY in the
 * `X-API-KEY` header — the source's documented alternative to the api_key query parameter
 * (official API reference, verified 2026-10-17) — never the URL. The domain-search endpoint
 * requires the `domain` query parameter: permitted by the closed query allowlist below. The
 * source's other documented parameters (limit, offset, type, seniority, ...) are deliberately
 * NOT permitted: TR-051 sends only `domain`, and the closed list is narrower than the
 * provider's documented surface on purpose (fail-closed; the TR-044 ipAddress pattern).
 */
import type { ProviderRegistryEntry } from "../src/providers.ts";

export const hunter: ProviderRegistryEntry = {
  name: "hunter",
  hosts: ["api.hunter.io"],
  secretHeader: "x-api-key",
  manifestSecretNames: ["HUNTER_KEY"],
  vaultEntry: "hunter",
  requestPaths: ["/v2/domain-search"],
  /**
   * The closed query allowlist. Source — the provider's official API reference
   * (https://hunter.io/api-documentation/v2#domain-search): "domain — The domain name from
   * which you want to find the email addresses" (one of domain/company required). The docs
   * declare no maximum length; 253 is OUR declared bound (the maximum textual length of a
   * DNS hostname — RFC 1123 §2.1).
   */
  queryAllowlist: [{ param: "domain", type: "string", maxLength: 253 }],
};
