/**
 * P2-011 — TR-026: OFAC SDN list (name → SDN match; the official file, not an aggregator).
 *
 * Source: the official OFAC SDN file (https://www.treasury.gov/ofac/downloads/sdn.xml),
 * public, no key (LC-B; evaluation docs/tools/evaluations/TL-05f49117.md and its implementation note).
 * The transform downloads the SDN file once per run (maxBytes 40MB), parses
 * its XML with a bounded linear parser (no streaming XML library; the file is small enough to
 * hold in memory after the size cap), and matches the subject name against the party aliases.
 * The sensitivity is `natural_person_gate` (E-02): a run requires a purpose confirmation and
 * the result never becomes an expansion node (no name→name inference; D-018).
 *
 * All network I/O goes through `ctx.http` (egress gateway in production, ADR-08).
 * Limits: rps 1, timeoutMs 120s, maxBytes 40MB (the live file measured 29MB on 2026-10-15; the
 * original 8MB cap would have refused the real file).
 */
import { defineTransform } from "../manifest.ts";
import type { TransformFinding } from "../output.ts";
import { parseXmlSdn } from "./ofac-xml.ts";

const FILE = "https://www.treasury.gov/ofac/downloads/sdn.xml";

export const ofacSdn = defineTransform<{ name: string }>(
  {
    id: "TR-026",
    version: "1.0.0",
    inputs: ["person_name"],
    outputs: ["sdn_uid"],
    network: { mode: "public", allow: [] },
    secrets: [],
    limits: { rps: 1, timeoutMs: 120_000, maxBytes: 40_000_000 },
    sensitivity: "natural_person_gate",
    license: "LC-B",
    // P4-002: the documented Admiralty source grade (D2/5.13) — the basis the confidence model consumes.
    admiralty: {
      reliability: "A",
      credibility: 1,
      rationale: "ملف OFAC SDN الرسمي الصادر عن وزارة الخزانة الأمريكية — قائمة عقوبات تنفيذية أولية",
    },
  },
  async (input, ctx) => {
    const name = input.name.trim();
    if (name.length < 3 || name.length > 200) throw new Error(`TR-026: invalid name "${input.name}"`);
    const res = await ctx.http.get(FILE);
    const parties = parseXmlSdn(res.body);
    const findings: TransformFinding[] = [];
    for (const p of parties) {
      if (!p.aliases.some((a) => a.toLowerCase() === name.toLowerCase())) continue;
      findings.push({
        predicate: "is_on_sdn_list",
        objectType: "sdn_uid",
        objectValue: String(p.uid),
        confidence: 0.95,
        explanation: `OFAC SDN: uid ${p.uid} (${p.category}) lists the name "${name}"`,
        evidence: [res.requestId],
      });
    }
    return { findings };
  },
);
