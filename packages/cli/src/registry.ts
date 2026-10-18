/**
 * P2-037 — the transforms `ir run` may execute, and exactly how each one is fed and isolated.
 *
 * A transform not in this table does not run (simulation or network). For each registered transform the table
 * states, explicitly rather than by convention:
 *
 * - `module`: its sandbox module path (bundled from source; network runs execute it ONLY there — the parent process
 *   never imports and runs it with `--network`);
 * - `subjects`: the catalog subject types it accepts and how each becomes its input object. The input field name is
 *   written here per transform (TR-003 takes `ip` for an ASN too), never guessed from `manifest.inputs[0]`, and the
 *   value passed is the catalog-normalized subject value (the same form as the subject's canonicalKey);
 * - `sends`: every content kind its requests carry (the gateway's content inventory refuses any undeclared kind):
 *   the subject's own kind plus what the request URL inevitably contains (TR-006 sends the reversed address as a
 *   DNS name under origin.asn.cymru.com — a `domain` — and TR-011 sends the URL and its host);
 * - `hosts`: the hosts its requests go to, for documentation and for a clear refusal message. They are NEVER added
 *   to the operator's `--allow-host` list: a host the operator did not name is refused by the gateway before any
 *   connection, including an RDAP server discovered in an IANA bootstrap file.
 * - `pageFetch`: the transform fetches pages and obeys robots.txt (ADR-08 decision C).
 */
import { fileURLToPath } from "node:url";
import { canonicalKey } from "@ir/core";
import { specById } from "@ir/core/identifiers";
import {
  certTransparency,
  dnsResolve,
  httpScan,
  ipToAsn,
  isAsn,
  isIpv4,
  isIpv6,
  normalizeDomain,
  rdapDomain,
  rdapIp,
  waybackCdx,
  ofacSdn,
  unScConsolidated,
  urlscanSearch,
  threatfoxSearch,
  abuseIpDbCheck,
  hunterDomainEmails,
  virustotalReputation,
  greyNoiseClassification,
  otxPulses,
  securityTrailsDnsHistory,
  commonCrawlIndex,
  braveWebSearch,
  censysHostsCertificates,
  euSanctions,
  companiesHouse,
  opensanctions,
  opensky,
  gleifEntity,
  secEdgar,
  nominatimGeocode,
  type Transform,
} from "@ir/transforms";

export interface RegisteredTransform {
  readonly transform: Transform;
  readonly module: string;
  /** subject catalog type -> the transform's input object, from the normalized subject value. */
  readonly subjects: Readonly<Record<string, (value: string) => Record<string, unknown>>>;
  readonly sends: readonly string[];
  /**
   * P2-039: fixed `host/path` request paths of this transform's own code (bootstrap files). They carry no case data,
   * so the gateway does not read their file names as identifiers; the rest of each request is inspected as always.
   * Exact host and whole path only (see `isStaticPath` in @ir/egress). Never derived from a source's answer.
   */
  readonly staticPaths?: readonly string[];
  /**
   * P2-029: for a keyed transform, the provider-documented page where its key is obtained (a link for
   * the operator — never a key itself; the key still travels only through the approved secret mechanism).
   */
  readonly keyUrl?: string;
  readonly hosts: readonly string[];
  /** Hosts a run may be sent to that are only known from a source's answer (RDAP bootstrap); never auto-allowed. */
  readonly discoveredHosts?: string;
  readonly pageFetch: boolean;
}

/**
 * Input builders. Each one applies the same check the transform applies before its first request, and throws on an
 * invalid value, so `ir run` refuses it (exit 2) before a case is opened, a sandbox is started or a host resolved.
 */
