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
import type { PathParameterPolicy } from "../src/path-template.ts";

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

/* ---------------------------------------------------------------------------------------------- */
/* P2-026 (owner decision 2026-10-17 — the adopted path-parameter proposal, ADR-30 style): the
 * path_parameter rows. One row per provider (its endpoint templates): the provider + host + method
 * are bound together, every template is a FULL path, and every parameter is validated centrally by
 * the gateway against a CLOSED type vocabulary with a declared max length (packages/egress/src/
 * path-template.ts) — not by each transform. All endpoint facts below are verified from the
 * providers' official documentation (2026-10-17). */

/** P2-026: VirusTotal (TR-043) — GET report lookups with the subject in the path. */
export const virustotalPathPolicy: PathParameterPolicy = {
  provider: "virustotal",
  host: "www.virustotal.com",
  method: "GET",
  templates: [
    { template: "/api/v3/ip_addresses/{ip}", params: [{ name: "ip", type: "ip", maxLength: 45 }] },
    { template: "/api/v3/domains/{domain}", params: [{ name: "domain", type: "domain", maxLength: 253 }] },
    { template: "/api/v3/urls/{url_id}", params: [{ name: "url_id", type: "vtUrlId", maxLength: 2048 }] },
    {
      template: "/api/v3/files/{hash}",
      params: [{ name: "hash", type: "hash", lengths: [32, 40, 64], maxLength: 64 }],
    },
  ],
  fieldsSource:
    "https://docs.virustotal.com/reference/ip-objects (GET /api/v3/ip_addresses/{ip}), /reference/domain-objects (/api/v3/domains/{domain}), /reference/urls (/api/v3/urls/{url_id} — the identifier is unpadded URL-safe base64 of the URL or the 64-hex sha256 of its canonicalized form, verified 2026-10-17), /reference/files (/api/v3/files/{hash} — md5/sha1/sha256). Auth: the x-apikey header (never the URL). Public API: 500 requests/day, 4/minute (the roadmap's verified note).",
  terms:
    "VirusTotal terms (https://docs.virustotal.com/terms-and-conditions + the public API docs): the public API is prohibited in commercial products (LC-C/D per the roadmap decision); our use is the user's own key for research/incident response on a documented case. 45 is the longest IPv6 textual form (RFC 4291 §2.2); 253 is the longest DNS name (RFC 1123 §2.1) — OUR declared bounds where the source documents none.",
};

/** P2-026: GreyNoise (TR-045) — the community IP classification lookup, the subject in the path. */
export const greynoisePathPolicy: PathParameterPolicy = {
  provider: "greynoise",
  host: "api.greynoise.io",
  method: "GET",
  templates: [{ template: "/v3/community/{ip}", params: [{ name: "ip", type: "ipv4", maxLength: 15 }] }],
  fieldsSource:
    'https://docs.greynoise.io/reference/getcommunityip — GET /v3/community/{ip}: the ip path parameter is an IPv4 address (the source returns 400 "not a valid routable IPv4" otherwise — IPv4-only, verified 2026-10-17). Auth: the `key` header. Free tier: 50 lookups/week.',
  terms:
    "GreyNoise terms (https://docs.greynoise.io/docs/using-the-greynoise-community-api): the Community API is free for members; free-email accounts do not get API keys (a business email is required) — LC-C per the roadmap. 15 is the longest IPv4 textual form — OUR declared bound.",
};

/**
 * P2-026: AlienVault OTX (TR-046) — the indicator pulses lookup, the indicator in the path.
 * The URL indicator type is deliberately NOT declared: its segment is a percent-encoded full URL,
 * which no closed type in the vocabulary accepts (an architectural decision documented for the
 * owner — not forced through the template mechanism). TR-046 accepts ip/domain/hash indicators.
 */
export const otxPathPolicy: PathParameterPolicy = {
  provider: "otx",
  host: "otx.alienvault.com",
  method: "GET",
  templates: [
    { template: "/api/v1/indicators/IPv4/{indicator}/general", params: [{ name: "indicator", type: "ipv4", maxLength: 15 }] },
    { template: "/api/v1/indicators/IPv6/{indicator}/general", params: [{ name: "indicator", type: "ipv6", maxLength: 45 }] },
    {
      template: "/api/v1/indicators/domain/{indicator}/general",
      params: [{ name: "indicator", type: "domain", maxLength: 253 }],
    },
    {
      template: "/api/v1/indicators/hostname/{indicator}/general",
      params: [{ name: "indicator", type: "domain", maxLength: 253 }],
    },
    {
      template: "/api/v1/indicators/file/{indicator}/general",
      params: [{ name: "indicator", type: "hash", lengths: [32, 40, 64], maxLength: 64 }],
    },
  ],
  fieldsSource:
    "https://otx.alienvault.com/assets/static/external_api.html — GET /api/v1/indicators/{type}/{indicator}/{section}: the type segment is one of IPv4/IPv6/domain/hostname/url/file, the section is `general` (the pulse_info carrier), the indicator is the typed value. Auth: the X-OTX-API-KEY header (verified 2026-10-17). 10,000 requests/hour with a key.",
  terms:
    "OTX terms (https://otx.alienvault.com/api + the external API docs): the community API is free for research/incident response — LC-C per the roadmap. The `url` indicator type is excluded from this row (its segment is a percent-encoded full URL — no closed type accepts it; documented for the owner, not forced).",
};

/** P2-026: SecurityTrails (TR-048) — the DNS history lookup, hostname and record type in the path. */
export const securitytrailsPathPolicy: PathParameterPolicy = {
  provider: "securitytrails",
  host: "api.securitytrails.com",
  method: "GET",
  templates: [
    {
      template: "/v1/history/{hostname}/dns/{type}",
      params: [
        { name: "hostname", type: "domain", maxLength: 253 },
        { name: "type", type: "enum", values: ["a", "aaaa", "mx", "ns", "soa", "txt"], maxLength: 5 },
      ],
    },
  ],
  fieldsSource:
    'https://docs.securitytrails.com/reference/dns-history-by-record-type-old-1 — GET /v1/history/{hostname}/dns/{type}: "allowed values: a, aaaa, mx, ns, soa or txt" (lowercase, verified 2026-10-17). Auth: the `apikey` header. The API is read-only; 100 records per page.',
  terms:
    "SecurityTrails terms (https://docs.securitytrails.com/docs/overview): the API is read-only, usage-based plans — LC-D per the roadmap. 253 is the longest DNS name (RFC 1123 §2.1) — OUR declared bound where the source documents none.",
};

/** The P2-026 path_parameter table — the single source of truth for path-template providers. */
export const PATH_PARAMETER_POLICIES: readonly PathParameterPolicy[] = [
  virustotalPathPolicy,
  greynoisePathPolicy,
  otxPathPolicy,
  securitytrailsPathPolicy,
];

export type { PostBodySchema, PostPolicy, PathParameterPolicy };
