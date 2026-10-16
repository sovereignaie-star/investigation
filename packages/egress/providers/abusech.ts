/**
 * ADR-08 §7 / ADR-29 — the abuse.ch (ThreatFox) provider registry entry (DATA, not code).
 * ThreatFox's IOC search is POST-only (its official docs — verified 2026-10-16 — offer no GET
 * alternative), which is why TR-047's request goes through the ADR-29 narrow POST exception:
 * the pinned host threatfox-api.abuse.ch, the exact path /api/v1/, the fixed body schema
 * {query, search_term}. The key travels ONLY in the `Auth-Key` header, never the URL, never the
 * body (ADR-29 condition 2).
 */
import type { ProviderRegistryEntry } from "../src/providers.ts";

export const abusech: ProviderRegistryEntry = {
  name: "abusech",
  hosts: ["threatfox-api.abuse.ch"],
  secretHeader: "auth-key",
  manifestSecretNames: ["THREATFOX_AUTH_KEY"],
  vaultEntry: "threatfox",
  /** ADR-29: the one exact POST path — /api/v1/ (with the trailing slash, as documented). */
  requestPaths: ["/api/v1/"],
  // No queryAllowlist: the ThreatFox POST carries no query (ADR-29 — no query or fragment).
};
