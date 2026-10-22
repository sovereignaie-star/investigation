import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { gexfExport } from "./gexf.ts";
import { graphmlExport } from "./graphml.ts";
import { csvExport, csvImport } from "./csv.ts";
import { provExport } from "./prov.ts";
import type { LedgerEntry } from "@ir/schema";

/**
 * P4-015 — GEXF/GraphML/CSV/PROV (T-IO-003..005).
 *
 * المرجعية المجمدة:
 * - `fixtures/formats/reference-case.json` — رسم القضية وسجلها المحاسبي.
 * - `fixtures/formats/gexf-1.3.xsd` و`graphml-1.0.xsd` — المخططان الرسميان
 *   (منظمة Gephi وgraphdrawing.org) — تحقق lxml المحلي بـ
 *   `tools/formats/validate_reference.py` يُجمد حكمه في validation-report.json
 *   (GEXF/GraphML: صالحان XSD؛ PROV: تحلّه حزمة prov الرسمية).
 * - CI يثبت: التصدير الحي مطابق حرفياً للمخرجات المباركة (حتمية + لا انجراف)
 *   وCSV دورة كاملة بلا فقد.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const referenceCase = JSON.parse(readFileSync(join(root, "fixtures", "formats", "reference-case.json"), "utf8")) as {
  graph: Parameters<typeof gexfExport>[0];
  ledger: LedgerEntry[];
};
const validationReport = JSON.parse(readFileSync(join(root, "fixtures", "formats", "validation-report.json"), "utf8")) as {
  gexf: { valid: boolean; sha256: string };
  graphml: { valid: boolean; sha256: string };
  prov: { valid: boolean; sha256: string };
};
const frozenGexf = readFileSync(join(root, "fixtures", "formats", "reference.gexf"), "utf8");
const frozenGraphml = readFileSync(join(root, "fixtures", "formats", "reference.graphml"), "utf8");
const frozenProv = JSON.parse(readFileSync(join(root, "fixtures", "formats", "reference.prov.json"), "utf8"));

const sha256 = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

describe("P4-015 — GEXF (T-IO-003 يفتح في Gephi)", () => {
  it("التصدير الحي مطابق حرفياً للمخرج المبارَك + المخطط الرسمي يقول صالحاً", () => {
    const live = gexfExport(referenceCase.graph);
    expect(live).toBe(frozenGexf);
    expect(validationReport.gexf.valid).toBe(true);
    expect(validationReport.gexf.sha256).toBe(sha256(live));
  });

  it("كل عقدة وحافة بمعرّفها المصدر ومسارها — ولا يُبتدع شيء", () => {
    const xml = gexfExport(referenceCase.graph);
    expect(xml).toContain('<node id="p1" label="أحمد المكي">');
    expect(xml).toContain('for="type" value="person"');
    expect(xml).toContain('<edge id="p1-owns-c1" source="p1" target="c1" label="ownership"/>');
    expect(xml).toContain('<gexf xmlns="http://gexf.net/1.3" version="1.3">');
  });

  it("الحتمية", () => {
    expect(gexfExport(referenceCase.graph)).toBe(gexfExport(referenceCase.graph));
  });
});

describe("P4-015 — GraphML (T-IO-003)", () => {
  it("التصدير الحي مطابق حرفياً للمخرج المبارَك + المخطط الرسمي يقول صالحاً", () => {
    const live = graphmlExport(referenceCase.graph);
    expect(live).toBe(frozenGraphml);
    expect(validationReport.graphml.valid).toBe(true);
    expect(validationReport.graphml.sha256).toBe(sha256(live));
  });

  it("معرّفات مصدرية كاملة في الرسم", () => {
    const xml = graphmlExport(referenceCase.graph);
    expect(xml).toContain('<node id="p1"><data key="type">person</data></node>');
    expect(xml).toContain('<edge id="p1-owns-c1" source="p1" target="c1">');
    expect(xml).toContain('<graphml xmlns="http://graphml.graphdrawing.org/xmlns">');
  });

  it("الحتمية", () => {
    expect(graphmlExport(referenceCase.graph)).toBe(graphmlExport(referenceCase.graph));
  });
});

describe("P4-015 — CSV (T-IO-004 دورة كاملة)", () => {
  it("import(export(g)) يعيد بناء العقد والحواف بمعرّفاتها (بما فيها الفاصلة والاقتباس)", () => {
    const exported = csvExport(referenceCase.graph);
    const rebuilt = csvImport(exported);
    for (const n of referenceCase.graph.nodes) {
      const back = rebuilt.nodes.find((x) => x.id === n.id);
      expect(back?.type).toBe(n.type);
      expect(back?.labels.ar).toBe(n.labels.ar);
    }
    for (const e of referenceCase.graph.edges) {
      const back = rebuilt.edges.find((x) => x.id === e.id);
      expect(back?.predicate).toBe(e.predicate);
      expect(back?.source).toBe(e.source);
      expect(back?.target).toBe(e.target);
    }
    expect(rebuilt.nodes).toHaveLength(4);
    expect(rebuilt.edges).toHaveLength(2);
  });

  it("حقول تحتاج اقتباساً (فاصلة/سطر/اقتباس) تعبر الدورة كما هي", () => {
    const tricky = {
      nodes: [
        {
          id: "x1",
          type: "person",
          labels: { ar: 'أحمد, "الرئيس"' },
          canonicalKey: "k",
          props: {},
          aliases: [],
          attributes: [],
          observations: { positive: 0, negative: 0, error: 0 },
          evidenceIds: [],
        },
      ],
      edges: [],
    };
    const rebuilt = csvImport(csvExport(tricky));
    expect(rebuilt.nodes[0]?.labels.ar).toBe('أحمد, "الرئيس"');
  });

  it("فشل-مغلق: اقتباس غير مغلق يرفض التحليل", () => {
    expect(() => csvImport({ nodesCsv: 'id,type,label\n"x1,person', edgesCsv: "" })).toThrow();
  });
});

describe("P4-015 — PROV (T-IO-005 مصدرية الأدلة)", () => {
  it("التصدير الحي مطابق حرفياً للمخرج المبارَك + حزمة prov الرسمية حلّته", () => {
    const live = provExport(referenceCase.ledger);
    expect(live).toEqual(frozenProv);
    expect(validationReport.prov.valid).toBe(true);
    expect(validationReport.prov.sha256).toBe(sha256(JSON.stringify(live)));
  });

  it("السلسلة المحاسبية كاملة: نشاط لكل قيد، والدليل كيان بتجزئته، والادعاء مشتق منه", () => {
    const prov = provExport(referenceCase.ledger);
    // one activity per ledger entry, named by its kind and stamped
    expect(Object.keys(prov.activity)).toHaveLength(4);
    expect(prov.activity["ir:a-1"]).toMatchObject({ "prov:type": { $: "ir:entity.added" } });
    // the evidence is an entity carrying its sha256
    expect(prov.entity["ir:ev-ev1"]).toMatchObject({ "ir:sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" });
    // the claim was generated by its activity and used the evidence
    const gen = Object.values(prov.wasGeneratedBy).find((g) => g["prov:entity"] === "ir:cl-cl1");
    expect(gen?.["prov:activity"]).toBe("ir:a-3");
    const use = Object.values(prov.used).find((u) => u["prov:entity"] === "ir:ev-ev1" && u["prov:activity"] === "ir:a-3");
    expect(use).toBeDefined();
    // the actors are agents
    expect(prov.agent).toMatchObject({ "ir:investigator-a": {}, "ir:transform-runner": {} });
  });

  it("الحتمية", () => {
    expect(provExport(referenceCase.ledger)).toEqual(provExport(referenceCase.ledger));
  });
});
