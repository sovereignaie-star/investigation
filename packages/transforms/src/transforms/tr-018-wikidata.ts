/**
 * P2-010 — TR-018: Wikidata (name/id → entity and properties).
 *
 * Source: Wikidata API (`www.wikidata.org`), public, no key (LC-B). The
 * transform queries the entity endpoint and emits findings for the entity's
 * label and description. All network I/O goes through `ctx.http` (egress
 * gateway in production, ADR-08).
 *
 * Limits: rps 1, timeoutMs 15s, maxBytes 2MB.
 */
import { defineTransform } from "../manifest.ts";
import type { TransformFinding } from "../output.ts";
import { parseJson } from "./util.ts";

const API = "https://www.wikidata.org/w/api.php";

interface WikidataEntity {
  labels?: Record<string, { value?: string }>;
  descriptions?: Record<string, { value?: string }>;
}

type Finding = TransformFinding;

function entityFinding(predicate: string, qid: string, value: string, confidence: number, explanation: string): Finding {
  return { predicate, objectType: "url", objectValue: `https://www.wikidata.org/wiki/${qid}`, confidence, explanation };
}

function labelFinding(qid: string, entity: WikidataEntity): Finding | undefined {
  const label = entity.labels?.en?.value ?? entity.labels?.ar?.value;
  return label ? entityFinding("has_display_name", qid, label, 0.9, `Wikidata: ${qid} is "${label}"`) : undefined;
}

function descriptionFinding(qid: string, entity: WikidataEntity): Finding | undefined {
  const description = entity.descriptions?.en?.value ?? entity.descriptions?.ar?.value;
  return description ? entityFinding("has_description", qid, description, 0.8, `Wikidata: ${qid} — "${description}"`) : undefined;
}

export const wikidataEntity = defineTransform<{ qid: string }>(
  {
    id: "TR-018",
    version: "1.0.0",
    inputs: ["qid"],
    outputs: ["url"],
    network: { mode: "public", allow: [] },
    secrets: [],
    limits: { rps: 1, timeoutMs: 15_000, maxBytes: 2_000_000 },
    sensitivity: "normal",
    license: "LC-B",
    // P4-002: the documented Admiralty source grade (D2/5.13) — the basis the confidence model consumes.
    admiralty: {
      reliability: "C",
      credibility: 4,
      rationale: "ويكي بيانات — قاعدة معرفة مجتمعية التحرير: بيانات مرجعية ممتازة في المتوسط مع أخطاء تحرير فردية واردة",
    },
  },
  async (input, ctx) => {
    const qid = input.qid.trim();
    if (!/^Q\d+$/.test(qid)) throw new Error(`TR-018: invalid Wikidata QID "${input.qid}"`);
    const url = `${API}?action=wbgetentities&ids=${encodeURIComponent(qid)}&format=json&props=labels|descriptions`;
    const res = await ctx.http.get(url);
    const data = parseJson(res.body, "Wikidata") as { entities?: Record<string, WikidataEntity> };
    const entity = data.entities?.[qid];
    const findings: Finding[] = [];
    if (!entity) return { findings };
    const label = labelFinding(qid, entity);
    if (label) findings.push({ ...label, evidence: [res.requestId] });
    const description = descriptionFinding(qid, entity);
    if (description) findings.push({ ...description, evidence: [res.requestId] });
    return { findings };
  },
);
