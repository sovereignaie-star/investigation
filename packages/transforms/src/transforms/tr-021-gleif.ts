/**
 * P2-011 — TR-021: GLEIF (LEI → legal entity, ownership; name → LEI).
 *
 * Source: GLEIF API (`api.gleif.org`), public, no key (LC-B; evaluation docs/tools/evaluations/TL-be358c53.md).
 * Two operations: search an LEI by entity name (`autocomplete`), and read an LEI record (`lei-records/{lei}`).
 * All network I/O goes through `ctx.http` (egress gateway in production, ADR-08). No natural-person
 * expansion here: ownership (relationships) is left for a later batch to keep this batch lean.
 *
 * Limits: rps 1, timeoutMs 15s, maxBytes 2MB.
 */
import { defineTransform } from "../manifest.ts";
import type { TransformFinding } from "../output.ts";
import { parseJson } from "./util.ts";

const API = "https://api.gleif.org/api/v1";

function requireLei(raw: string | undefined): string | undefined {
  const lei = raw?.trim();
  if (!lei) return undefined;
  if (!/^[A-Z0-9]{18}\d{2}$/.test(lei)) throw new Error(`TR-021: invalid LEI "${raw}"`);
  return lei;
}

/** Reads one LEI record; the legal name is an explanation, the LEI is the object (D-018). */
async function recordFor(lei: string, ctx: { http: { get(url: string): Promise<{ body: string; requestId: number }> } }) {
  const res = await ctx.http.get(`${API}/lei-records/${encodeURIComponent(lei)}`);
  const data = parseJson(res.body, "GLEIF") as { data?: GleifRecord };
  const legalName = data.data?.attributes?.entity?.legalName?.name;
  if (!legalName) return { findings: [] };
  return {
    findings: [{ ...leiFinding(lei, legalName, 0.95, `GLEIF: LEI ${lei} belongs to`), evidence: [res.requestId] }],
  };
}

interface GleifRecord {
  attributes?: {
    lei?: string;
    entity?: { legalName?: { name?: string }; status?: string; expiration?: { date?: string } };
  };
}

/**
 * A finding for a legal entity. The finding's OBJECT is the legal name as a `company_name`
 * entity (the same catalog type TR-025 mints from OpenSanctions captions — the ledger
 * normalizes it through the catalog validator, D-018 held: no guessed ids). The name is
 * what the registry links the LEI record to, so it is the edge's target; the LEI stays
 * the subject. (The old shape — objectType `lei_code`, objectValue the LEI itself —
 * self-looped on the subject and rendered nowhere: no edge, no attribute.)
 */
function leiFinding(lei: string, name: string, confidence: number, explanation: string): TransformFinding {
  return {
    predicate: "has_legal_name",
    objectType: "company_name",
    objectValue: name,
    confidence,
    explanation: `${explanation}: "${name}" (LEI ${lei})`,
  };
}

export const gleifEntity = defineTransform<{ lei?: string; name?: string }>(
  {
    id: "TR-021",
    version: "1.1.0",
    inputs: ["lei_code"],
    outputs: ["company"],
    network: { mode: "public", allow: [] },
    secrets: [],
    limits: { rps: 1, timeoutMs: 15_000, maxBytes: 2_000_000 },
    sensitivity: "normal",
    license: "LC-B",
    // P4-002: the documented Admiralty source grade (D2/5.13) — the basis the confidence model consumes.
    admiralty: {
      reliability: "A",
      credibility: 1,
      rationale: "GLEIF المشغل الرسمي لمنظومة معرفات LEI العالمية — سجل مرجعي أولي بمنهجية تحقق موثقة",
    },
  },
  async (input, ctx) => {
    const lei = requireLei(input.lei);
    if (lei) return recordFor(lei, ctx);
    throw new Error("TR-021: an LEI is required (name search is a later batch)");
  },
);
