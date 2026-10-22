import type { Graph } from "@ir/ledger/projections";

/**
 * P4-015 — \u062a\u0635\u062f\u064a\u0631 GraphML 1.0 (T-IO-003).
 *
 * \u0627\u0644\u0645\u062e\u0637\u0637 \u0627\u0644\u0631\u0633\u0645\u064a \u0627\u0644\u0645\u062c\u0645\u062f: fixtures/formats/graphml-1.0.xsd (\u0645\u062e\u0637\u0637 graphdrawing.org
 * \u0627\u0644\u0631\u0633\u0645\u064a) — \u0627\u0644\u062a\u062d\u0642\u0642 \u0627\u0644\u0645\u062d\u0644\u064a \u0628\u0623\u062f\u0627\u0629 tools/formats/validate_reference.py \u064a\u064f\u062c\u0645\u062f \u062d\u0643\u0645\u0647\u061b
 * CI \u064a\u062b\u0628\u062a \u0627\u0644\u062a\u0637\u0627\u0628\u0642 \u0627\u0644\u062d\u0631\u0641\u064a. \u062a\u0635\u062f\u064a\u0631 \u0644\u0644\u0631\u0633\u0645 \u0641\u0642\u0637 — \u0645\u0639\u0631\u0651\u0641\u0627\u062a \u0645\u0635\u062f\u0631\u064a\u0629 \u0643\u0627\u0645\u0644\u0629.
 */

/** XML-escape (each format module is self-contained by design). */
function xmlEscape(s: string): string {
  return s.replaceAll("&", "\u0026amp;").replaceAll("<", "\u0026lt;").replaceAll(">", "\u0026gt;").replaceAll('"', "\u0026quot;");
}

/** Export the case graph to GraphML 1.0 XML (deterministic). */
export function graphmlExport(graph: Graph): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="type" for="node" attr.name="type" attr.type="string"/>',
    '  <key id="predicate" for="edge" attr.name="predicate" attr.type="string"/>',
    '  <graph id="case" edgedefault="directed">',
  ];
  for (const n of graph.nodes) {
    lines.push(`    <node id="${xmlEscape(n.id)}"><data key="type">${xmlEscape(n.type)}</data></node>`);
  }
  for (const e of graph.edges) {
    lines.push(
      `    <edge id="${xmlEscape(e.id)}" source="${xmlEscape(e.source)}" target="${xmlEscape(e.target)}"><data key="predicate">${xmlEscape(e.predicate)}</data></edge>`,
    );
  }
  lines.push("  </graph>", "</graphml>");
  return lines.join("\n") + "\n";
}
