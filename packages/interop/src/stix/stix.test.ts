import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { stixExport, stixImport, type StixBundle, type StixObject } from "./stix.ts";

/**
 * P4-014 — تصدير/استيراد STIX 2.1 بمعيار «يمر بالمدقق» (T-IO-002).
 *
 * المدقق الرسمي (stix2-validator 3.3.1 من OASIS) يعمل محلياً بأداة
 * `tools/stix/validate_reference.py` التي تجمد نتيجته في
 * `fixtures/stix/validation-report.json` — حكم المدقق الرسمي على الحزمة
 * المجمدة `fixtures/stix/reference-bundle.json` (المولدة بأداة
 * `tools/stix/export_reference.ts` من قضية المرجع — الحزمتان بلا يد).
 *
 * CI يثبت ما يمكن إثباته آلياً بلا بايثون: (1) الحزمة المصدَّرة من قضية
 * المرجع مطابقة حرفياً للحزمة المجمدة التي باركها المدقق الرسمي (حتمية +
 * لا انجراف)، (2) الدورة بلا فقد (import يعيد بناء العقد والحواف بمعرّفاتها
 * عبر x_ir_id)، (3) البنية الصحيحة (ids بصيغة type--UUID، خصائص مطلوبة،
 * bundle سليم).
 *
 * صادق الأدلة: كتب قبل أي تنفيذ؛ الأحمر الأول هيكلي (الوحدة غير موجودة)
 * وموثق في docs/evidence/2026-10-22-P4-014-red.md.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const referenceCase = JSON.parse(readFileSync(join(root, "fixtures", "stix", "reference-case.json"), "utf8")) as {
  graph: Parameters<typeof stixExport>[0];
  exportedNodeIds: string[];
  exportedEdges: { id: string; predicate: string; source: string; target: string }[];
};
const frozenBundle = JSON.parse(readFileSync(join(root, "fixtures", "stix", "reference-bundle.json"), "utf8")) as StixBundle;
const validationReport = JSON.parse(readFileSync(join(root, "fixtures", "stix", "validation-report.json"), "utf8")) as {
  valid: boolean;
  validator: string;
  bundleSha256: string;
  summary: string[];
};

/** The deterministic export timestamp used by the frozen reference bundle. */
const EXPORT_TIMESTAMP = "2026-10-22T00:00:00.000Z";

function exported(): StixBundle {
  const { bundle } = stixExport(referenceCase.graph, { timestamp: EXPORT_TIMESTAMP });
  return bundle;
}

describe("P4-014 — STIX 2.1 export", () => {
  it("الحزمة المصدَّرة من قضية المرجع مطابقة حرفياً للحزمة المجمدة التي باركها المدقق الرسمي", () => {
    expect(exported()).toEqual(frozenBundle);
  });

  it("تقرير المدقق الرسمي المجمد: صالح، وموثق بأداة ونسخة وتجزئة الحزمة", () => {
    expect(validationReport.valid).toBe(true);
    expect(validationReport.validator).toContain("stix2-validator");
    const sha = createHash("sha256").update(JSON.stringify(frozenBundle), "utf8").digest("hex");
    expect(validationReport.bundleSha256).toBe(sha);
  });

  it("البنية: bundle سليم بمعرّفات type--UUID وخصائص STIX 2.1 المطلوبة", () => {
    const bundle = exported();
    expect(bundle.type).toBe("bundle");
    expect(bundle.id).toMatch(/^bundle--[0-9a-f-]{36}$/);
    expect(bundle.objects).toHaveLength(9); // 6 SDOs + 3 relationships
    for (const o of bundle.objects) {
      expect(o.id).toMatch(new RegExp(`^${o.type}--[0-9a-f-]{36}$`));
      if (o.type === "relationship") continue; // SROs checked below
      expect(o.spec_version).toBe("2.1");
      expect(o.created).toBe(EXPORT_TIMESTAMP);
      expect(o.modified).toBe(EXPORT_TIMESTAMP);
    }
  });

  it("التعيين المقيس: person/company→Identity وdomain/ipv4/sha256/email→Indicator بنمط STIX صحيح", () => {
    const bundle = exported();
    const identities = bundle.objects.filter((o) => o.type === "identity");
    expect(identities.map((o) => o.x_ir_id).sort()).toEqual(["c1", "p1"]);
    expect(identities.find((o) => o.x_ir_id === "p1")).toMatchObject({
      name: "أحمد المكي",
      identity_class: "individual",
    });
    expect(identities.find((o) => o.x_ir_id === "c1")).toMatchObject({
      name: "شركة المثل القابضة",
      identity_class: "organization",
    });
    const indicators = bundle.objects.filter((o) => o.type === "indicator");
    expect(indicators.map((o) => o.x_ir_id).sort()).toEqual(["d1", "e1", "h1", "ip1"]);
    expect(indicators.find((o) => o.x_ir_id === "d1")?.pattern).toBe("[domain-name:value = 'holdings.example']");
    expect(indicators.find((o) => o.x_ir_id === "ip1")?.pattern).toBe("[ipv4-addr:value = '192.0.2.7']");
    expect(indicators.find((o) => o.x_ir_id === "h1")?.pattern).toBe(
      "[file:hashes.'SHA-256' = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855']",
    );
    expect(indicators.find((o) => o.x_ir_id === "e1")?.pattern).toBe("[email-addr:value = 'info@holdings.example']");
    for (const ind of indicators) {
      expect(ind.pattern_type).toBe("stix");
      expect(ind.valid_from).toBe(EXPORT_TIMESTAMP);
    }
  });

  it("الحواف تصبح Relationship SRO تربط المعرّفات المصدرية (relationship_type = الـpredicate)", () => {
    const bundle = exported();
    const byIrId = new Map(bundle.objects.filter((o) => o.x_ir_id !== undefined).map((o) => [o.x_ir_id as string, o]));
    for (const expected of referenceCase.exportedEdges) {
      const rel = bundle.objects.find((o) => o.type === "relationship" && o.x_ir_id === expected.id);
      // The official STIX schema pattern ^[a-z0-9-]+$ forbids underscores — the
      // export applies the documented bijective _→- transform (pure snake_case
      // predicates only; anything else is reported, never corrupted).
      expect(rel?.relationship_type).toBe(expected.predicate.replaceAll("_", "-"));
      expect(rel?.source_ref).toBe(byIrId.get(expected.source)?.id);
      expect(rel?.target_ref).toBe(byIrId.get(expected.target)?.id);
    }
  });
});

