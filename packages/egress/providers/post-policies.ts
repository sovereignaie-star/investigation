/**
 * ADR-30 (owner decision 2026-10-17) — the unified POST policy table. DATA, not gateway logic:
 * every provider that may receive a POST is declared here as one complete record — the pinned
 * host and exact path, the request kind, the body format, the FIXED body schema (fields, types,
 * maxLengths, exact keys), the size cap, the field-by-field source in the provider's official
 * docs, and the provider's contractual terms. The gateway enforces this table centrally
 * (`checkRegisteredPost`): a POST to anything not in this table is refused fail-closed, and a
 * body that deviates from the declared schema is refused before DNS. Adding a provider = a new
 * row here + a small PR (no separate ADR); removing or widening a row IS an ADR-30 review.
 *
 * The key always travels in a header, never the URL, never the body (ADR-30 condition 2). The
 * one protocol-level exception is the OAuth2 `token` kind: the client credentials are the
 * OAuth2 protocol's own credential exchange (RFC 6749 §4.4 client-credentials), carried in the
 * token endpoint's form body by the protocol itself — recorded per-row, reviewed as part of
 * this table.
 */
import type { PostBodySchema, PostPolicy } from "../src/post-policy.ts";

/** ADR-27 migrated (2026-10-17): the OpenSky OAuth2 client-credentials token POST. */
export const openskyTokenPolicy: PostPolicy = {
  host: "auth.opensky-network.org",
  path: "/auth/realms/opensky-network/protocol/openid-connect/token",
  kind: "token",
  format: "form",
  schema: {
    type: "object",
    exactKeys: ["client_id", "client_secret", "grant_type"],
    fields: {
      client_id: { type: "string" },
      client_secret: { type: "string" },
      grant_type: { type: "literal", value: "client_credentials" },
    },
  },
  maxBodyBytes: 4096,
  fieldsSource:
    "https://opensky-network.org/my-opensky/api-credentials — the OAuth2 client-credentials token exchange (RFC 6749 §4.4); OpenSky rejected password grants from the source on 2026-03-18 (see ADR-27, migrated note).",
  terms:
    "OpenSky API terms (https://opensky-network.org/my-opensky/api-credentials): the anonymous/registered API tiers; the client credentials are the account's own, the token is short-lived (30 minutes) and is never serialized (ADR-27 condition 6, unchanged).",
};

/** ADR-28 migrated (2026-10-17): the OpenSanctions /match screening POST. */
export const opensanctionsMatchPolicy: PostPolicy = {
  host: "api.opensanctions.org",
  path: "/match/default",
  kind: "match",
  format: "json",
  schema: {
    type: "object",
    exactKeys: ["queries"],
    fields: {
      queries: {
        type: "object",
        exactKeys: ["q"],
        fields: {
          q: {
            type: "object",
            exactKeys: ["schema", "properties"],
            fields: {
              schema: { type: "string", enum: ["Person", "Company"] },
              properties: {
                type: "keysFrom",
                allowed: ["firstName", "lastName", "name"],
                min: 1,
                max: 3,
                value: { type: "array", length: 1, item: { type: "string", maxLength: 100 } },
              },
            },
          },
        },
      },
    },
  },
  maxBodyBytes: 4096,
  fieldsSource:
    "https://api.opensanctions.org/match/default — the official OpenAPI spec (ADR-28); the /match endpoint is POST-only in the source, /search is the GET discovery path.",
  terms:
    "OpenSanctions terms (https://opensanctions.org/terms/): the data is CC-BY-licensed for the public database; the subject's name travels ONLY in this body (the single allowed body surface — ADR-28, unchanged) and never in a URL, header, or record.",
};

/** ADR-29 migrated (2026-10-17): the ThreatFox IOC-search POST (TR-047, P2-026). */
export const threatfoxSearchPolicy: PostPolicy = {
  host: "threatfox-api.abuse.ch",
  path: "/api/v1/",
  kind: "search",
  format: "json",
  schema: {
    type: "object",
    exactKeys: ["query", "search_term"],
    fields: {
      query: { type: "string", enum: ["search_ioc", "search_hash"] },
      search_term: { type: "string", maxLength: 256 },
    },
  },
  maxBodyBytes: 4096,
  fieldsSource:
    "https://threatfox.abuse.ch/api/ — the official API docs (verified 2026-10-16): POST-only, the Auth-Key header, search_ioc (search_term) and search_hash (hash) operations; no GET alternative documented.",
  terms:
    "abuse.ch terms (https://abuse.ch.com/ + the API docs): the Auth-Key is mandatory since 2025-06-30; the community API is free for research/incident-response use — commercial use of the interface may require a subscription (ROADMAP TR-047, LC-C).",
};

/** The ADR-30 table — the single source of truth for every legal POST. */
export const POST_POLICIES: readonly PostPolicy[] = [openskyTokenPolicy, opensanctionsMatchPolicy, threatfoxSearchPolicy];

export type { PostBodySchema, PostPolicy };
