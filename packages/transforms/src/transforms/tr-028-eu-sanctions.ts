/**
 * P2-011 — TR-028: EU consolidated financial sanctions list (name → reference number).
 *
 * Source: the official EU Financial Sanctions Files full list (webgate.ec.europa.eu/fsd/fsf,
 * https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content), public, no key
 * (LC-B; evaluation docs/tools/evaluations/TL-327f11e4.md). The transform downloads the full list once
 * per run (maxBytes 32MB — the live file is ~26MB), parses it with the bounded linear reader
 * (fail-closed on malformed structure), and matches the subject name against the parties' wholeName
 * aliases. The sensitivity is `natural_person_gate` (E-02): the result never becomes an expansion node
 * (D-018). All network I/O goes through `ctx.http`. Limits: rps 1, timeoutMs 120s, maxBytes 32MB.
 */
import { defineTransform } from "../manifest.ts";
import type { TransformFinding } from "../output.ts";
import { parseEuSanctions } from "./eu-xml.ts";

/**
 * The official download URL as recorded in the EU open-data catalog record (data.europa.eu,
 * distribution 5a1720a6): the parameter-free form returns 403; the catalog's record carries the token
 * query parameter as fixed public catalog metadata (the same value in every record, not a per-user
 * secret). The token is NOT stored in source: it is read from the environment (IR_EU_FSD_TOKEN) at
 * run time, so a run without it fails closed with a clear error — the same rule as any keyed source.
 */
function fileUrl(): string {
  const token = process.env.IR_EU_FSD_TOKEN ?? "";
  if (token === "") throw new Error("TR-028: IR_EU_FSD_TOKEN is not set (the EU catalog's fixed public token)");
  return `https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=${token}`;
}

export const euSanctions = defineTransform<{ name: string }>(
  {
    id: "TR-028",
    version: "1.0.0",
    inputs: ["person_name"],
    outputs: ["eu_reference"],
    network: { mode: "public", allow: [] },
    secrets: [],
    // The sandbox does not inherit the parent's environment: the token is declared here so the
    // isolated runner forwards IR_EU_FSD_TOKEN (and only it) to the child over IPC. Without it the
    // run fails closed before any transport call.
    env: ["IR_EU_FSD_TOKEN"],
    limits: { rps: 1, timeoutMs: 120_000, maxBytes: 32_000_000 },
    sensitivity: "natural_person_gate",
    license: "LC-B",
    // P4-002: the documented Admiralty source grade (D2/5.13) — the basis the confidence model consumes.
    admiralty: {
      reliability: "A",
      credibility: 1,
      rationale: "ملفات العقوبات المالية الرسمية للاتحاد الأوروبي — قائمة أولية رسمية نافذة قانونياً",
    },
  },
  async (input, ctx) => {
    const name = input.name.trim();
    if (name.length < 3 || name.length > 200) throw new Error(`TR-028: invalid name "${input.name}"`);
    const res = await ctx.http.get(fileUrl());
    const parties = parseEuSanctions(res.body);
    const findings: TransformFinding[] = [];
    for (const p of parties) {
      if (!p.names.some((a) => a.toLowerCase() === name.toLowerCase())) continue;
      findings.push({
        predicate: "is_on_eu_sanctions_list",
        objectType: "eu_reference",
        objectValue: p.euReferenceNumber,
        confidence: 0.95,
        explanation: `EU consolidated financial sanctions: ${p.euReferenceNumber} (${p.subjectType}) lists the name "${name}"`,
        evidence: [res.requestId],
      });
    }
    return { findings };
  },
);
