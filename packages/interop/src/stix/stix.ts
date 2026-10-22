import { createHash } from "node:crypto";

import type { Graph } from "@ir/ledger/projections";

/**
 * P4-014 — تصدير/استيراد STIX 2.1 بمعيار «يمر بالمدقق» (T-IO-002).
 *
 * المدقق الرسمي (stix2-validator من OASIS) يعمل محلياً بأداة
 * `tools/stix/validate_reference.py` على الحزمة المجمدة (المولدة بـ
 * `tools/stix/export_reference.ts` من قضية المرجع) وتقريره مجمد في
 * `fixtures/stix/validation-report.json` مع تجزئة الحزمة — CI يثبت التطابق
 * الحرفي بين التصدير الحي والحزمة المباركة (حتمية + لا انجراف).
 *
 * حدود التمثيل (موثقة L-62):
 * - الطوابع الزمنية required في STIX تُؤخذ من معطى `timestamp` الصريح
 *   (لا ساعة مخفية ولا بيانات مبتدعة) — نداء التصدير يحددها.
 * - المعرّف المصدري (معرّف عقدتنا/ادعائنا) يركب خاصية مخصصة `x_ir_id`
 *   (الخصائص المخصصة صريحة في STIX 2.1) ومعرّف STIX مشتق حتمياً
 *   (UUIDv5) — الدورة بلا فقد.
 * - أنواع بلا تعيين STIX (لا Identity/Indicator لها) تُبلَّغ في skipped،
 *   لا تُسقط صامتاً (نفس عرف FtM — L-60).
 * - النمط (pattern) يُشتق من نوع العقدة المعروف: domain/ipv4/sha256/email
 *   (أسماء خصائص STIX المعيارية) — لا اختراع أنماط.
 */

/** A single STIX 2.1 object (SDO or SRO) in its JSON form. */
export interface StixObject {
  type: string;
  id: string;
  spec_version?: string;
  created?: string;
  modified?: string;
  name?: string;
  identity_class?: string;
  pattern?: string;
  pattern_type?: string;
  valid_from?: string;
  relationship_type?: string;
  source_ref?: string;
  target_ref?: string;
  /** Custom property (explicitly allowed by STIX 2.1): our source id. */
  x_ir_id?: string;
}

/** A STIX 2.1 bundle. */
export interface StixBundle {
  type: "bundle";
  id: string;
  objects: StixObject[];
}

/** The export options — the timestamp is EXPLICIT (no hidden clock). */
export interface StixExportOptions {
  /** RFC 3339 timestamp used for created/modified/valid_from (STIX requires them). */
  timestamp: string;
}

/** The export result — entities plus an honest report of the unmapped. */
export interface StixExportResult {
  bundle: StixBundle;
  skipped: { nodes: { id: string; type: string }[]; edges: { id: string; reason: "unmapped-type" }[] };
}

/** Our node type → STIX object type (measured against the STIX 2.1 spec). */
const STIX_TYPE_OF: Record<string, string> = {
  person: "identity",
  company: "identity",
  domain: "indicator",
  ipv4: "indicator",
  sha256_hash: "indicator",
  email: "indicator",
};

/** The identity class per our type (STIX 2.1 identity_class vocabulary). */
const IDENTITY_CLASS_OF: Record<string, string> = {
  person: "individual",
  company: "organization",
};

/** Our node type → the STIX pattern for its LABEL as the observable value. */
const PATTERN_OF: Record<string, (value: string) => string> = {
  domain: (v) => `[domain-name:value = '${v}']`,
  ipv4: (v) => `[ipv4-addr:value = '${v}']`,
  sha256_hash: (v) => `[file:hashes.'SHA-256' = '${v}']`,
  email: (v) => `[email-addr:value = '${v}']`,
};

/** A fixed namespace for deterministic UUIDv5 derivation (documented, not magic:
 *  any fixed UUID works; this one is generated once and frozen here). */
const IR_UUID_NAMESPACE = "b9c8e7a4-3d6f-4a2b-8e5c-1f0a9b8d7c6e";

/** Deterministic STIX UUID (v5) from a source id — same input, same UUID. */
function stixIdFor(type: string, sourceId: string): string {
  const digest = createHash("sha1")
    .update(IR_UUID_NAMESPACE + sourceId, "utf8")
    .digest();
  // RFC 4122 §4.3: set version 5 and variant bits on the SHA-1 digest
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString("hex");
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  return `${type}--${uuid}`;
}

