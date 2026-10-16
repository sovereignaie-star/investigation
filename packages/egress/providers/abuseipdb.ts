/**
 * ADR-08 §7 — the AbuseIPDB provider registry entry (DATA, not code). The key travels ONLY in the
 * `Key` header, never the URL. The source's check endpoint (docs.abuseipdb.com, /api/v2/check)
 * requires the `ipAddress` query parameter — permitted by the closed query allowlist below.
 * The source's other documented parameters (`maxAgeInDays`, `verbose`) are deliberately NOT
 * permitted: TR-044 sends only `ipAddress`, and the closed list is narrower than the provider's
 * documented surface on purpose (fail-closed; the same pattern as urlscan's `q`-only allowlist).
 */
import type { ProviderRegistryEntry } from "../src/providers.ts";

export const abuseipdb: ProviderRegistryEntry = {
  name: "abuseipdb",
  hosts: ["api.abuseipdb.com"],
  secretHeader: "key",
  manifestSecretNames: ["ABUSEIPDB_KEY"],
  vaultEntry: "abuseipdb",
  requestPaths: ["/api/v2/check"],
  /**
   * The closed query allowlist. Source — the provider's official API documentation
   * (https://docs.abuseipdb.com/#check): "ipAddress — A single IPv4 or IPv6 address", required,
   * URL-encoded (IPv6 contains reserved colons). The docs declare no maximum length; 45 is OUR
   * declared bound (the longest textual IPv6 address is 45 characters — RFC 4291 §2.2).
   */
  queryAllowlist: [{ param: "ipAddress", type: "string", maxLength: 45 }],
};
