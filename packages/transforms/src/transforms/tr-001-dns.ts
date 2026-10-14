/**
 * P2-009 — TR-001: DNS resolution (domain → A/AAAA/MX/NS/TXT/CNAME).
 *
 * Source: DNS-over-HTTPS (Google `dns.google`), public, no key (LC-B).
 * The transform issues one DoH query per record type and emits typed findings
 * for every answer. All network I/O goes through `ctx.http` (the egress
 * gateway in production, ADR-08); there is no direct DNS or socket access.
 *
 * P2-037 (1.1.0): every finding cites the query that returned it; a non-200 HTTP status or a DNS RCODE other than
 * NOERROR/NXDOMAIN fails the run (SERVFAIL is not "no records"); only answers for the queried name are kept for
 * CNAME/MX/NS/TXT; TXT values are emitted in the catalog's quoted form (multi-string records joined) and dropped
 * when they cannot be represented; MX values keep their preference ("10 mail.example.com").
 *
 * Limits: rps 1, timeoutMs 10s, maxBytes 1MB. P2-037: the rate was 2/s, above the gateway's per-host budget
 * (ADR-08: 1/s, burst 4, temporary), so the fifth of the six queries to dns.google was refused as rate_limited; a
 * transform's declared rate must not exceed the gateway's per-host rate.
 */
import { defineTransform } from "../manifest.ts";
import type { TransformFinding } from "../output.ts";
import { normalizeDomain, parseDoh } from "./util.ts";

const DOH = "https://dns.google/resolve";

/** RR type numbers used by Google DoH JSON. */
const RR = { A: 1, AAAA: 28, MX: 15, NS: 2, TXT: 16, CNAME: 5 } as const;

const QUERIES: ReadonlyArray<{ type: keyof typeof RR; predicate: string; objectType: string }> = [
  { type: "A", predicate: "resolves_to", objectType: "ipv4" },
  { type: "AAAA", predicate: "resolves_to", objectType: "ipv6" },
  { type: "MX", predicate: "has_mail_server", objectType: "mx_record" },
  { type: "NS", predicate: "has_name_server", objectType: "hostname" },
  { type: "TXT", predicate: "has_txt_record", objectType: "txt_record" },
  { type: "CNAME", predicate: "is_cname_of", objectType: "hostname" },
];

/** "name." / "NAME" -> "name" (DNS names are case-insensitive; the trailing root dot is not part of the value). */
function dnsName(raw: string): string {
  return raw.trim().toLowerCase().replace(/\.$/, "");
}

/**
 * The TXT value in the catalog form `"..."` (txt_record pattern `^"[^"]+"$`). DoH returns each character-string
 * quoted; a record split into several strings ("a" "b") is one value "ab" (RFC 7208 §3.3). A value that still
 * contains a quote, or is empty, cannot be represented in the catalog form and is not emitted.
 */
function txtValue(raw: string): string | undefined {
  const s = raw.trim();
  const parts = /^"/.test(s) ? [...s.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]) : [s];
  const joined = parts.join("");
  if (joined.length === 0 || joined.includes('"')) return undefined;
  return `"${joined}"`;
}

/** "10 mail.example.com." -> "10 mail.example.com"; undefined when the MX data is not "<preference> <host>". */
function mxValue(raw: string): string | undefined {
  const m = /^(\d{1,5})\s+(\S+)$/.exec(raw.trim());
  if (!m) return undefined;
  const host = dnsName(m[2]);
  return host.length > 0 ? `${Number(m[1])} ${host}` : undefined;
}

export const dnsResolve = defineTransform<{ domain: string }>(
  {
    id: "TR-001",
    version: "1.1.0",
    // P2-039: a host name (nameserver, certificate name) is queried exactly like a domain.
    inputs: ["domain", "hostname"],
    outputs: ["ipv4", "ipv6", "mx_record", "hostname", "txt_record"],
    network: { mode: "public", allow: [] },
    secrets: [],
    limits: { rps: 1, timeoutMs: 10_000, maxBytes: 1_000_000 },
    sensitivity: "normal",
    license: "LC-B",
  },
  async (input, ctx) => {
    const domain = normalizeDomain(input.domain);
    const findings: TransformFinding[] = [];
    const seen = new Set<string>();
    for (const q of QUERIES) {
      const url = `${DOH}?name=${encodeURIComponent(domain)}&type=${RR[q.type]}`;
      const res = await ctx.http.get(url);
      const answers = parseDoh(res, `dns.google ${q.type}`);
      for (const a of answers) {
        if (a.type !== RR[q.type] || typeof a.data !== "string") continue;
        // A/AAAA may follow a CNAME chain (the answer is for the chain's target, still the queried name's address);
        // the other record types are kept only when they belong to the queried name itself.
        if (q.type !== "A" && q.type !== "AAAA" && typeof a.name === "string" && dnsName(a.name) !== domain) continue;
        const value =
          q.type === "TXT"
            ? txtValue(a.data)
            : q.type === "MX"
              ? mxValue(a.data)
              : q.type === "NS" || q.type === "CNAME"
                ? dnsName(a.data)
                : a.data.trim();
        if (!value) continue;
        const key = `${q.predicate}|${q.objectType}|${value}`;
        if (seen.has(key)) continue;
        seen.add(key);
        findings.push({
          predicate: q.predicate,
          evidence: [res.requestId],
          objectType: q.objectType,
          objectValue: value,
          confidence: 1,
          explanation: `${q.type} record for ${domain}`,
        });
      }
    }
    return { findings };
  },
);