const domainInput = (raw: string) => {
  const domain = normalizeDomain(raw);
  if (!domain.includes(".")) throw new Error(`"${raw}" is not a registrable domain name`);
  return { domain };
};
/**
 * P2-039: a host name for TR-001. The catalog's `hostname` pattern accepts a single label (and its normaliser only
 * lower-cases and converts IDN to A-labels), so the builder adds the DNS checks the transform needs: LDH labels of
 * 1..63 characters, 253 at most, at least two labels (a bare label is not a public name), and a non-numeric last
 * label (so an IP address written as a host name is refused). A wildcard (`*.example.com`, frequent in CT logs) or an
 * underscore label is not a host name.
 */
const hostnameInput = (raw: string) => {
  let h: string;
  try {
    h = normalizeDomain(raw);
  } catch {
    throw new Error(`"${raw}" is not a valid host name (letters, digits and hyphens in dot-separated labels)`);
  }
  const labels = h.split(".");
  if (labels.length < 2) throw new Error(`"${raw}" is not a fully qualified host name (a single label)`);
  if (/^\d+$/.test(labels[labels.length - 1] ?? "")) throw new Error(`"${raw}" is not a host name (numeric last label)`);
  return { domain: h };
};
const ipv4Input = (ip: string) => {
  if (!isIpv4(ip)) throw new Error(`"${ip}" is not an IPv4 address`);
  return { ip };
};
const ipv6Input = (ip: string) => {
  if (!isIpv6(ip)) throw new Error(`"${ip}" is not an IPv6 address`);
  return { ip };
};
const asnInput = (asn: string) => {
  if (!isAsn(asn)) throw new Error(`"${asn}" is not an AS number`);
  return { ip: asn };
};
/** P2-026 (TR-043/TR-046): a file hash accepting md5, sha1 AND sha256 (the 32/40/64 hex forms the
 * VirusTotal/OTX path templates declare) — validated by pattern, then passed through. */
const tripleHashInput = (raw: string) => {
  const value = raw.trim().toLowerCase();
  if (!/^[a-f0-9]{32}$|^[a-f0-9]{40}$|^[a-f0-9]{64}$/.test(value)) throw new Error(`"${raw}" is not an md5, sha1 or sha256 hash`);
  return { hash: value };
};
/** P2-026: a file hash (MD5/SHA256) for TR-047 — validated by pattern, then passed through. */
const hashInput = (raw: string) => {
  const value = raw.trim().toLowerCase();
  if (!/^[a-f0-9]{32}$|^[a-f0-9]{64}$/.test(value)) throw new Error(`"${raw}" is not an MD5 or SHA256 hash`);
  return { hash: value };
};
const httpUrlInput = (url: string) => {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`"${url}" is not a URL`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error(`only http(s) URLs are accepted ("${url}")`);
  return { url };
};

const leiInput = (lei: string) => {
  if (!/^[A-Z0-9]{18}\d{2}$/.test(lei)) throw new Error(`"${lei}" is not an LEI`);
  return { lei };
};
const cikInput = (cik: string) => {
  if (!/^\d{1,10}$/.test(cik)) throw new Error(`"${cik}" is not a CIK`);
  return { cik };
};
const personNameInput = (name: string) => {
  if (name.length < 3 || name.length > 200) throw new Error(`"${name.slice(0, 40)}" is not a person name`);
  return { name };
};
/** TR-023: a UK Companies House number (the catalog type's own pattern, upper-cased). */
const ukCompanyInput = (raw: string) => {
  const number = raw.trim().toUpperCase();
  if (!/^(?:\d{8}|[A-Za-z]{2}\d{6})$/.test(number)) throw new Error(`"${raw}" is not a UK company number`);
  return { company_number: number };
};
/** TR-023: a company name (multi-word, the catalog type's own shape — a single word is never one). */
const companyNameInput = (raw: string) => {
  const name = raw.trim();
  if (name.length < 3 || name.length > 200 || !/^\S+(?:\s\S+)+$/.test(name)) {
    throw new Error(`"${raw.slice(0, 40)}" is not a company name`);
  }
  return { name };
};
/** TR-040: an ICAO24 transponder address (6 hex digits, lower-cased). */
const icao24Input = (raw: string) => {
  const icao24 = raw.trim().toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(icao24)) throw new Error(`"${raw}" is not an ICAO24 address`);
  return { icao24 };
};
/** TR-040: a flight callsign (upper-case alphanumeric, 2-8 chars). */
const callsignInput = (raw: string) => {
  const callsign = raw.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,8}$/.test(callsign)) throw new Error(`"${raw}" is not a flight callsign`);
  return { callsign };
};
const addressInput = (address: string) => {
  if (address.length < 5 || address.length > 300) throw new Error(`"${address.slice(0, 40)}" is not an address`);
  return { address };
};
const pointInput = (point: string) => {
  if (!/^-?\d{1,2}(?:\.\d{1,8})?,\s*-?\d{1,3}(?:\.\d{1,8})?$/.test(point)) throw new Error(`"${point}" is not a point`);
  return { point: point.replace(/\s+/g, "") };
};

