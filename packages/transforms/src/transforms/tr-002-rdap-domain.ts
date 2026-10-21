/**
 * P2-009 — TR-002: RDAP for a domain (domain → registrar, dates, status, nameservers).
 *
 * Source: RDAP via the IANA DNS bootstrap (`data.iana.org/rdap/dns.json`), public, no key (LC-B). The transform
 * resolves the TLD's RDAP base URL from the bootstrap, then queries `{base}domain/{domain}`.
 *
 * P2-037 (1.1.0): the bootstrap's `services` entries carry a LIST of URLs (RFC 9224) — the first https one is used;
 * the registrar comes from the entity with role `registrar` (RDAP has no top-level `registrar` member;
 * an entity whose jCard kind is `individual` is refused); RDAP 404 is a genuine negative, any other non-200 fails the run; every finding cites the
 * RDAP response (not the bootstrap). The RDAP host found in the bootstrap must be on the operator's explicit host
 * list: the gateway refuses it before connecting otherwise (see `rdap.ts`).
 *
 * All network I/O goes through `ctx.http` (egress gateway in production).
 * Limits: rps 2, timeoutMs 10s, maxBytes 1MB.
 */
import { defineTransform } from "../manifest.ts";
import type { TransformFinding } from "../output.ts";
import { entitiesWithRole, httpsBase, orgName, parseBootstrap, rdapNotFound } from "./rdap.ts";
import { normalizeDomain, parseJson } from "./util.ts";

const IANA_BOOTSTRAP = "https://data.iana.org/rdap/dns.json";

interface RdapDomain {
  entities?: unknown;
  events?: Array<{ eventAction?: string; eventDate?: string }>;
  status?: unknown;
  nameservers?: Array<{ ldhName?: string }>;
}

export const rdapDomain = defineTransform<{ domain: string }>(
  {
    id: "TR-002",
    version: "1.1.0",
    inputs: ["domain"],
    outputs: ["organization", "date", "domain_status", "hostname"],
    network: { mode: "public", allow: [] },
    secrets: [],
    limits: { rps: 2, timeoutMs: 10_000, maxBytes: 1_000_000 },
    sensitivity: "normal",
    license: "LC-B",
    // P4-002: the documented Admiralty source grade (D2/5.13) — the basis the confidence model consumes.
    admiralty: {
      reliability: "A",
      credibility: 2,
      rationale:
        "RDAP الرسمي عبر جدول إقلاع IANA — بيانات سجلات أسماء النطاقات الرسمية من المشغلين المفوضين؛ الاشتقاق (المسجل/الحالة/الخوادم) من السجل الرسمي مباشرة",
    },
  },
  async (input, ctx) => {
    const domain = normalizeDomain(input.domain);
    if (!domain.includes(".")) throw new Error(`TR-002: "${domain}" is not a registrable domain`);
    const tld = domain.split(".").pop() ?? "";

    const services = parseBootstrap(await ctx.http.get(IANA_BOOTSTRAP), "IANA RDAP bootstrap");
    const entry = services.find(([tlds]) => tlds.some((t) => t.toLowerCase() === tld));
    const base = entry ? httpsBase(entry) : undefined;
    if (!base) throw new Error(`TR-002: no https RDAP server for TLD "${tld}" in the IANA bootstrap`);

    const res = await ctx.http.get(`${base}domain/${encodeURIComponent(domain)}`);
    if (rdapNotFound(res, "RDAP")) return { findings: [] };
    const data = parseJson(res.body, "RDAP") as RdapDomain;
    return { findings: buildFindings(domain, data, res.requestId) };
  },
);

/** Convert an RDAP domain object into typed findings, each citing the RDAP response. */
function buildFindings(domain: string, data: RdapDomain, requestId: number): TransformFinding[] {
  const findings: TransformFinding[] = [];
  const push = (predicate: string, objectType: string, objectValue: string, explanation: string) =>
    findings.push({ predicate, evidence: [requestId], objectType, objectValue, confidence: 1, explanation });

  for (const name of new Set(
    entitiesWithRole(data, "registrar")
      .map((e) => orgName(e, false))
      .filter((n): n is string => !!n),
  )) {
    push("registered_with", "organization", name, `Registrar for ${domain} (RDAP entity role registrar)`);
  }
  for (const ev of data.events ?? []) {
    if (typeof ev.eventDate !== "string" || Number.isNaN(Date.parse(ev.eventDate))) continue;
    if (ev.eventAction === "registration") push("registered_on", "date", ev.eventDate, `Registration date for ${domain}`);
    else if (ev.eventAction === "expiration") push("expires_on", "date", ev.eventDate, `Expiration date for ${domain}`);
  }
  for (const s of Array.isArray(data.status) ? new Set(data.status as unknown[]) : []) {
    if (typeof s === "string" && s.trim()) push("has_domain_status", "domain_status", s.trim(), `RDAP status for ${domain}`);
  }
  for (const name of nameservers(data)) push("has_name_server", "hostname", name, `Nameserver for ${domain}`);
  return findings;
}

/** Distinct nameserver names, lowercased, without the root dot. */
function nameservers(data: RdapDomain): string[] {
  const names = (data.nameservers ?? []).map((ns) =>
    typeof ns.ldhName === "string" ? ns.ldhName.trim().toLowerCase().replace(/\.$/, "") : "",
  );
  return [...new Set(names.filter((n) => n.length > 0))];
}
