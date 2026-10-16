/**
 * ADR-08 §7 — the urlscan provider registry entry (DATA, not code). urlscan is the first
 * header-compatible keyed provider: the key travels ONLY in the `api-key` header, never the URL.
 * Its request path /api/v1/search/ requires a query (?q=...) which the secret-request policy
 * (T-SEC-SSRF-042) currently refuses — see the documented P2-016 conflict in src/providers.ts.
 */
import type { ProviderRegistryEntry } from "../src/providers.ts";

export const urlscan: ProviderRegistryEntry = {
  name: "urlscan",
  hosts: ["urlscan.io"],
  secretHeader: "api-key",
  manifestSecretNames: ["URLSCAN_KEY"],
  vaultEntry: "urlscan",
  requestPaths: ["/api/v1/search/"],
};