const mod = (file: string) => fileURLToPath(new URL(`../../transforms/src/transforms/${file}`, import.meta.url));

export const REGISTRY: readonly RegisteredTransform[] = [
  {
    transform: dnsResolve,
    module: mod("tr-001-dns.ts"),
    // P2-039: a host name (a nameserver from TR-001/TR-002, a certificate name from TR-004) is resolved like a domain.
    subjects: { domain: domainInput, hostname: hostnameInput },
    sends: ["domain"],
    hosts: ["dns.google"],
    pageFetch: false,
  },
  {
    transform: rdapDomain,
    module: mod("tr-002-rdap-domain.ts"),
    subjects: { domain: domainInput },
    sends: ["domain"],
    staticPaths: ["data.iana.org/rdap/dns.json"],
    hosts: ["data.iana.org"],
    discoveredHosts: "the RDAP server of the domain's TLD named in https://data.iana.org/rdap/dns.json (e.g. rdap.verisign.com for .com)",
    pageFetch: false,
  },
  {
    transform: rdapIp,
    module: mod("tr-003-rdap-ip.ts"),
    subjects: { ipv4: ipv4Input, ipv6: ipv6Input, asn: asnInput },
    // The RDAP path carries the address or the AS number. The bootstrap requests carry no subject; their file names
    // (ipv4.json, ipv6.json, asn.json) read as DNS names to the content inventory, so they are declared as fixed paths
    // (P2-039) instead of declaring "domain" (which would let any DNS name through on every TR-003 request).
    sends: ["ip", "asn"],
    staticPaths: ["data.iana.org/rdap/ipv4.json", "data.iana.org/rdap/ipv6.json", "data.iana.org/rdap/asn.json"],
    hosts: ["data.iana.org"],
    discoveredHosts: "the RIR RDAP server named in https://data.iana.org/rdap/{ipv4,ipv6,asn}.json (e.g. rdap.arin.net)",
    pageFetch: false,
  },
  {
    transform: certTransparency,
    module: mod("tr-004-cert-transparency.ts"),
    subjects: { domain: domainInput },
    sends: ["domain"],
    hosts: ["crt.sh"],
    pageFetch: false,
  },
  {
    transform: ipToAsn,
    module: mod("tr-006-ip-to-asn.ts"),
    subjects: { ipv4: ipv4Input },
    sends: ["ip", "domain"],
    hosts: ["dns.google"],
    pageFetch: false,
  },
  {
    transform: httpScan,
    module: mod("tr-010-http-scan.ts"),
    subjects: { url: httpUrlInput },
    sends: ["url"],
    hosts: [],
    pageFetch: true,
  },
  {
    transform: waybackCdx,
    module: mod("tr-011-wayback-cdx.ts"),
    subjects: { url: httpUrlInput },
    sends: ["url", "domain"],
    hosts: ["web.archive.org"],
    pageFetch: false,
  },
  {
    // P2-016 continuation (owner decision 2026-10-16): TR-009 is registered now that the
    // per-provider query allowlist permits its search query (?q=domain:...) — the key travels in
    // the registry's api-key header only (D-031), read from the vault per request; the run is
    // refused fail-closed when the vault entry "urlscan" is not set.
    transform: urlscanSearch,
    keyUrl: "https://urlscan.io/user/profile/",
    module: mod("tr-009-urlscan.ts"),
    subjects: { url: httpUrlInput },
    // the search request URL carries the subject's URL host as the searched domain (q=domain:...)
    sends: ["url", "domain"],
    hosts: ["urlscan.io"],
    pageFetch: false,
  },
  {
    // P2-026 (ADR-29, owner decision 2026-10-17): TR-047 — the ThreatFox IOC search. The POST is
    // the ADR-29 narrow exception: the pinned host threatfox-api.abuse.ch, the exact path
    // /api/v1/, the fixed body {query: search_ioc, search_term: the IOC}. The key travels in the
    // Auth-Key header only (injected by the egress adapter from the vault entry "threatfox"),
    // never the URL, never the body; the body and the response never enter evidence or audit.
    transform: threatfoxSearch,
    keyUrl: "https://auth.abuse.ch/",
    module: mod("tr-047-threatfox.ts"),
    subjects: { ip: hashInput, domain: domainInput, url: httpUrlInput, hash: hashInput },
    sends: ["ip", "domain", "url", "hash"],
    hosts: ["threatfox-api.abuse.ch"],
    pageFetch: false,
  },
  {
    // P2-026: TR-044 — the AbuseIPDB check. The key (vault entry "abuseipdb") travels in the
    // registry's `Key` header only (D-031), read from the vault per request; the request sends
    // ONLY the ipAddress query (the per-provider allowlist refuses maxAgeInDays/verbose — the
    // closed list is narrower than the provider's documented surface on purpose, fail-closed). The
    // run is refused fail-closed when the vault entry is not set.
    transform: abuseIpDbCheck,
    keyUrl: "https://www.abuseipdb.com/account/api",
    module: mod("tr-044-abuseipdb.ts"),
    subjects: { ipv4: ipv4Input, ipv6: ipv6Input },
    // The request URL's query carries the subject IP itself.
    sends: ["ip"],
    hosts: ["api.abuseipdb.com"],
    pageFetch: false,
  },
  {
    // P2-026 (owner decision 2026-10-17 — the path_parameter batch): TR-043 — VirusTotal
    // reputation. The key (vault entry "virustotal") travels in the x-apikey header only (D-031),
    // read from the vault per request. THE SUBJECT TRAVELS IN THE REQUEST PATH — the closed
    // template rows (the provider registry entry + the policy table, post-policies.ts) are
    // enforced centrally by the gateway against a closed type vocabulary (path-template.ts): the
    // transform cannot smuggle an untyped path. URL identifiers are sent as the documented
    // unpadded base64url form.
    transform: virustotalReputation,
    keyUrl: "https://www.virustotal.com/gui/my-apikey",
    module: mod("tr-043-virustotal.ts"),
    subjects: { ipv4: ipv4Input, ipv6: ipv6Input, domain: domainInput, url: httpUrlInput, hash: tripleHashInput },
    // The request PATH carries the subject itself (ip / domain / url id / hash).
    sends: ["ip", "domain", "url", "hash"],
    hosts: ["www.virustotal.com"],
    pageFetch: false,
  },
  {
    // P2-026 (owner decision 2026-10-17 — the path_parameter batch): TR-045 — GreyNoise community
    // classification. The key (vault entry "greynoise") travels in the `key` header only (D-031).
    // The subject IPv4 travels in the REQUEST PATH — the closed template row (IPv4-only, declared
    // max length) is enforced centrally by the gateway.
    transform: greyNoiseClassification,
    keyUrl: "https://viz.greynoise.io/account/api-key",
    module: mod("tr-045-greynoise.ts"),
    subjects: { ipv4: ipv4Input },
    // The request PATH carries the subject IP itself.
    sends: ["ip"],
    hosts: ["api.greynoise.io"],
    pageFetch: false,
  },
  {
    // P2-026 (owner decision 2026-10-17 — the path_parameter batch): TR-046 — AlienVault OTX pulses.
    // The key (vault entry "otx") travels in the X-OTX-API-KEY header only (D-031). The indicator
    // travels in the REQUEST PATH — the closed template rows (IPv4/IPv6/domain/hostname/file) are
    // enforced centrally by the gateway; the url indicator type is deliberately not accepted
    // (a percent-encoded full URL fits no closed type — documented for the owner).
    transform: otxPulses,
    keyUrl: "https://otx.alienvault.com/settings",
    module: mod("tr-046-otx-pulses.ts"),
    subjects: { ipv4: ipv4Input, ipv6: ipv6Input, domain: domainInput, hostname: hostnameInput, hash: tripleHashInput },
    // The request PATH carries the indicator itself.
    sends: ["ip", "domain", "hash"],
    hosts: ["otx.alienvault.com"],
    pageFetch: false,
  },
  {
    // P2-026 (owner decision 2026-10-17 — the path_parameter batch): TR-048 — SecurityTrails DNS
    // history. The key (vault entry "securitytrails") travels in the apikey header only (D-031).
    // The host name AND the record type both travel in the REQUEST PATH — the closed template row
    // (domain type + the a/aaaa/mx/ns/soa/txt enum) is enforced centrally by the gateway.
    transform: securityTrailsDnsHistory,
    keyUrl: "https://securitytrails.com/app/account/credentials",
    module: mod("tr-048-securitytrails-dns-history.ts"),
    subjects: { domain: domainInput, hostname: hostnameInput },
    // The request PATH carries the subject host name (and the literal record type).
    sends: ["domain"],
    hosts: ["api.securitytrails.com"],
    pageFetch: false,
  },
  {
    // P2-026 (owner decision 2026-10-17 — the vault credential_pair extension): TR-049 — Censys
    // exposed assets and certificates. THE CREDENTIAL IS A PAIR (API ID + secret, HTTP Basic per
    // the source's documented auth): it is stored as ONE vault entry of the credential_pair kind
    // ("censys") and the CLI builds `Authorization: Basic base64(id:secret)` from it — the
    // gateway injects that header value; neither part ever travels in the URL (D-031). The IP
    // subject travels in the REQUEST PATH (the closed template row /v2/hosts/{ip}); the domain
    // subject travels in the ONLY allowlisted query parameter (`q`) of the certificates search.
    transform: censysHostsCertificates,
    keyUrl: "https://search.censys.io/account",
    module: mod("tr-049-censys.ts"),
    subjects: { ipv4: ipv4Input, ipv6: ipv6Input, domain: domainInput },
    // The request PATH carries the subject IP; the request QUERY carries the subject domain.
    sends: ["ip", "domain"],
    hosts: ["search.censys.io"],
    pageFetch: false,
  },
  {
    // P2-026: TR-051 — Hunter public domain emails. The key (vault entry "hunter") travels in the
    // X-API-KEY header only (D-031 — the source's documented alternative to the api_key query
    // parameter), read from the vault per request; the request sends ONLY the domain query (the
    // per-provider allowlist refuses the source's limit/offset/type parameters — fail-closed).
    // The subject is a domain (catalog sensitivity normal); the manifest's sensitivity is
    // natural_person_gate because the RESPONSE carries public emails (E-02).
    transform: hunterDomainEmails,
    keyUrl: "https://hunter.io/api-keys",
    module: mod("tr-051-hunter-emails.ts"),
    subjects: { domain: domainInput },
    // The request URL's query carries the subject domain itself.
    sends: ["domain"],
    hosts: ["api.hunter.io"],
    pageFetch: false,
  },
  {
    // P2-026: TR-052 — the Common Crawl index presence. KEYLESS (LC-B, public): no secret binding, no
    // provider registry entry (the registry exists for header-injected secrets — the TR-011 pattern).
    // Two documented requests on index.commoncrawl.org: the fixed /collinfo.json collection list
    // (newest first — the collection id is never hardcoded), then the newest collection's CDX API
    // with the domain as the url query (matchType=domain, filter=status:200, limit=100 — bounded).
    transform: commonCrawlIndex,
    module: mod("tr-052-common-crawl.ts"),
    subjects: { domain: domainInput },
    // The CDX query's url parameter carries the subject domain; the remaining documented parameters
    // (matchType, output, filter, limit) are literals.
    sends: ["domain"],
    hosts: ["index.commoncrawl.org"],
    pageFetch: false,
  },
  {
    // P2-026 (owner decision 2026-10-17 — the restricted-storage provider): TR-053 — Brave web
    // search. The key (vault entry "brave") travels in the `X-Subscription-Token` header only
    // (D-031). Brave's terms FORBID storing Search Results: the manifest declares
    // restrictedEvidence — the runner keeps the raw response out of the case records (a sha256
    // digest envelope instead); the query, the time, the links (the findings) and the hash are
    // stored, nothing else. The natural-person gate applies (web results about people).
    transform: braveWebSearch,
    keyUrl: "https://api-dashboard.search.brave.com/",
    module: mod("tr-053-brave-web-search.ts"),
    subjects: { person_name: personNameInput, domain: domainInput },
    // The request QUERY carries the subject itself (the name or the domain).
    sends: ["person_name", "domain"],
    hosts: ["api.search.brave.com"],
    pageFetch: false,
  },
  {
    transform: ofacSdn,
    module: mod("tr-026-ofac-sdn.ts"),
    // E-02: a person name is a natural-person subject; the engine's gate requires a purpose confirmation.
    subjects: { person_name: personNameInput },
    sends: ["person_name"],
    hosts: ["www.treasury.gov"],
    pageFetch: false,
  },
  {
    transform: unScConsolidated,
    module: mod("tr-027-un-sc.ts"),
    // E-02: a person name is a natural-person subject; the engine's gate requires a purpose confirmation.
    subjects: { person_name: personNameInput },
    sends: ["person_name"],
    hosts: ["main.un.org"],
    pageFetch: false,
  },
  {
    transform: euSanctions,
    module: mod("tr-028-eu-sanctions.ts"),
    // E-02: a person name is a natural-person subject; the engine's gate requires a purpose confirmation.
    subjects: { person_name: personNameInput },
    sends: ["person_name"],
    hosts: ["webgate.ec.europa.eu"],
    pageFetch: false,
  },
  {
    transform: companiesHouse,
    module: mod("tr-023-companies-house.ts"),
    // E-02: officers and PSCs are natural persons; the engine's gate requires a purpose confirmation.
    // The free developer key travels as an Authorization header from the manifest-declared env
    // name (IR_COMPANIES_HOUSE_TOKEN), never in a URL; without it the run fails closed.
    subjects: { uk_company_number: ukCompanyInput, company_name: companyNameInput },
    sends: ["uk_company_number", "company_name"],
    hosts: ["api.company-information.service.gov.uk"],
    pageFetch: false,
  },
  {
    transform: opensanctions,
    module: mod("tr-025-opensanctions.ts"),
    // ADR-28: the screening POST goes to the pinned api.opensanctions.org/match/{dataset} with a
    // fixed-schema JSON body carrying the subject's name only (case data — never recorded in
    // evidence/audit/disk; the response body is not recorded either). /search (GET) is the
    // discovery path for entity names; person screening is match-only (the name would travel
    // in a recorded URL otherwise). The API key travels as an Authorization: ApiKey header from
    // the manifest-declared env name (IR_OPENSANCTIONS_TOKEN), never in a URL; without it the
    // run fails closed. sends: the person run is gated by E-02 (person_name), like TR-026/027/028.
    // NOTE (P2-013): company_name subjects are refused by the CLI --network gate (the public
    // send kinds do not include company_name — the same state as TR-023's company subjects);
    // the engine path covers both subject kinds.
    subjects: {
      person_name: (raw: string) => ({ person_name: raw }),
      company_name: (raw: string) => ({ company_name: raw }),
    },
    sends: ["person_name"],
    hosts: ["api.opensanctions.org"],
    pageFetch: false,
  },
  {
    transform: opensky,
    module: mod("tr-040-opensky.ts"),
    // ADR-27: OAuth2 client-credentials only — the token POST goes to the pinned auth host
    // (auth.opensky-network.org) with a fixed form body built from the manifest-declared env
    // secrets (IR_OPENSKY_CLIENT_ID/IR_OPENSKY_CLIENT_SECRET); without either the run fails
    // closed. The Bearer token lives in memory only — never in evidence, audit or disk.
    // sends: the flights query carries the subject icao24; the states path carries no case data.
    subjects: { icao24: icao24Input, flight_callsign: callsignInput },
    sends: ["icao24"],
    hosts: ["auth.opensky-network.org", "opensky-network.org"],
    pageFetch: false,
  },
  {
    transform: gleifEntity,
    module: mod("tr-021-gleif.ts"),
    subjects: { lei_code: leiInput },
    sends: ["lei_code"],
    hosts: ["api.gleif.org"],
    pageFetch: false,
  },
  {
    transform: secEdgar,
    module: mod("tr-024-sec-edgar.ts"),
    subjects: { cik_us: cikInput },
    sends: ["cik_us"],
    hosts: ["www.sec.gov", "data.sec.gov"],
    pageFetch: false,
  },
  {
    transform: nominatimGeocode,
    module: mod("tr-030-nominatim.ts"),
    subjects: { street_address: addressInput, geo_point: pointInput },
    sends: ["street_address", "geo_point"],
    hosts: ["nominatim.openstreetmap.org"],
    pageFetch: false,
  },
];

