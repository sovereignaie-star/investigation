/**
 * P2-009 — TR-001: DNS resolution (domain → A/AAAA/MX/NS/TXT/CNAME).
 *
 * Source: DNS-over-HTTPS (Google `dns.google`), public, no key (LC-B).
 * The transform issues one DoH query per record type and emits typed findings
 * for every answer. All network I/O goes through `ctx.http` (the egress
 * gateway in production, ADR-08); there is no direct DNS or socket access.
 *
 * Limits: rps 2 (one burst of 6 queries), timeoutMs 10s, maxBytes 1MB.
 */
import { defineTransform } from "../manifest.ts";
import { normalizeDomain, parseJson } from "./util.ts";

const DOH = "https://dns.google/resolve";

/** DNS record type → DoH query type number. */
const TYPES: Array<{ type: number; name: string; predicate: string; objectType: string }> = [
  { type: 1, name: "A", predicate: "resolves_to", objectType: "ipv4" },
  { type: 28, name: "AAAA", predicate: "resolves_to", objectType: "ipv6" },
  { type: 15, name: "MX", predicate: "has_mail_server", objectType: "mx_record" },
  { type: 2, name: "NS", predicate: "has_name_server", objectType: "hostname" },
  { type: 16, name: "TXT", predicate: "has_txt_record", objectType: "txt_record" },
  { type: 5, name: "CNAME", predicate: "is_cname_of", objectType: "hostname" },
];

export const dnsResolve = defineTransform<{ domain: string }>(
  {
    id: "TR-001",
    version: "1.0.0",
    inputs: ["domain"],
    outputs: ["ipv4", "ipv6", "mx_record", "hostname", "txt_record"],
    network: { mode: "public", allow: [] },
    secrets: [],
    limits: { rps: 2, timeoutMs: 10_000, maxBytes: 1_000_000 },
    sensitivity: "normal",
    license: "LC-B",
  },
  async (input, ctx) => {
    const domain = normalizeDomain(input.domain);
    const findings: Array<{ predicate: string; objectType: string; objectValue: string; confidence: number; explanation: string }> = [];

    for (const t of TYPES) {
      const url = `${DOH}?name=${encodeURIComponent(domain)}&type=${t.type}`;
      const res = await ctx.http.get(url);
      const data = parseJson(res.body, "dns.google") as {
        Answer?: Array<{ name?: string; type?: number; data?: string }>;
      };
      for (const ans of data.Answer ?? []) {
        if (ans.type !== t.type || !ans.data) continue;
        let value = ans.data;
        if (t.name === "MX") {
          // data is "preference exchange" — keep the full record (mx_record pattern: "10 mail.example.com")
          value = ans.data.trim();
        } else if (t.name === "TXT") {
          // DoH returns TXT data already quoted: `"v=spf1 ..."` — keep as-is (txt_record pattern)
          value = ans.data.trim();
        } else {
          value = ans.data.trim().replace(/\.$/, "");
        }
        if (!value) continue;
        findings.push({
          predicate: t.predicate,
          objectType: t.objectType,
          objectValue: value,
          confidence: 1,
          explanation: `${t.name} record for ${domain}`,
        });
      }
    }
    return { findings };
  },
);
