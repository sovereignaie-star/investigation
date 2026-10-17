/**
 * ADR-08 §7 (P2-026, owner decision 2026-10-17 — the restricted-storage provider): the Brave
 * Search API provider registry entry (TR-053). The key travels ONLY in the `X-Subscription-Token`
 * header — the source's documented auth (verified 2026-10-17 against
 * https://api-dashboard.search.brave.com/documentation/guides/authentication) — never the URL.
 *
 * THE RESTRICTED STORAGE (the ADR-30-style row's own commitment): Brave's Search API terms forbid
 * storing Search Results ("shall not ... store, cache, or create a database of Search Results, in
 * whole or in part" — https://api-dashboard.search.brave.com/documentation/resources/terms-of-service).
 * The TR-053 manifest therefore declares restrictedEvidence: the runner keeps the raw response OUT
 * of the case records (a sha256 digest envelope instead) — the query, the time, the links and the
 * hash are stored, nothing else. This row documents that the provider's terms are the reason.
 */
import type { ProviderRegistryEntry } from "../src/providers.ts";

export const brave: ProviderRegistryEntry = {
  name: "brave",
  hosts: ["api.search.brave.com"],
  secretHeader: "x-subscription-token",
  manifestSecretNames: ["BRAVE_SUBSCRIPTION_TOKEN"],
  vaultEntry: "brave",
  requestPaths: ["/res/v1/web/search"],
  /**
   * The closed query allowlist. Source — the provider's official API reference
   * (https://api-dashboard.search.brave.com/api-reference/web/search/get): the web search takes
   * the query text in `q`. The source's many other documented parameters (count, offset,
   * freshness, ...) are deliberately NOT permitted: TR-053 sends only `q`, and the closed list is
   * narrower than the provider's documented surface on purpose (fail-closed; the urlscan
   * pattern). 253 is the longest DNS name (RFC 1123 §2.1) — OUR declared bound where the source
   * documents none (a person-name query is at most 200).
   */
  queryAllowlist: [{ param: "q", type: "string", maxLength: 253 }],
};