export function registered(id: string): RegisteredTransform | undefined {
  return REGISTRY.find((r) => r.transform.manifest.id === id);
}

/**
 * The transform input for a subject, validated before anything is opened or sent: the subject type must be one the
 * transform accepts, and the value must normalize (canonicalKey). The input carries the normalized value.
 */
export function subjectInput(
  entry: RegisteredTransform,
  subjectType: string,
  subjectValue: string,
): { input: Record<string, unknown>; key: string } | { error: string } {
  const build = entry.subjects[subjectType];
  if (!build) {
    return {
      error: `${entry.transform.manifest.id} does not accept subject type "${subjectType}" (accepts: ${Object.keys(entry.subjects).join(", ")})`,
    };
  }
  const spec = specById(subjectType);
  if (!spec) return { error: `subject type "${subjectType}" is not a catalog identifier type` };
  let key: string;
  try {
    key = canonicalKey(subjectType, subjectValue);
  } catch (x) {
    return { error: `subject ${subjectType}:${subjectValue} is not valid: ${x instanceof Error ? x.message : String(x)}` };
  }
  // The normalizer is the catalog gate for a subject (D-018); the catalog patterns are not used here because some
  // reject valid values (the url pattern caps the TLD at 6 characters). Each transform validates its input again
  // before its first request.
  const normalized = key.slice(subjectType.length + 1);
  try {
    return { input: build(normalized), key };
  } catch (x) {
    return {
      error: `${entry.transform.manifest.id}: subject ${subjectType}:${subjectValue} refused: ${x instanceof Error ? x.message : String(x)}`,
    };
  }
}
