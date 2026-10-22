/**
 * P4-022 — تصدير مؤشرات التهديد (threat indicator export): MISP JSON,
 * OpenIOC 1.1 and plain text/CSV IOC lists, with an optional defang
 * (التمويه) for the SHARING lists. The machine formats (MISP/OpenIOC) keep
 * TRUE values — the MISP round-trip is lossless by acceptance and automated
 * ingestion must never see disguised data; defanging is a sharing-output
 * concern, documented here as the design decision it is.
 *
 * The indicator set is the case's observable-type entities (domain, ipv4,
 * sha256_hash, email); non-indicator entities (person, company, …) are
 * REPORTED as skipped — never silently dropped. The reference case of record
 * is the P4-014 fixture (`fixtures/stix/reference-case.json`) — the same
 * lineage the MISP round-trip is proven against.
 *
 * Everything is deterministic: the same case and options always produce
 * byte-identical exports (UUIDv5 from a frozen namespace, sorted order).
 */
import { createHash } from "node:crypto";
import type { Graph, GraphNode } from "@ir/ledger/projections";

/** One threat indicator: the case's internal type + the observable value. */
export interface IocIndicator {
  type: "domain" | "ipv4" | "sha256_hash" | "email";
  value: string;
}

/** The node types that ARE indicators (mirrors the STIX indicator mapping). */
const INDICATOR_TYPES: Record<string, IocIndicator["type"]> = {
  domain: "domain",
  ipv4: "ipv4",
  sha256_hash: "sha256_hash",
  email: "email",
};

const valueOf = (node: GraphNode): string => node.labels.ar ?? node.labels.en ?? node.canonicalKey;

export interface CollectIndicatorsResult {
  indicators: IocIndicator[];
  /** Nodes that are not indicators — reported, never silently dropped. */
  skipped: { id: string; type: string }[];
}

/** Collect the case's indicators, deterministically sorted (type, then value). */
export function collectIndicators(graph: Graph): CollectIndicatorsResult {
  const indicators: IocIndicator[] = [];
  const skipped: { id: string; type: string }[] = [];
  for (const node of graph.nodes) {
    const type = INDICATOR_TYPES[node.type];
    if (type === undefined) {
      skipped.push({ id: node.id, type: node.type });
      continue;
    }
    indicators.push({ type, value: valueOf(node) });
  }
  indicators.sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : a.value < b.value ? -1 : 1));
  return { indicators, skipped };
}

/* ------------------------------------------------------------------ defang */

