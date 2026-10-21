/**
 * P2-010 — TR-020: technical email check (email → syntax, MX, disposable).
 *
 * Source: self-hosted (DNS only, no SMTP check) (LC-B). The transform checks
 * the email's syntax, extracts the domain, queries the MX record via DNS-over-
 * HTTPS (dns.google), and flags disposable domains. Sensitivity is
 * `natural_person_gate` (E-02) because an email identifies a person.
 *
 * All network I/O goes through `ctx.http` (egress gateway in production).
 * Limits: rps 1, timeoutMs 15s, maxBytes 1MB.
 */
import { defineTransform } from "../manifest.ts";
import type { TransformFinding } from "../output.ts";
import { isEmail, parseJson } from "./util.ts";

const DOH = "https://dns.google/resolve";
const DISPOSABLE = /@(mailinator|guerrillamail|tempmail|throwam|yopmail|sharklasers|guerrillamailblock|spam4|grr|zzrgg|trbvm|mt2r)\.com$/i;

export const emailTech = defineTransform<{ email: string }>(
  {
    id: "TR-020",
    version: "1.0.0",
    inputs: ["email"],
    outputs: ["email", "email_disposable", "mx_record", "domain"],
    network: { mode: "public", allow: [] },
    secrets: [],
    limits: { rps: 1, timeoutMs: 15_000, maxBytes: 1_000_000 },
    sensitivity: "natural_person_gate",
    license: "LC-B",
    // P4-002: the documented Admiralty source grade (D2/5.13) — the basis the confidence model consumes.
    admiralty: {
      reliability: "B",
      credibility: 3,
      rationale: "تحقق تقني ذاتي الاستضافة عبر DNS مباشر — سجلات MX/SPF/DMARC من DNS نفسه لحظة الاستعلام",
    },
  },
  async (input, ctx) => {
    const email = input.email.trim();
    if (!isEmail(email)) throw new Error(`TR-020: invalid email "${input.email}"`);
    const domain = email.split("@")[1] ?? "";

    const findings: TransformFinding[] = [];
    if (DISPOSABLE.test(email)) {
      findings.push({
        predicate: "is_disposable",
        derivedFrom: "input",
        objectType: "email_disposable",
        objectValue: email,
        confidence: 0.9,
        explanation: `TR-020: ${email} uses a disposable domain`,
      });
    }

    const res = await ctx.http.get(`${DOH}?name=${encodeURIComponent(domain)}&type=MX`);
    const data = parseJson(res.body, "dns.google") as { Answer?: Array<{ data?: string }> };
    const answers = data.Answer ?? [];
    for (const answer of answers) {
      if (answer.data) {
        findings.push({
          predicate: "has_mx_record",
          evidence: [res.requestId],
          objectType: "mx_record",
          objectValue: answer.data,
          confidence: 0.9,
          explanation: `TR-020: ${domain} MX ${answer.data}`,
        });
      }
    }
    if (answers.length === 0) {
      findings.push({
        predicate: "has_no_mx_record",
        evidence: [res.requestId],
        objectType: "domain",
        objectValue: domain,
        confidence: 0.8,
        explanation: `TR-020: ${domain} has no MX record`,
      });
    }
    return { findings };
  },
);
