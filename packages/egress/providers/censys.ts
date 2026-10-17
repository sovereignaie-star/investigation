/**
 * ADR-08 §7 (P2-026, owner decision 2026-10-17): the Censys provider registry entry (TR-049).
 * THE CREDENTIAL IS A PAIR — an API ID + secret — per the source's documented HTTP Basic
 * authentication (verified 2026-10-17 against the official docs, docs.censys.com / the Legacy
 * Search API reference: "Every API call requires authentication with HTTP basic auth using the
 * API ID and secret"). The pair is stored as ONE vault entry of the P2-026 credential_pair
 * kind (vault entry "censys"); the CLI builds `Authorization: Basic base64(id:secret)` from it
 * and the gateway injects that header value — the credential NEVER travels in the URL, not as
 * a query parameter and not as a path segment (D-031/P2-016).
 *
 * The subject-carrying host-view endpoint (/v2/hosts/{ip}) is a PATH template declared in the
 * policy table (post-policies.ts — the single source of truth); the certificates-search
 * endpoint is a literal requestPath with the subject in the ONLY allowlisted query parameter
 * (`q` — the closed list is narrower than the provider's documented surface on purpose,
 * fail-closed).
 */
import { censysPathPolicy } from "./post-policies.ts";
import type { ProviderRegistryEntry } from "../src/providers.ts";

export const censys: ProviderRegistryEntry = {
  name: "censys",
  hosts: ["search.censys.io"],
  /** The pair-credential header the gateway injects the built Basic value into (lowercase). */
  secretHeader: "authorization",
  /** P2-026: this provider's vault entry is a credential PAIR (API ID + secret), not a single key. */
  credentialKind: "credential_pair",
  manifestSecretNames: ["CENSYS_API_ID"],
  vaultEntry: "censys",
  requestPaths: ["/v2/certificates/search"],
  requestPathTemplates: censysPathPolicy.templates,
  /**
   * The closed query allowlist. Source — the provider's official API documentation
   * (docs.censys.com, the Legacy Search API reference): the certificates search takes the
   * query text in `q`. 253 is the longest DNS name (RFC 1123 §2.1) — OUR declared bound where
   * the source documents none.
   */
  queryAllowlist: [{ param: "q", type: "string", maxLength: 253 }],
};
