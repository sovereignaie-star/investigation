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
  type Transform,
} from "@ir/transforms";

export interface RegisteredTransform {
  readonly transform: Transform;
  readonly module: string;
  /** subject catalog type -> the transform's input object, from the normalized subject value. */
  readonly subjects: Readonly<Record<string, (value: string) => Record<string, unknown>>>;
  readonly sends: readonly string[];
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

const mod = (file: string) => fileURLToPath(new URL(`../../transforms/src/transforms/${file}`, import.meta.url));

export const REGISTRY: readonly RegisteredTransform[] = [
  {
    transform: dnsResolve,
    module: mod("tr-001-dns.ts"),
    subjects: { domain: domainInput },
    sends: ["domain"],
    hosts: ["dns.google"],
    pageFetch: false,
  },
  {
    transform: rdapDomain,
    module: mod("tr-002-rdap-domain.ts"),
    subjects: { domain: domainInput },
    sends: ["domain"],
    hosts: ["data.iana.org"],
    discoveredHosts: "the RDAP server of the domain's TLD named in https://data.iana.org/rdap/dns.json (e.g. rdap.verisign.com for .com)",
    pageFetch: false,
  },
  {
    transform: rdapIp,
    module: mod("tr-003-rdap-ip.ts"),
    subjects: { ipv4: ipv4Input, ipv6: ipv6Input, asn: asnInput },
    // The RDAP path carries the address or the AS number. The bootstrap requests carry no subject, but the gateway's
    // content inventory reads their file names (ipv4.json, ipv6.json, asn.json) as DNS names, so "domain" is declared
    // too; without it every TR-003 run is refused as undeclared_data at its first request.
    sends: ["ip", "asn", "domain"],
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
