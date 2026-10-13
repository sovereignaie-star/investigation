/**
 * P2-009 — TR-004: certificate transparency (domain → certs, subdomains).
 *
 * Source: crt.sh (`crt.sh`), public, no key (LC-B). The transform queries the
 * CT log search for `%.{domain}` and emits a finding per unique name found in
 * certificate name_value fields, plus the certificate serials.
 *
 * All network I/O goes through `ctx.http` (egress gateway in production).
 * Limits: rps 1, timeoutMs 15s, maxBytes 2MB.
 */
import { defineTransform } from "../manifest.ts";
import { normalizeDomain, parseJson } from "./util.ts";

const CRT_SH = "https://crt.sh";

export const certTransparency = defineTransform<{ domain: string }>(
  {
    id: "TR-004",
    version: "1.0.0",
    inputs: ["domain"],
    outputs: ["hostname", "ssl_cert_hash"],
    network: { mode: "public", allow: [] },
    secrets: [],
    limits: { rps: 1, timeoutMs: 15_000, maxBytes: 2_000_000 },
    sensitivity: "normal",
    license: "LC-B",
  },
  async (input, ctx) => {
    const domain = normalizeDomain(input.domain);
    const url = `${CRT_SH}/?q=%25.${encodeURIComponent(domain)}&output=json`;
    const res = await ctx.http.get(url);
    const certs = parseJson(res.body, "crt.sh") as Array<{
      name_value?: string;
      issuer_name?: string;
      serial_number?: string;
      not_before?: string;
    }>;

    const findings: Array<{ predicate: string; objectType: string; objectValue: string; confidence: number; explanation: string }> = [];
    const seen = new Set<string>();
    for (const cert of certs) {
      const names = String(cert.name_value ?? "").split("\n");
      for (const raw of names) {
        const n = raw.trim().toLowerCase().replace(/^\*\./, "").replace(/\.$/, "");
        if (!n || !n.endsWith(domain) || seen.has(n)) continue;
        seen.add(n);
        findings.push({
          predicate: "has_subdomain",
          objectType: "hostname",
          objectValue: n,
          confidence: 0.9,
          explanation: `Certificate for ${n} (issuer: ${cert.issuer_name ?? "unknown"})`,
        });
      }
      if (cert.serial_number) {
        findings.push({
          predicate: "has_certificate",
          objectType: "ssl_cert_hash",
          objectValue: cert.serial_number,
          confidence: 0.9,
          explanation: `Certificate serial for ${domain}`,
        });
      }
    }
    return { findings };
  },
);
