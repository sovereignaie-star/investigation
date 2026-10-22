import type { Graph } from "@ir/ledger/projections";

/**
 * P4-015 — تصدير/استيراد CSV (T-IO-004) — دورة كاملة بلا فقد على المجموعة
 * المصدَّرة (RFC 4180: اقتباس الحقول، فواصل، أسطر CRLF).
 *
 * مخرجان منفصلان (عقد وحواف) لأن CSV لا يمثل رسماً واحداً متعدد الأنواع —
 * وهذا صادق: صيغة جداول لا رسماً.
 */

/** RFC 4180 field escaping. */
function csvField(s: string): string {
  if (/[",\r\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

/** Serialize rows (header first) to RFC 4180 text with CRLF line endings. */
function toCsv(rows: string[][]): string {
  return rows.map((r) => r.map(csvField).join(",")).join("\r\n") + "\r\n";
}

/** Parse RFC 4180 text back to rows (a small bounded parser — our own output
 *  is the primary input, but any well-formed CSV parses; fail-closed on
 *  unbalanced quotes). */
function fromCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (quoted) throw new Error("csv: unbalanced quote (fail-closed)");
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** The CSV export — two RFC 4180 documents (nodes and edges). */
export function csvExport(graph: Graph): { nodesCsv: string; edgesCsv: string } {
  const nodesRows: string[][] = [["id", "type", "label"]];
  for (const n of graph.nodes) nodesRows.push([n.id, n.type, n.labels.ar ?? n.canonicalKey]);
  const edgesRows: string[][] = [["id", "source", "target", "predicate"]];
  for (const e of graph.edges) edgesRows.push([e.id, e.source, e.target, e.predicate]);
  return { nodesCsv: toCsv(nodesRows), edgesCsv: toCsv(edgesRows) };
}

/** The rebuilt graph from a CSV import — the exported subset. */
export function csvImport(exported: { nodesCsv: string; edgesCsv: string }): {
  nodes: { id: string; type: string; labels: { ar: string } }[];
  edges: { id: string; source: string; target: string; predicate: string }[];
} {
  const nodesRows = fromCsv(exported.nodesCsv);
  const edgesRows = fromCsv(exported.edgesCsv);
  const nodes = nodesRows.slice(1).map((r) => ({ id: r[0], type: r[1], labels: { ar: r[2] } }));
  const edges = edgesRows.slice(1).map((r) => ({ id: r[0], source: r[1], target: r[2], predicate: r[3] }));
  return { nodes, edges };
}
