/**
 * P2-009 — TR-002: RDAP for a domain (domain → registrar, dates, status).
 *
 * Source: RDAP via the IANA DNS bootstrap (`data.iana.org/rdap/dns.json`),
 * public, no key (LC-B). The transform resolves the TLD's RDAP base URL from
 * the bootstrap, then queries `{base}domain/{domain}`.
 *
 * All network I/O goes through `ctx.http` (egress gateway in production).
 * Limits: rps 2, timeoutMs 10s, maxBytes 1MB.
 */
import { defineTransform } from "../manifest.ts";
import { normalizeDomain, parseJson } from "./util.ts";

const IANA_BOOTSTRAP = "https://data.iana.org/rdap/dns.json";

type Finding = { predicate: string; objectType: string; objectValue: string; confidence: number; explanation: string };

export const rdapDomain = defineTransform<{ domain: string }>(
  {
    id: "TR-002",
    version: "1.0.0",
    inputs: ["domain"],
    outputs: ["organization", "date", "domain_status", "hostname"],
    network: { mode: "public", allow: [] },
    secrets: [],
    limits: { rps: 2, timeoutMs: 10_000, maxBytes: 1_000_000 },
    sensitivity: "normal",
    license: "LC-B",
  },
  async (input, ctx) => {
    const domain = normalizeDomain(input.domain);
    const tld = domain.split(".").pop() ?? "";

    const bootstrap = parseJson((await ctx.http.get(IANA_BOOTSTRAP)).body, "IANA RDAP bootstrap") as {
      services?: Array<[string[], string]>;
    };
    const entry = (bootstrap.services ?? []).find(([tlds]) => tlds.includes(tld));
    if (!entry) throw new Error(`TR-002: no RDAP server for TLD "${tld}"`);
    const base = entry[1].replace(/\/$/, "");

    const res = await ctx.http.get(`${base}/domain/${encodeURIComponent(domain)}`);
    const data = parseJson(res.body, "RDAP") as {
      registrar?: { name?: string };
      events?: Array<{ eventAction?: string; eventDate?: string }>;
      status?: string[];
      nameservers?: Array<{ ldhName?: string }>;
    };
    return { findings: buildFindings(domain, data) };
  },
);

/** Convert an RDAP domain object into typed findings. */
function buildFindings(
  domain: string,
  data: {
    registrar?: { name?: string };
    events?: Array<{ eventAction?: string; eventDate?: string }>;
    status?: string[];
    nameservers?: Array<{ ldhName?: string }>;
  },
): Finding[] {
  const findings: Finding[] = [];
  if (data.registrar?.name) {
    findings.push({
      predicate: "registered_with",
      objectType: "organization",
      objectValue: data.registrar.name,
      confidence: 1,
      explanation: `Registrar for ${domain}`,
    });
  }
  for (const ev of data.events ?? []) {
    if (!ev.eventDate) continue;
    if (ev.eventAction === "registration") {
      findings.push({
        predicate: "registered_on",
        objectType: "date",
        objectValue: ev.eventDate,
        confidence: 1,
        explanation: `Registration date for ${domain}`,
      });
    } else if (ev.eventAction === "expiration") {
      findings.push({
        predicate: "expires_on",
        objectType: "date",
        objectValue: ev.eventDate,
        confidence: 1,
        explanation: `Expiration date for ${domain}`,
      });
    }
  }
  for (const s of data.status ?? []) {
    findings.push({
      predicate: "has_domain_status",
      objectType: "domain_status",
      objectValue: s,
      confidence: 1,
      explanation: `RDAP status for ${domain}`,
    });
  }
  for (const ns of data.nameservers ?? []) {
    if (ns.ldhName) {
      findings.push({
        predicate: "has_name_server",
        objectType: "hostname",
        objectValue: ns.ldhName.replace(/\.$/, ""),
        confidence: 1,
        explanation: `Nameserver for ${domain}`,
      });
    }
  }
  return findings;
}