/** The standard sharing disguise: scheme, dots and at-signs — nothing else. */
export function defang(value: string): string {
  return value
    .replace(/^http:\/\//, "hxxp://")
    .replace(/^https:\/\//, "hxxps://")
    .replace(/\./g, "[.]")
    .replace(/@/g, "[at]");
}

/* -------------------------------------------------------------------- MISP */

/** Our type → the MISP attribute type (MISP's own vocabulary). */
const MISP_TYPE_OF: Record<IocIndicator["type"], string> = {
  domain: "domain",
  ipv4: "ip-src",
  sha256_hash: "sha256",
  email: "email-src",
};

const MISP_TYPE_TO_OURS: Record<string, IocIndicator["type"]> = Object.fromEntries(
  (Object.keys(MISP_TYPE_OF) as IocIndicator["type"][]).map((k) => [MISP_TYPE_OF[k], k]),
);

export interface MispAttribute {
  uuid: string;
  type: string;
  category: string;
  to_ids: boolean;
  value: string;
  timestamp: string;
}

export interface MispEvent {
  Event: {
    id: string;
    info: string;
    date: string;
    threat_level_id: string;
    published: boolean;
    Attribute: MispAttribute[];
  };
}

/** A frozen namespace for deterministic MISP UUIDs (documented, not magic). */
const IR_MISP_NAMESPACE = "d4e5f6a7-8b9c-4d0e-9f1a-2b3c4d5e6f7a";

function mispUuidFor(nodeId: string): string {
  const digest = createHash("sha1")
    .update(IR_MISP_NAMESPACE + nodeId, "utf8")
    .digest();
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

const MISP_CATEGORY_OF: Record<IocIndicator["type"], string> = {
  domain: "Network activity",
  ipv4: "Network activity",
  sha256_hash: "Payload delivery",
  email: "Payload delivery",
};

/** Export the case as a MISP event (deterministic; true values — see header). */
export function mispExport(graph: Graph, opts: { timestamp: string }): MispEvent {
  const { indicators } = collectIndicators(graph);
  const byId = new Map(graph.nodes.map((n) => [valueOf(n), n.id] as const));
  return {
    Event: {
      id: "ir-" + createHash("sha256").update(sortedKeyOf(indicators)).digest("hex").slice(0, 8),
      info: "تصدير مؤشرات تهديد من قضية تحقيق (ir)",
      date: opts.timestamp.slice(0, 10),
      threat_level_id: "3",
      published: false,
      Attribute: indicators.map((i) => ({
        uuid: mispUuidFor(byId.get(i.value) ?? i.value),
        type: MISP_TYPE_OF[i.type],
        category: MISP_CATEGORY_OF[i.type],
        to_ids: true,
        value: i.value,
        timestamp: opts.timestamp,
      })),
    },
  };
}

function sortedKeyOf(indicators: readonly IocIndicator[]): string {
  return indicators
    .map((i) => `${i.type}:${i.value}`)
    .sort()
    .join("\n");
}

export interface MispImportResult {
  indicators: IocIndicator[];
}

/**
 * Import a MISP event's indicators back (the lossless round-trip side).
 * Fail-closed: a malformed event refuses loudly, never a guessed parse.
 */
export function mispImport(event: unknown): MispImportResult {
  if (event === null || typeof event !== "object") throw new Error("MISP import: not an event object");
  const inner = (event as { Event?: unknown }).Event;
  if (inner === null || typeof inner !== "object") throw new Error("MISP import: no Event object");
  const attributes = (inner as { Attribute?: unknown }).Attribute;
  if (!Array.isArray(attributes)) throw new Error("MISP import: Event.Attribute is not a list");
  const indicators: IocIndicator[] = [];
  for (const a of attributes) {
    if (a === null || typeof a !== "object") throw new Error("MISP import: attribute is not an object");
    const { type, value } = a as { type?: unknown; value?: unknown };
    const ours = MISP_TYPE_TO_OURS[String(type)];
    if (ours === undefined || typeof value !== "string" || value.length === 0) {
      throw new Error(`MISP import: unsupported attribute ${String(type)}`);
    }
    indicators.push({ type: ours, value });
  }
  indicators.sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : a.value < b.value ? -1 : 1));
  return { indicators };
}

/* ----------------------------------------------------------------- OpenIOC */

const xmlEscape = (s: string): string =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

/**
 * Export the case as an OpenIOC 1.1 document (the FireEye/Mandiant XML schema).
 * Every indicator is one IndicatorItem under a single AND-ed Indicator.
 */
export function openIocExport(graph: Graph): string {
  const { indicators } = collectIndicators(graph);
  const items = indicators
    .map(
      (i) =>
        `      <IndicatorItem id="" condition="is">\n` +
        `        <Context document="InvestigationCase" search="${xmlEscape(i.type)}" type="mir" />\n` +
        `        <Content type="string">${xmlEscape(i.value)}</Content>\n` +
        `      </IndicatorItem>`,
    )
    .join("\n");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<iocs xmlns="http://schemas.mandiant.com/2010/ioc">\n` +
    `  <ioc id="" name="ir-threat-indicators">\n` +
    `    <description>تصدير مؤشرات تهديد من قضية تحقيق (ir)</description>\n` +
    `    <definition>\n` +
    `      <Indicator operator="AND">\n${items}\n      </Indicator>\n` +
    `    </definition>\n` +
    `  </ioc>\n` +
    `</iocs>\n`
  );
}

/* ------------------------------------------------------------- text / csv */

/**
 * Export the indicators as a sharing list: plain text (one value per line) or
 * CSV (type,value). Defanging (التمويه) applies HERE — the sharing outputs;
 * when on, the values are disguised (hxxp/[.]/[at]) and never the machine formats.
 */
export function iocListExport(graph: Graph, opts: { format: "text" | "csv"; defang: boolean }): string {
  const { indicators } = collectIndicators(graph);
  const values = indicators.map((i) => (opts.defang ? { ...i, value: defang(i.value) } : i));
  if (opts.format === "text") {
    return values.map((i) => i.value).join("\n");
  }
  return ["type,value", ...values.map((i) => `${i.type},${i.value}`)].join("\n");
}
