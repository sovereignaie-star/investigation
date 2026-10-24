import { readFileSync } from "node:fs";
import type { Graph, GraphEdge, GraphNode } from "@ir/ledger/projections";

/**
 * P4-013 — تصدير/استيراد FollowTheMoney (FtM) بمعيار «دورة بلا فقد» (T-IO-001).
 *
 * النموذج الرسمي المجمد: `fixtures/ftm/model-ref.json` — مستخرج آلياً من
 * ملفات مخططات `followthemoney` 4.11.1 الحقيقية (لا اشتقاق يدوي ولا مكتبة
 * تشغيل في CI). كل تصدير واستيراد يتحقق من المخطط وكل خاصية ضد هذا المرجع
 * (فشل-مغلق: مجهول = خطأ، لا صمت).
 *
 * حدود التمثيل (موثقة L-60):
 * - أنواعنا بلا مخطط FtM (نطاق/هاتف/IP) لا تُصدَّر ككيانات — قيمها
 *   الخصائصية تبقى حيث حُكم عليها في القضية، والحفظ الكامل للحزمة `.irpack`
 *   (P4-018). لا اختراع مخططات زائفة.
 * - الادعاءات بخصائص لا يعرفها النموذج الرسمي تُسقط (مثل job) — لأن Smuggle
 *   خاصية غير معروفة يفشل التحقق أصلاً.
 * - طبقة الأدلة/الثقة/النوافذ الزمنية خارج FtM — الحفظ الكامل في القضية
 *   نفسها (الحزمة الموحدة لاحقاً).
 * - الحواف: علاقة معروفة (ownership/directorship/membership/knows) تُصدَّر
 *   بمخطط حافتها الرسمي، وغيرها UnknownLink برول = الـpredicate الأصلي
 *   (الدورة تبقى بلا فقد: الـpredicate يُستعاد من role).
 */

/** The frozen real-model reference (fixture path from the package root). */
export interface FtmModelRef {
  schemas: Record<
    string,
    {
      extends: string[];
      properties: Record<string, unknown>;
      edge?: { source: string; target: string; directed: boolean };
    }
  >;
}

/** A single FtM entity in its JSON serialization form. */
export interface FtmEntity {
  id: string;
  schema: string;
  properties: Record<string, string[]>;
  datasets?: string[];
}

/** The rebuilt graph from an FtM import — the exported subset of `Graph`. */
export interface FtmGraph {
  nodes: { id: string; type: string; canonicalKey: string; labels: { ar: string }; attributes: { predicate: string; value: string }[] }[];
  edges: { id: string; predicate: string; source: string; target: string }[];
}

/** Our node type → real FtM schema (measured against the frozen model). */
const SCHEMA_OF_TYPE: Record<string, string> = {
  person: "Person",
  company: "Company",
  email: "Email",
  bitcoin: "CryptoWallet",
  ethereum: "CryptoWallet",
};

/** Our edge predicate → real FtM edge schema (measured against the frozen model). */
const EDGE_SCHEMA_OF: Record<string, string> = {
  ownership: "Ownership",
  directorship: "Directorship",
  membership: "Membership",
  knows: "Associate",
};

/** The free role property carrying an unmapped edge predicate (round-trips). */
const UNKNOWN_LINK = "UnknownLink";

/** Attribute predicates that map to real FtM properties per schema. The table
 *  is deliberately small and measured: every entry exists in the frozen model
 *  (the test suite enforces this against the frozen model). */
const PROPERTY_OF_PREDICATE: Record<string, string> = {
  nationality: "nationality",
  birthDate: "birthDate",
  jurisdiction: "jurisdiction",
  registrationNumber: "registrationNumber",
  incorporationDate: "incorporationDate",
  email: "email",
  phone: "phone",
};

/** Node id properties that ride along as FtM properties (measured per schema). */
const NODE_VALUE_PROPERTIES: Record<string, string> = {
  domain: "website",
};

const MODEL_REF_PATH = new URL("../../../../fixtures/ftm/model-ref.json", import.meta.url);

/** Load the frozen model reference (fail-closed: unreadable = throw). */
function loadModelRef(): FtmModelRef {
  return JSON.parse(readFileSync(MODEL_REF_PATH, "utf8")) as FtmModelRef;
}

