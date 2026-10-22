import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { ftmExport, ftmImport, type FtmEntity } from "./ftm.ts";

/**
 * P4-013 — تصدير/استيراد FollowTheMoney (FtM) بمعيار «دورة بلا فقد» (T-IO-001).
 *
 * المرجع المجمد:
 * - `fixtures/ftm/reference-case.json` — قضية مرجع (عقد وحواف بادعاءات، منها
 *   ما له تمثيل FtM ومنها ما لا تمثيل له — لاختبار الصدق لا المصادقة).
 * - `fixtures/ftm/model-ref.json` — النموذج الرسمي الحقيقي (مخططات
 *   followthemoney 4.11.1 مستخرجة من ملفات النموذج نفسها بأداة مولدة، لا
 *   يدوياً). كل مخطط وكل خاصية مصدرة/مستوردة تتحقق ضده (فشل-مغلق: مجهول =
 *   خطأ، لا صمت).
 * - دورة بلا فقد: export → import يعيد بناء نفس الكيانات والحواف والخصائص
 *   المعرّفة المصدرية. ما لا تمثيل له يُبلَّغ صراحة في `skipped` (لا إسقاط
 *   صامت — الحد L-60: نطاق/هاتف/IP ليست كيانات FtM أصلاً بل أنواع خصائص).
 *
 * صادق الأدلة: كُتب قبل أي تنفيذ؛ الأحمر الأول هيكلي (الوحدة غير موجودة)
 * وموثق في docs/evidence/2026-10-22-P4-013-red.md.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const referenceCase = JSON.parse(readFileSync(join(root, "fixtures", "ftm", "reference-case.json"), "utf8")) as {
  graph: Parameters<typeof ftmExport>[0];
  exportedNodeIds: string[];
  exportedEdges: { id: string; schema: string; predicate: string; source: string; target: string }[];
};
const modelRef = JSON.parse(readFileSync(join(root, "fixtures", "ftm", "model-ref.json"), "utf8")) as {
  schemas: Record<
    string,
    { extends: string[]; properties: Record<string, unknown>; edge?: { source: string; target: string; directed: boolean } }
  >;
};

function exported() {
  const { entities } = ftmExport(referenceCase.graph);
  return entities;
}

describe("P4-013 — FtM export", () => {
  it("الكيانات المصدَّرة تطابق الكيانات المعروفة لقضية المرجع", () => {
    const entities = exported();
    expect(entities).toHaveLength(10);
    expect(
      entities
        .filter((e) => e.schema === "Person")
        .map((e) => e.id)
        .sort(),
    ).toEqual(["p1", "p2"]);
    expect(entities.filter((e) => e.schema === "Company").map((e) => e.id)).toEqual(["c1"]);
    expect(entities.filter((e) => e.schema === "Email").map((e) => e.id)).toEqual(["e1"]);
    expect(entities.filter((e) => e.schema === "CryptoWallet").map((e) => e.id)).toEqual(["w1"]);
    const edgeEntities = entities.filter((e) => !["Person", "Company", "Email", "CryptoWallet"].includes(e.schema));
    expect(edgeEntities).toHaveLength(5);
    expect(edgeEntities.map((e) => e.schema).sort()).toEqual(["Associate", "Directorship", "Membership", "Ownership", "UnknownLink"]);
  });

  it("الكيان يحمل خصائصه الحقيقية فقط (name + المفهرسة في النموذج الرسمي)", () => {
    const entities = exported();
    const p1 = entities.find((e) => e.id === "p1");
    expect(p1?.schema).toBe("Person");
    expect(p1?.properties.name).toEqual(["أحمد المكي"]);
    expect(p1?.properties.nationality).toEqual(["sa"]);
    expect(p1?.properties.birthDate).toEqual(["1985-04-12"]);
    // email on a Person resolves through LegalEntity (the diamond in the model)
    expect(p1?.properties.email).toEqual(["a@example.com"]);
    // the unmapped predicate (job) is not smuggled through
    expect(Object.keys(p1?.properties ?? {})).not.toContain("job");
    const c1 = entities.find((e) => e.id === "c1");
    expect(c1?.properties.jurisdiction).toEqual(["sa"]);
    expect(c1?.properties.registrationNumber).toEqual(["1010123456"]);
    expect(c1?.properties.incorporationDate).toEqual(["2015-03-01"]);
  });

  it("حافة الادعاء تصبح كيان FtM بحوافه (source/target) وحواف المرجع مطابقة", () => {
    const entities = exported();
    for (const expected of referenceCase.exportedEdges) {
      const e = entities.find((x) => x.id === expected.id);
      expect(e?.schema).toBe(expected.schema);
      const edgeSpec = modelRef.schemas[expected.schema].edge;
      expect(edgeSpec).toBeDefined();
      if (edgeSpec === undefined) throw new Error("frozen model lost an edge schema");
      expect(e?.properties[edgeSpec.source]).toEqual([expected.source]);
      expect(e?.properties[edgeSpec.target]).toEqual([expected.target]);
      if (expected.schema === "UnknownLink") {
        expect(e?.properties.role).toEqual([expected.predicate]);
      }
    }
  });

  it("ما لا تمثيل له يُبلَّغ صراحة لا يُسقط صامتاً (الحد L-60)", () => {
    const { entities, skipped } = ftmExport(referenceCase.graph);
    // nodes with no FtM schema (domain, ipv4): reported, no entity
    expect(skipped.nodes.map((n) => n.id).sort()).toEqual(["d1", "ip1"]);
    expect(entities.find((e) => e.id === "d1")).toBeUndefined();
    expect(entities.find((e) => e.id === "ip1")).toBeUndefined();
    // the unmapped attribute predicate (job): reported on its node
    expect(skipped.attributes).toEqual([{ nodeId: "p1", predicate: "job" }]);
    // the edge to an unexported node (references → d1): reported, no dangling ref
    expect(skipped.edges).toEqual([{ id: "p1-refs-d1", reason: "unmapped-type" }]);
    expect(entities.find((e) => e.id === "p1-refs-d1")).toBeUndefined();
    // the FULL preservation path for what FtM cannot represent is the case
    // itself (`.irpack`, P4-018) — the export is interchange, not backup.
  });
});

describe("P4-013 — FtM import (round-trip بلا فقد)", () => {
  it("import(export(g)) يعيد بناء نفس العقد والحواف والخصائص بمعرّفاتها", () => {
    const rebuilt = ftmImport(exported());
    for (const id of referenceCase.exportedNodeIds) {
      const original = referenceCase.graph.nodes.find((n) => n.id === id);
      const back = rebuilt.nodes.find((n) => n.id === id);
      expect(back).toBeDefined();
      expect(back?.labels.ar).toBe(original?.labels.ar);
      for (const a of original?.attributes ?? []) {
        if (a.predicate === "job") continue; // reported drop (L-60)
        const value = back?.attributes.find((x) => x.predicate === a.predicate)?.value;
        expect(value).toEqual(a.value);
      }
    }
    for (const expected of referenceCase.exportedEdges) {
      const back = rebuilt.edges.find((e) => e.id === expected.id);
      expect(back?.predicate).toBe(expected.predicate);
      expect(back?.source).toBe(expected.source);
      expect(back?.target).toBe(expected.target);
    }
    // nothing extra appeared (no invented nodes/edges)
    expect(rebuilt.nodes.map((n) => n.id).sort()).toEqual([...referenceCase.exportedNodeIds].sort());
    expect(rebuilt.edges).toHaveLength(5);
  });

  it("الاستيراد يقرأ UnknownLink.role كعلاقة أصلية (الدورة الكاملة للحواف العامة)", () => {
    const rebuilt = ftmImport(exported());
    const mentions = rebuilt.edges.find((e) => e.predicate === "mentions");
    expect(mentions).toMatchObject({ id: "p1-mentions-p2", source: "p1", target: "p2" });
  });

  it("فشل-مغلق: كيان بمخطط غير موجود في النموذج الرسمي يرفض الاستيراد", () => {
    const bogus: FtmEntity = { id: "x", schema: "NotARealSchema", properties: {} };
    expect(() => ftmImport([bogus])).toThrow();
  });

  it("فشل-مغلق: خاصية غير معروفة في النموذج الرسمي ترفض الاستيراد (لا صمت)", () => {
    const drift: FtmEntity = { id: "x", schema: "Person", properties: { notARealProperty: ["y"] } };
    expect(() => ftmImport([drift])).toThrow();
  });
});

describe("P4-013 — التحقق البنيوي ضد النموذج الرسمي المجمد", () => {
  it("كل كيان مصدَّر: مخططه وكل خاصية من خصائصه موجودة في النموذج الرسمي", () => {
    const entities = exported();
    const resolveProps = (schema: string): Set<string> => {
      const props = new Set(Object.keys(modelRef.schemas[schema]?.properties ?? {}));
      for (const parent of modelRef.schemas[schema]?.extends ?? []) {
        for (const p of resolveProps(parent)) props.add(p);
      }
      return props;
    };
    for (const e of entities) {
      expect(modelRef.schemas[e.schema]).toBeDefined();
      const allowed = resolveProps(e.schema);
      for (const key of Object.keys(e.properties)) {
        expect(allowed.has(key), `${e.schema}.${key} must exist in the frozen real model`).toBe(true);
      }
    }
  });

  it("الحتمية: تصديران متطابقان بنيوياً", () => {
    expect(exported()).toEqual(exported());
  });

  it("رسم فارغ = لا كيانات ولا بلاغات", () => {
    const result = ftmExport({ nodes: [], edges: [] });
    expect(result.entities).toEqual([]);
    expect(result.skipped).toEqual({ nodes: [], attributes: [], edges: [] });
  });
});
