import type { LedgerEntry } from "@ir/schema";

/**
 * P4-015 — تصدير PROV (مصدرية الأدلة — T-IO-005).
 *
 * صيغة PROV-JSON الرسمية (W3C PROV-DM) لسجل القضية: كل قيد في السلسلة
 * المحاسبية نشاط (Activity) بفاعله وزمنه، والدليل كيان (Entity) بتجزئته،
 * والادعاء المولد من الدليل wasGeneratedBy/used — مصدرية كاملة قابلة
 * للفحص مستقلة عن النظام.
 *
 * التحقق الرسمي: حزمة prov الرسمية (provtoolbox-python) تحل المخرج محلياً
 * بأداة `tools/formats/validate_reference.py` وتُجمد بركتها في
 * `fixtures/formats/validation-report.json`. CI يثبت التطابق الحرفي مع
 * المخرج المبارَك.
 */

/** A PROV-JSON document (the W3C serialization). */
export interface ProvJson {
  prefix: Record<string, string>;
  entity: Record<string, Record<string, unknown>>;
  activity: Record<string, Record<string, unknown>>;
  agent: Record<string, Record<string, unknown>>;
  wasGeneratedBy: Record<string, Record<string, unknown>>;
  used: Record<string, Record<string, unknown>>;
}

/** Export the case ledger to PROV-JSON (deterministic). */
/**
 * NOTE: all identifiers are prefixed (`ir:`) — the official prov package (3.x)
 * rejects unprefixed identifiers when no default namespace is declared
 * (measured: ProvElementIdentifierRequired), and the prefix is declared in
 * the document itself so the output is self-contained.
 */
export function provExport(entries: readonly LedgerEntry[]): ProvJson {
  const doc: ProvJson = {
    prefix: { ir: "https://sovereignaie-star.github.io/investigation/ns#" },
    entity: {},
    activity: {},
    agent: {},
    wasGeneratedBy: {},
    used: {},
  };
  const agents = new Set<string>();
  let gen = 0;
  let use = 0;
  for (const e of entries) {
    agents.add(e.actor);
    const activityId = `ir:a-${e.seq}`;
    doc.activity[activityId] = {
      "prov:type": { $: `ir:${e.kind}`, type: "xsd:string" },
      "prov:startTime": { $: e.at, type: "xsd:dateTime" },
    };
    const payload = e.payload as Record<string, unknown>;
    if (e.kind === "evidence.stored") {
      doc.entity[`ir:ev-${String(payload.id)}`] = {
        "ir:sha256": String(payload.sha256),
        "ir:mime": String(payload.mime),
        "ir:transform": String(payload.transformId),
      };
      doc.used[`ir:u-${use}`] = { "prov:activity": activityId, "prov:entity": `ir:ev-${String(payload.id)}` };
      use += 1;
    }
    if (e.kind === "claim.added") {
      const claimId = String(payload.id);
      doc.entity[`ir:cl-${claimId}`] = { "ir:predicate": String(payload.predicate) };
      doc.wasGeneratedBy[`ir:g-${gen}`] = { "prov:entity": `ir:cl-${claimId}`, "prov:activity": activityId };
      gen += 1;
      for (const evId of (payload.evidenceIds as string[] | undefined) ?? []) {
        doc.used[`ir:u-${use}`] = { "prov:activity": activityId, "prov:entity": `ir:ev-${evId}` };
        use += 1;
      }
    }
    if (e.kind === "entity.added") {
      doc.entity[`ir:n-${String(payload.id)}`] = { "ir:type": String(payload.type) };
      doc.wasGeneratedBy[`ir:g-${gen}`] = { "prov:entity": `ir:n-${String(payload.id)}`, "prov:activity": activityId };
      gen += 1;
    }
  }
  for (const a of agents) doc.agent[`ir:${a}`] = {};
  return doc;
}
