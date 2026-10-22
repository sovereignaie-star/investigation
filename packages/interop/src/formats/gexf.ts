import type { Graph } from "@ir/ledger/projections";

/**
 * P4-015 — \u062a\u0635\u062f\u064a\u0631 GEXF 1.3 (T-IO-003 — \u064a\u0641\u062a\u062d \u0641\u064a Gephi).
 *
 * \u0627\u0644\u0645\u062e\u0637\u0637 \u0627\u0644\u0631\u0633\u0645\u064a \u0627\u0644\u0645\u062c\u0645\u062f: fixtures/formats/gexf-1.3.xsd (\u0645\u0646 \u0645\u0633\u062a\u0648\u062f\u0639 \u0645\u0646\u0638\u0645\u0629 Gephi
 * \u0627\u0644\u0631\u0633\u0645\u064a\u0629) — \u0627\u0644\u062a\u062d\u0642\u0642 \u0627\u0644\u0645\u062d\u0644\u064a \u0628\u0623\u062f\u0627\u0629 tools/formats/validate_reference.py (lxml/XSD)
 * \u064a\u064f\u062c\u0645\u062f \u062d\u0643\u0645\u0647 \u0641\u064a validation-report.json\u061b CI \u064a\u062b\u0628\u062a \u0627\u0644\u062a\u0637\u0627\u0628\u0642 \u0627\u0644\u062d\u0631\u0641\u064a \u0645\u0639 \u0627\u0644\u0645\u062e\u0631\u062c \u0627\u0644\u0645\u064f\u0628\u0627\u0631\u064e\u0643.
 *
 * \u0627\u0644\u0635\u062f\u0642: \u062a\u0635\u062f\u064a\u0631 \u0644\u0644\u0631\u0633\u0645 \u0641\u0642\u0637 — \u0643\u0644 \u0639\u0642\u062f\u0629/\u062d\u0627\u0641\u0629 \u0628\u0645\u0639\u0631\u0651\u0641\u0647\u0627 \u0627\u0644\u0645\u0635\u062f\u0631\u064a \u0648\u0645\u0633\u0627\u0631\u0647\u0627\u060c \u0648\u0644\u0627 \u064a\u064f\u0628\u062a\u062f\u0639 \u0634\u064a\u0621.
 */

/** XML-escape a text node/attribute value. */
function xmlEscape(s: string): string {
  return s.replaceAll("&", "\u0026amp;").replaceAll("<", "\u0026lt;").replaceAll(">", "\u0026gt;").replaceAll('"', "\u0026quot;");
}

/** Export the case graph to GEXF 1.3 XML (deterministic — same input, same bytes). */
export function gexfExport(graph: Graph): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gexf xmlns="http://gexf.net/1.3" version="1.3">',
    '  <graph defaultedgetype="directed">',
    '    <attributes class="node">',
    '      <attribute id="type" title="type" type="string"/>',
    "    </attributes>",
    "    <nodes>",
  ];
  for (const n of graph.nodes) {
    lines.push(
      `      <node id="${xmlEscape(n.id)}" label="${xmlEscape(n.labels.ar ?? n.canonicalKey)}">`,
      `        <attvalues><attvalue for="type" value="${xmlEscape(n.type)}"/></attvalues>`,
      "      </node>",
    );
  }
  lines.push("    </nodes>", "    <edges>");
  for (const e of graph.edges) {
    lines.push(
      `      <edge id="${xmlEscape(e.id)}" source="${xmlEscape(e.source)}" target="${xmlEscape(e.target)}" label="${xmlEscape(e.predicate)}"/>`,
    );
  }
  lines.push("    </edges>", "  </graph>", "</gexf>");
  return lines.join("\n") + "\n";
}
