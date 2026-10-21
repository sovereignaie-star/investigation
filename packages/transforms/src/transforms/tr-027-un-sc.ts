/**
 * P2-011 — TR-027: UN Security Council Consolidated List (name → reference number).
 *
 * Source: the official UN SC consolidated XML (https://main.un.org/securitycouncil/sites/un.org/files/sc-sanctions-list/xml/consolidated.xml),
 * public, no key (LC-B; evaluation docs/tools/evaluations/TL-05810eb0.md). The transform downloads the
 * consolidated file once per run (maxBytes 8MB), parses it with the bounded linear reader (fail-closed
 * on malformed structure), and matches the subject name against the party names. The sensitivity is
 * `natural_person_gate` (E-02): the result never becomes an expansion node (D-018). All network I/O
 * goes through `ctx.http`. Limits: rps 1, timeoutMs 60s, maxBytes 8MB.
 */
import { defineTransform } from "../manifest.ts";
import type { TransformFinding } from "../output.ts";
import { parseUnConsolidated } from "./un-sc-xml.ts";

const FILE = "https://main.un.org/securitycouncil/sites/un.org/files/sc-sanctions-list/xml/consolidated.xml";

export const unScConsolidated = defineTransform<{ name: string }>(
  {
    id: "TR-027",
    version: "1.0.0",
    inputs: ["person_name"],
    outputs: ["un_reference"],
    network: { mode: "public", allow: [] },
    secrets: [],
    limits: { rps: 1, timeoutMs: 60_000, maxBytes: 8_000_000 },
    sensitivity: "natural_person_gate",
    license: "LC-B",
    // P4-002: the documented Admiralty source grade (D2/5.13) — the basis the confidence model consumes.
    admiralty: { reliability: "A", credibility: 1, rationale: "قائمة مجلس الأمن الدولي الموحدة الرسمية — مصدر أولي ملزم دولياً" },
  },
  async (input, ctx) => {
    const name = input.name.trim();
    if (name.length < 3 || name.length > 200) throw new Error(`TR-027: invalid name "${input.name}"`);
    const res = await ctx.http.get(FILE);
    const parties = parseUnConsolidated(res.body);
    const findings: TransformFinding[] = [];
    for (const p of parties) {
      if (!p.names.some((a) => a.toLowerCase() === name.toLowerCase())) continue;
      findings.push({
        predicate: "is_on_un_sc_list",
        objectType: "un_reference",
        objectValue: p.referenceNumber,
        confidence: 0.95,
        explanation: `UN SC Consolidated List: ${p.referenceNumber} (${p.entityType ?? "party"}) lists the name "${name}"`,
        evidence: [res.requestId],
      });
    }
    return { findings };
  },
);
