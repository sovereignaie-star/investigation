/**
 * P2-009 — TR-004: certificate transparency (domain → certs, subdomains).
 *
 * Source: crt.sh (`crt.sh`), public, no key (LC-B). The transform queries the
 * CT log search for `%.{domain}` and emits a finding per unique name found in
 * certificate name_value fields.
 *
 * All network I/O goes through `ctx.http` (egress gateway in production).
 * Limits: rps 1, timeoutMs 15s, maxBytes 2MB.
 *
 * P2-037 (1.1.0): a name belongs to the domain only when it IS the domain's subdomain (`n.endsWith("." + domain)`;
 * "evilexample.com" is not a subdomain of "example.com", the previous `endsWith(domain)` check said it was); the
 * domain itself is not reported as its own subdomain; names that are not valid DNS hostnames are dropped. The
 * certificate serial number is no longer emitted: it is not an `ssl_cert_hash` (a fingerprint of the certificate)
 * and the catalog has no certificate-serial type, so there is no correct type to record it under — the raw crt.sh
 * response stays in the evidence. A non-200 answer fails the run (crt.sh 5xx is not "no certificates").
 */
import { defineTransform } from "../manifest.ts";
import type { TransformFinding } from "../output.ts";
import { expectStatus, normalizeDomain, parseJson } from "./util.ts";

const CRT_SH = "https://crt.sh";

export const certTransparency = defineTransform<{ domain: string }>(
  {
    id: "TR-004",
    version: "1.1.0",
    inputs: ["domain"],
    outputs: ["hostname"],
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
    expectStatus(res, [200], "crt.sh");
    const certs = parseJson(res.body, "crt.sh");
    if (!Array.isArray(certs)) throw new Error("crt.sh: answer is not a list");

    const findings: TransformFinding[] = [];
    const seen = new Set<string>();
    for (const cert of certs as Array<{ name_value?: unknown; issuer_name?: unknown }>) {
      const names = typeof cert.name_value === "string" ? cert.name_value.split("\n") : [];
      for (const raw of names) {
        const n = raw.trim().toLowerCase().replace(/^\*\./, "").replace(/\.$/, "");
        if (!n || n === domain || !n.endsWith(`.${domain}`) || seen.has(n)) continue;
        try {
          if (normalizeDomain(n) !== n) continue;
        } catch {
          continue; // not a DNS hostname (e.g. an e-mail address in a SAN, a malformed name)
        }
        seen.add(n);
        findings.push({
          predicate: "has_subdomain",
          evidence: [res.requestId],
          objectType: "hostname",
          objectValue: n,
          confidence: 0.9,
          explanation: `Certificate for ${n} (issuer: ${typeof cert.issuer_name === "string" ? cert.issuer_name : "unknown"})`,
        });
      }
    }
    return { findings };
  },
);