/** Export a case projection to a STIX 2.1 bundle. */
export function stixExport(graph: Graph, opts: StixExportOptions): StixExportResult {
  const objects: StixObject[] = [];
  const skipped: StixExportResult["skipped"] = { nodes: [], edges: [] };
  const exportedIds = new Set<string>();

  for (const node of graph.nodes) {
    const stixType = STIX_TYPE_OF[node.type];
    if (stixType === undefined) {
      skipped.nodes.push({ id: node.id, type: node.type });
      continue;
    }
    const label = node.labels.ar ?? node.labels.en ?? node.canonicalKey;
    const base: StixObject = {
      type: stixType,
      id: stixIdFor(stixType, node.id),
      spec_version: "2.1",
      created: opts.timestamp,
      modified: opts.timestamp,
      x_ir_id: node.id,
    };
    if (stixType === "identity") {
      objects.push({ ...base, name: label, identity_class: IDENTITY_CLASS_OF[node.type] });
    } else {
      const pattern = PATTERN_OF[node.type]?.(label);
      if (pattern === undefined) {
        // a mapped indicator type without a pattern derivation — reported, not silent
        skipped.nodes.push({ id: node.id, type: node.type });
        continue;
      }
      // `name` carries the observable's human label so the round-trip
      // restores it (name is a common STIX property — valid on Indicator).
      objects.push({ ...base, name: label, pattern, pattern_type: "stix", valid_from: opts.timestamp });
    }
    exportedIds.add(node.id);
  }

  for (const edge of graph.edges) {
    if (!exportedIds.has(edge.source) || !exportedIds.has(edge.target)) {
      skipped.edges.push({ id: edge.id, reason: "unmapped-type" });
      continue;
    }
    if (edge.predicate.includes("-")) {
      // The official STIX schema pattern is ^[a-z0-9-]+$ (no underscores) and
      // our vocabulary is snake_case — the _→- transform is bijective ONLY for
      // pure snake_case predicates; a predicate already containing a hyphen
      // would not survive the round-trip, so it is REPORTED, not corrupted.
      skipped.edges.push({ id: edge.id, reason: "unmapped-type" });
      continue;
    }
    const source = objects.find((o) => o.x_ir_id === edge.source);
    const target = objects.find((o) => o.x_ir_id === edge.target);
    objects.push({
      type: "relationship",
      id: stixIdFor("relationship", edge.id),
      spec_version: "2.1",
      created: opts.timestamp,
      modified: opts.timestamp,
      relationship_type: edge.predicate.replaceAll("_", "-"),
      source_ref: source?.id,
      target_ref: target?.id,
      x_ir_id: edge.id,
    });
  }
  return {
    bundle: { type: "bundle", id: stixIdFor("bundle", `bundle:${opts.timestamp}`), objects },
    skipped,
  };
}

/** The rebuilt graph from a STIX import — the exported subset. */
export interface StixGraph {
  nodes: { id: string; type: string; labels: { ar: string } }[];
  edges: { id: string; predicate: string; source: string; target: string }[];
}

const OUR_TYPE_OF: Record<string, string> = Object.fromEntries(Object.keys(STIX_TYPE_OF).map((k) => [k, k]));

/** Import a STIX 2.1 bundle back into the exported-subset graph. Fail-closed on
 *  malformed ids or objects without the source-id custom property. */
export function stixImport(bundle: StixBundle): StixGraph {
  const objects = validateBundleShape(bundle);
  const nodes: StixGraph["nodes"] = [];
  const edges: StixGraph["edges"] = [];
  for (const o of objects) {
    if (o.type === "relationship") {
      edges.push(importRelationship(o, bundle));
      continue;
    }
    const ourType = OUR_TYPE_OF[reverseType(o.type, o)];
    if (ourType === undefined) {
      throw new Error(`stix: object type "${o.type}" is not in the mapped subset (fail-closed)`);
    }
    nodes.push({ id: o.x_ir_id, type: ourType, labels: { ar: o.name ?? o.x_ir_id } });
  }
  return { nodes, edges };
}

/** Structural pre-pass over the whole bundle (fail-closed on malformed input).
 *  Returns the objects narrowed to carry a definite string x_ir_id. */
function validateBundleShape(bundle: StixBundle): (StixObject & { x_ir_id: string })[] {
  const idFormat = /^[a-z-]+--[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const checked: (StixObject & { x_ir_id: string })[] = [];
  for (const o of bundle.objects) {
    if (!idFormat.test(o.id)) {
      throw new Error(`stix: object id "${o.id}" is not a valid STIX identifier (fail-closed)`);
    }
    if (o.x_ir_id === undefined || typeof o.x_ir_id !== "string") {
      throw new Error(`stix: object "${o.id}" has no x_ir_id (fail-closed — no guessing source ids)`);
    }
    checked.push(o as StixObject & { x_ir_id: string });
  }
  return checked;
}

/** Import one relationship SRO — the inverse of the export's bijective _→- transform. */
function importRelationship(o: StixObject & { x_ir_id: string }, bundle: StixBundle): StixGraph["edges"][number] {
  if (o.source_ref === undefined || o.target_ref === undefined || o.relationship_type === undefined) {
    throw new Error(`stix: relationship "${o.id}" is missing source_ref/target_ref/relationship_type (fail-closed)`);
  }
  const source = bundle.objects.find((x) => x.id === o.source_ref)?.x_ir_id;
  const target = bundle.objects.find((x) => x.id === o.target_ref)?.x_ir_id;
  if (source === undefined || target === undefined) {
    throw new Error(`stix: relationship "${o.id}" references an object outside the bundle (fail-closed)`);
  }
  return { id: o.x_ir_id, predicate: o.relationship_type.replaceAll("-", "_"), source, target };
}

/** Reverse-map a STIX object to our node type — identity needs the class,
 *  indicator types are self-identifying by their presence in PATTERN_OF. */
function reverseType(stixType: string, o: StixObject): string {
  if (stixType === "identity") {
    return o.identity_class === "organization" ? "company" : "person";
  }
  if (stixType === "indicator") {
    // The pattern's observable property names the source type (measured map)
    if (o.pattern?.startsWith("[domain-name:")) return "domain";
    if (o.pattern?.startsWith("[ipv4-addr:")) return "ipv4";
    if (o.pattern?.startsWith("[file:hashes.'SHA-256'")) return "sha256_hash";
    if (o.pattern?.startsWith("[email-addr:")) return "email";
  }
  return "__unmapped__";
}

/** Re-exported for tests/tools (documented mapping tables). */
export const STIX_MAPPINGS = {
  stixTypeOf: STIX_TYPE_OF,
  identityClassOf: IDENTITY_CLASS_OF,
} as const;