describe("P4-014 — STIX import (round-trip بلا فقد)", () => {
  it("import(export(g)) يعيد بناء نفس العقد والحواف بمعرّفاتها المصدرية", () => {
    const rebuilt = stixImport(exported());
    for (const id of referenceCase.exportedNodeIds) {
      const original = referenceCase.graph.nodes.find((n) => n.id === id);
      const back = rebuilt.nodes.find((n) => n.id === id);
      expect(back).toBeDefined();
      expect(back?.labels.ar).toBe(original?.labels.ar);
      expect(back?.type).toBe(original?.type);
    }
    for (const expected of referenceCase.exportedEdges) {
      const back = rebuilt.edges.find((e) => e.id === expected.id);
      expect(back?.predicate).toBe(expected.predicate);
      expect(back?.source).toBe(expected.source);
      expect(back?.target).toBe(expected.target);
    }
    expect(rebuilt.nodes.map((n) => n.id).sort()).toEqual([...referenceCase.exportedNodeIds].sort());
    expect(rebuilt.edges).toHaveLength(3);
  });

  it("فشل-مغلق: كائن بمعرّف غير صالح الشكل يرفض الاستيراد (لا صمت)", () => {
    const bogus: StixObject = {
      type: "identity",
      id: "identity--not-a-uuid",
      name: "x",
      spec_version: "2.1",
      created: EXPORT_TIMESTAMP,
      modified: EXPORT_TIMESTAMP,
      x_ir_id: "z",
    };
    expect(() => stixImport({ type: "bundle", id: "bundle--" + "0".repeat(36), objects: [bogus] })).toThrow();
  });

  it("فشل-مغلق: كائن بلا x_ir_id لا يُخمَّن له معرّف مصدري — يرفض", () => {
    const orphan: StixObject = {
      type: "identity",
      id: "identity--" + "1".repeat(36),
      name: "x",
      spec_version: "2.1",
      created: EXPORT_TIMESTAMP,
      modified: EXPORT_TIMESTAMP,
    };
    expect(() => stixImport({ type: "bundle", id: "bundle--" + "0".repeat(36), objects: [orphan] })).toThrow();
  });
});

describe("P4-014 — الحتمية والتقارير الصادقة", () => {
  it("تصديران متطابقان بنيوياً", () => {
    expect(exported()).toEqual(exported());
  });

  it("رسم فارغ = حزمة فارغة (لا اختراع كائنات)", () => {
    const { bundle } = stixExport({ nodes: [], edges: [] }, { timestamp: EXPORT_TIMESTAMP });
    expect(bundle.objects).toEqual([]);
  });
});

describe("P6-004 — STIX import فاشل-مغلق على الحزم المعادية (fuzz findings)", () => {
  it("rejects non-object bundles with a declared Error, not a TypeError crash", () => {
    // found by the fuzz campaign: stixImport("") used to throw
    // "TypeError: bundle.objects is not iterable"
    expect(() => stixImport("" as unknown as StixBundle)).toThrowError(/^stix: bundle/);
    expect(() => stixImport(null as unknown as StixBundle)).toThrowError(/^stix: bundle/);
    expect(() => stixImport({ objects: "nope" } as unknown as StixBundle)).toThrowError(/^stix: bundle/);
  });

  it("rejects null/non-object bundle members fail-closed", () => {
    const bundle = { type: "bundle", id: "bundle--" + "0".repeat(36), objects: [null] } as unknown as StixBundle;
    expect(() => stixImport(bundle)).toThrowError(/^stix: object/);
  });
});
