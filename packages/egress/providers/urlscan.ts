/**
 * ADR-08 §7 — the urlscan provider registry entry (DATA, not code). urlscan is the first
 * header-compatible keyed provider: the key travels ONLY in the `api-key` header, never the URL.
 * Its request path /api/v1/search/ requires a query (?q=...) — permitted by the per-provider query
 * allowlist below (P2-016 continuation, owner decision 2026-10-16; T-SEC-SSRF-042).
 */
import type { ProviderRegistryEntry } from "../src/providers.ts";

export const urlscan: ProviderRegistryEntry = {
  name: "urlscan",
  hosts: ["urlscan.io"],
  secretHeader: "api-key",
  manifestSecretNames: ["URLSCAN_KEY"],
  vaultEntry: "urlscan",
  requestPaths: ["/api/v1/search/"],
  /**
   * P2-016 continuation (owner decision 2026-10-16): the closed query allowlist. Source — the
   * provider's official API documentation (https://urlscan.io/docs/api/, Search API,
   * GET /api/v1/search/): "q — The query term (ElasticSearch Query String Query). Default: *".
   * The docs declare no maximum length for q; 512 is OUR declared bound (recorded in
   * docs/DECLARED_LIMITS.md and docs/security/KEY_TESTS.md). The same docs list `size` and
   * `search_after` — they are deliberately NOT permitted: TR-009 sends only `q`, and the closed
   * list is narrower than the provider's documented surface on purpose (fail-closed).
   */
  queryAllowlist: [{ param: "q", type: "string", maxLength: 512 }],
};