/** All properties of `schema`, walking `extends` to the root. Fail-closed on
 *  an unknown schema or parent. The cycle guard is PATH-based (each recursion
 *  carries its own branch — a diamond like Company → [Organization, Asset] is
 *  a DAG, not a cycle; a shared set misread it as one). */
function allProperties(ref: FtmModelRef, schema: string, path: readonly string[] = []): Set<string> {
  const spec = ref.schemas[schema];
  if (spec === undefined) throw new Error(`ftm: schema "${schema}" is not in the frozen real model (fail-closed)`);
  if (path.includes(schema)) throw new Error(`ftm: schema cycle at "${schema}"`);
  const props = new Set(Object.keys(spec.properties));
  for (const parent of spec.extends) {
    for (const p of allProperties(ref, parent, [...path, schema])) props.add(p);
  }
  return props;
}

/** The edge role properties for an edge schema (source/target). */
function edgeRoles(ref: FtmModelRef, schema: string): { source: string; target: string } {
  const edge = ref.schemas[schema]?.edge;
  if (edge === undefined) throw new Error(`ftm: schema "${schema}" is not an edge schema in the frozen real model`);
  return { source: edge.source, target: edge.target };
}

/** The export result — the entities PLUS an honest report of everything that
 *  has no FtM representation (never silently dropped: the caller sees it). */
export interface FtmExportResult {
  entities: FtmEntity[];
  skipped: {
    nodes: { id: string; type: string }[];
    attributes: { nodeId: string; predicate: string }[];
    edges: { id: string; reason: "unmapped-type" }[];
  };
}

/** Export a case projection to FtM entities (the exported subset — see header). */
export function ftmExport(graph: Graph): FtmExportResult {
  const ref = loadModelRef();
  const entities: FtmEntity[] = [];
  const skipped: FtmExportResult["skipped"] = { nodes: [], attributes: [], edges: [] };

  for (const node of graph.nodes) {
    const schema = SCHEMA_OF_TYPE[node.type];
    if (schema === undefined) {
      // no real FtM schema for this type — REPORTED, never silently dropped (L-60)
      skipped.nodes.push({ id: node.id, type: node.type });
      continue;
    }
    const props = allProperties(ref, schema);
    const properties: Record<string, string[]> = {};
    const set = (prop: string, value: string): void => {
      if (!props.has(prop)) {
        throw new Error(`ftm: property "${prop}" does not exist on "${schema}" in the frozen real model (fail-closed)`);
      }
      properties[prop] = [...(properties[prop] ?? []), value];
    };
    set("name", node.labels.ar ?? node.labels.en ?? node.canonicalKey);
    for (const a of node.attributes) {
      if (typeof a.value !== "string") continue;
      const prop = PROPERTY_OF_PREDICATE[a.predicate];
      if (prop === undefined) {
        // no FtM property for this predicate — REPORTED (L-60), not smuggled
        skipped.attributes.push({ nodeId: node.id, predicate: a.predicate });
        continue;
      }
      set(prop, a.value);
    }
    const valueProp = NODE_VALUE_PROPERTIES[node.type];
    if (valueProp !== undefined && typeof node.props[node.type] === "string") {
      set(valueProp, node.props[node.type] as string);
    }
    entities.push({ id: node.id, schema, properties });
  }

  const exportedIds = new Set(entities.map((e) => e.id));
  for (const edge of graph.edges) {
    if (!exportedIds.has(edge.source) || !exportedIds.has(edge.target)) {
      // no dangling references in FtM — the edge is REPORTED as unexported
      skipped.edges.push({ id: edge.id, reason: "unmapped-type" });
      continue;
    }
    const schema = EDGE_SCHEMA_OF[edge.predicate];
    if (schema === undefined) {
      // NOTE: unmapped predicates between EXPORTED nodes still round-trip via
      // UnknownLink.role — they are not "skipped"; only dangling targets are.
      // The generic official edge: the original predicate rides in `role`
      // (round-trips — see the import test).
      const roles = edgeRoles(ref, UNKNOWN_LINK);
      const props = allProperties(ref, UNKNOWN_LINK);
      if (!props.has("role")) throw new Error("ftm: UnknownLink.role missing from the frozen real model");
      entities.push({
        id: edge.id,
        schema: UNKNOWN_LINK,
        properties: {
          [roles.source]: [edge.source],
          [roles.target]: [edge.target],
          role: [edge.predicate],
        },
      });
      continue;
    }
    const roles = edgeRoles(ref, schema);
    entities.push({
      id: edge.id,
      schema,
      properties: { [roles.source]: [edge.source], [roles.target]: [edge.target] },
    });
  }
  return { entities, skipped };
}

