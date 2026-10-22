import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MapView } from "./MapView.tsx";
import type { MapPoint } from "./mapModel.ts";

/**
 * P4-012: عرض الخريطة الجغرافية — الاختبار الساكن (عرف المستودع: renderToStaticMarkup
 * للمكونات — ملف .tsx الأصلي خارج نمط تضمين vitest للـ.test.tsx فالاختبار هنا .ts).
 *
 * صادق الأدلة: كُتب قبل أي تنفيذ؛ الأحمر الأول هيكلي (الوحدة غير موجودة) وموثق في
 * WORKLOG. ما يُفحص هنا: النموذج المُعرض (نقاط صادقة من الإسقاط، لا نقاط = رسالة
 * صادقة)، والترميز الجاهز للنقر (معرّف العقدة على الصف — النقر الفعلي يُثبت في e2e)،
 * وإعداد البلاطات القابلة للتهيئة (المدخل يبدأ فارغاً = الوضع المعزول). تهيئة
 * MapLibre نفسها (WebGL) لا تُختبر هنا (renderToStaticMarkup لا يشغّل التأثيرات) —
 * البوابة الفعلية هي e2e على متصفح حقيقي، والفشل الصادق عند غياب WebGL له مسار
 * موثق في المكون (لا فشل صامت).
 */

const points: MapPoint[] = [
  {
    nodeId: "a",
    claimId: "c-1",
    label: "عقدة a",
    lat: 21.4225,
    lng: 39.8262,
    confidence: 0.9,
    evidenceIds: ["ev-1"],
  },
  {
    nodeId: "b",
    claimId: "c-2",
    label: "عقدة b",
    lat: -33.8688,
    lng: 151.2093,
    confidence: 0.8,
    evidenceIds: ["ev-2"],
  },
];

function markup(pts: readonly MapPoint[]) {
  return renderToStaticMarkup(React.createElement(MapView, { points: pts }));
}

describe("P4-012 — MapView (ترميز ساكن)", () => {
  it("يعرض العنوان وقائمة النقاط بمعرّف العقدة على كل صف (جاهزية النقر) والإحداثيات معزولة الاتجاه", () => {
    const html = markup(points);
    expect(html).toContain('data-testid="map-view"');
    expect(html).toContain('data-testid="map-point"');
    expect(html).toContain('data-node-id="a"');
    expect(html).toContain('data-node-id="b"');
    // BiDi: "lat,lng" داخل فقرة RTL تُعزل اتجاهياً كي لا تنقلب الأرقام (نمط TimelineView).
    expect(html).toMatch(/dir="ltr"[^>]*>-?33\.8688/);
    // كل نقطة تحمل أدلتها في title (ربط العرض بالدليل — عرف المستودع).
    expect(html).toContain("ev-1");
  });

  it("لا نقاط جغرافية = رسالة صادقة لا خريطة فارغة توهم وجود محتوى", () => {
    const html = markup([]);
    expect(html).toContain('data-testid="map-view"');
    expect(html).toContain('data-testid="map-no-points"');
    expect(html).not.toContain('data-testid="map-point"');
  });

  it("إعداد البلاطات القابلة للتهيئة: مدخل فارغ افتراضياً (الوضع المعزول لا يطلب شبكة)", () => {
    const html = markup(points);
    expect(html).toContain('data-testid="map-tiles-input"');
    expect(html).toContain('value=""');
  });

  it("حاوية الخريطة موجودة بحالة انتظار صادقة (التهيئة الفعلية تُثبت في e2e)", () => {
    const html = markup(points);
    expect(html).toContain('data-testid="map-canvas"');
    expect(html).toContain('data-map-status="pending"');
  });
});
