import { describe, expect, it } from "vitest";
import type { Graph, GraphNode } from "@ir/ledger/projections";

import { buildMapPoints, mapBounds } from "./mapModel.ts";

/**
 * P4-012: عرض الخريطة الجغرافية — معيار القبول: «يعمل ببلاطات محلية في
 * الوضع المعزول» (لا طلب شبكة خارجياً) والنقاط من الإسقاط الفعلي للقضية.
 *
 * صادق الأدلة: كُتب هذا الملف قبل أي تنفيذ؛ التشغيل الأحمر الأول هيكلي
 * (الوحدة غير موجودة) وموثق في WORKLOG؛ النموذج النقي يقود كل شيء
 * والاختبار الطرفي يثبت التشغيل الفعلي في المتصفح.
 *
 * قاعدة الإسقاط: قيمة بُعد العقدة تُقبل كنقطة جغرافية فقط إذا كان نوعها
 * geo_point في كتالوج المعرّفات الحقيقي (الكشف بمحرك @ir/core نفسه لا نمط
 * منسوخ) — القيمة الحرفية "lat,lng" بمدى WGS84 الموثق؛ أي قيمة يرفضها
 * الكتالوج لا تُعرض على الخريطة (لا تخمين ولا إسقاط اتصال).
 */

function attr(
  predicate: string,
  value: string | number | boolean,
  claimId: string,
  extra: Partial<GraphNode["attributes"][number]> = {},
): GraphNode["attributes"][number] {
  return {
    claimId,
    predicate,
    value,
    confidence: 0.8,
    validFrom: null,
    validTo: null,
    occurredFrom: null,
    occurredTo: null,
    evidenceIds: ["ev-1"],
    observations: [],
    ...extra,
  };
}

function node(id: string, attributes: GraphNode["attributes"][number][]): GraphNode {
  return {
    id,
    type: "domain",
    canonicalKey: `domain:${id}`,
    labels: { ar: `عقدة ${id}` },
    props: {},
    aliases: [],
    attributes,
    observations: { positive: 0, negative: 0, error: 0 },
    evidenceIds: [],
  };
}

describe("buildMapPoints — استخراج النقاط من إسقاط القضية", () => {
  it("قيمة geo_point صحيحة تصبح نقطة (lat/lng مفكوكة، مع الأدلة والثقة)", () => {
    const graph: Graph = {
      nodes: [node("a", [attr("has_coordinates", "21.4225,39.8262", "c-1", { confidence: 0.9 })])],
      edges: [],
    };
    const points = buildMapPoints(graph);
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({
      nodeId: "a",
      claimId: "c-1",
      label: "عقدة a",
      lat: 21.4225,
      lng: 39.8262,
      confidence: 0.9,
      evidenceIds: ["ev-1"],
    });
  });

  it("الإحداثيات السالبة (نصف الكرة الجنوبي/الغربي) تُقبل", () => {
    const graph: Graph = {
      nodes: [node("b", [attr("captured_at", "-33.8688,151.2093", "c-2")])],
      edges: [],
    };
    const points = buildMapPoints(graph);
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({ lat: -33.8688, lng: 151.2093 });
  });

  it("مدى غير صالح يُرفض (91.0,10.0) — كتالوج geo_point يرفض خارج WGS84", () => {
    const graph: Graph = {
      nodes: [node("c", [attr("has_coordinates", "91.0,10.0", "c-3")])],
      edges: [],
    };
    expect(buildMapPoints(graph)).toEqual([]);
  });

  it("قيمة غير رقمية لا تصبح نقطة (لا تخمين)", () => {
    const graph: Graph = {
      nodes: [node("d", [attr("name", "أحمد", "c-4")]), node("e", [attr("port", "443", "c-5")])],
      edges: [],
    };
    expect(buildMapPoints(graph)).toEqual([]);
  });

  it("ادعاءات جغرافية متعددة لنفس العقدة تظهر كلها (الصدق: لا دمج خفي للادعاءات)", () => {
    const graph: Graph = {
      nodes: [node("f", [attr("has_coordinates", "21.4225,39.8262", "c-6"), attr("captured_at", "-33.8688,151.2093", "c-7")])],
      edges: [],
    };
    const points = buildMapPoints(graph);
    expect(points).toHaveLength(2);
    expect(points.map((p) => p.claimId)).toEqual(["c-6", "c-7"]);
  });

  it("ترتيب النقاط حتمي: بترتيب إدراج العقد ثم الادعاءات", () => {
    const graph: Graph = {
      nodes: [node("z", [attr("has_coordinates", "10.0,10.0", "c-z")]), node("a", [attr("has_coordinates", "20.0,20.0", "c-a")])],
      edges: [],
    };
    expect(buildMapPoints(graph).map((p) => p.nodeId)).toEqual(["z", "a"]);
  });

  it("رسم فارغ = لا نقاط (ولا خطأ)", () => {
    expect(buildMapPoints({ nodes: [], edges: [] })).toEqual([]);
    expect(buildMapPoints({ nodes: [node("solo", [])], edges: [] })).toEqual([]);
  });
});

describe("mapBounds — حدود العرض من النقاط", () => {
  it("حد أدنى/أقصى للنقاط", () => {
    const graph: Graph = {
      nodes: [
        node("a", [attr("has_coordinates", "21.4225,39.8262", "c-1")]),
        node("b", [attr("has_coordinates", "-33.8688,151.2093", "c-2")]),
      ],
      edges: [],
    };
    const points = buildMapPoints(graph);
    expect(mapBounds(points)).toEqual({
      minLat: -33.8688,
      maxLat: 21.4225,
      minLng: 39.8262,
      maxLng: 151.2093,
    });
  });

  it("لا نقاط = لا حدود (null)", () => {
    expect(mapBounds([])).toBeNull();
  });
});