/** Import FtM entities back into the exported-subset graph shape. Fail-closed
 *  on schemas or properties absent from the frozen real model. */
export function ftmImport(entities: readonly FtmEntity[]): FtmGraph {
  const ref = loadModelRef();
  const typeOfSchema = new Map(Object.entries(SCHEMA_OF_TYPE).map(([type, schema]) => [schema, type]));
  const predicateOfEdge = new Map(Object.entries(EDGE_SCHEMA_OF).map(([predicate, schema]) => [schema, predicate]));
  const nodes: FtmGraph["nodes"] = [];
  const edges: FtmGraph["edges"] = [];

  for (const e of entities) {
    // P6-004 fuzz finding: hostile input (null / non-object / missing schema) must be
    // rejected fail-closed with a declared Error, never a TypeError crash.
    if (e === null || typeof e !== "object" || typeof e.schema !== "string" || e.properties === null || typeof e.properties !== "object") {
      throw new Error(`ftm: entity ${JSON.stringify(e)} is not a valid entity (fail-closed)`);
    }
    const spec = ref.schemas[e.schema];
    if (spec === undefined) {
      throw new Error(`ftm: schema "${e.schema}" is not in the frozen real model (fail-closed)`);
    }
    const allowed = allProperties(ref, e.schema);
    for (const key of Object.keys(e.properties)) {
      if (!allowed.has(key)) {
        throw new Error(`ftm: property "${key}" does not exist on "${e.schema}" in the frozen real model (fail-closed)`);
      }
    }
    const type = typeOfSchema.get(e.schema);
    if (type !== undefined) {
      nodes.push(importNode(e, type));
      continue;
    }
    edges.push(importEdge(e, spec, predicateOfEdge));
  }
  return { nodes, edges };
}

/** Re-exported for tests/tools that need the mapping tables (documented). */
export const FTM_MAPPINGS = {
  schemaOfType: SCHEMA_OF_TYPE,
  edgeSchemaOf: EDGE_SCHEMA_OF,
  propertyOfPredicate: PROPERTY_OF_PREDICATE,
  unknownLink: UNKNOWN_LINK,
} as const;

export type { GraphEdge, GraphNode };

/** Rebuild one node entity into the exported-subset node shape. */
function importNode(e: FtmEntity, type: string): FtmGraph["nodes"][number] {
  return {
    id: e.id,
    type,
    canonicalKey: `${type}:${e.id}`,
    labels: { ar: e.properties.name?.[0] ?? e.id },
    attributes: Object.entries(e.properties)
      .filter(([prop]) => prop in PROPERTY_OF_PREDICATE && prop !== "name")
      .map(([prop, values]) => {
        const predicate = Object.keys(PROPERTY_OF_PREDICATE).find((p) => PROPERTY_OF_PREDICATE[p] === prop);
        return { predicate: predicate ?? prop, value: values[0] };
      }),
  };
}

/** Rebuild one edge entity — fail-closed on roles/predicate recovery. */
function importEdge(e: FtmEntity, spec: FtmModelRef["schemas"][string], predicateOfEdge: Map<string, string>): FtmGraph["edges"][number] {
  const edge = spec.edge;
  if (edge === undefined) {
    throw new Error(`ftm: schema "${e.schema}" is neither a mapped node schema nor an edge schema (fail-closed)`);
  }
  const source = e.properties[edge.source]?.[0];
  const target = e.properties[edge.target]?.[0];
  if (source === undefined || target === undefined) {
    throw new Error(`ftm: edge "${e.id}" is missing its role properties (fail-closed)`);
  }
  const predicate = predicateOfEdge.get(e.schema) ?? e.properties.role?.[0];
  if (predicate === undefined) {
    throw new Error(`ftm: edge "${e.id}" has no recoverable predicate (fail-closed)`);
  }
  return { id: e.id, predicate, source, target };
}
