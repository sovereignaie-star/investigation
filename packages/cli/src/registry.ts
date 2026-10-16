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
    module: mod("tr-009-urlscan.ts"),
    subjects: { url: httpUrlInput },
    // the search request URL carries the subject's URL host as the searched domain (q=domain:...)
    sends: ["url", "domain"],
    hosts: ["urlscan.io"],
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
