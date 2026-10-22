/**
 * P4-012: عرض الخريطة الجغرافية — الدليل الطرفي على المتصفح الحقيقي.
 *
 * معيار القبول: «يعمل ببلاطات محلية في الوضع المعزول» — يُثبت هنا فعلياً:
 * 1. الخريطة (MapLibre) تُهيأ وتصل ready في المتصفح الحقيقي (WebGL فعلي).
 * 2. الوضع المعزول صادق: أثناء فتح القضية وتهيئة الخريطة لا يغادر أي طلب
 *    أصل الخادم (لا بلاطات خارجية، لا خطوط خارجية، لا شيء) — يُقاس بمراقبة
 *    كل الطلبات، لا بالافتراض.
 * 3. نقاط القضية الجغرافية (من ادعاءات القيمة الحرفية geo_point) تُعرض
 *    صادقة: ادعاءان جغرافيان لعقدتين = نقطتان، والإحداثيات ظاهرة كما هي.
 * 4. النقر على صف نقطة يختار العقدة ويفتح لوحة التفاصيل (التفاعل الحقيقي).
 * 5. «لا نقاط» صادقة: قضية بلا ادعاءات جغرافية تعرض الرسالة لا خريطة فارغة
 *    توهم وجود محتوى.
 */
import { expect, test, type Page } from "@playwright/test";
import { openCase as openCaseStore } from "@ir/store";
import { caseDirOf, createCaseViaApi, openCase, origin } from "./helpers.ts";

const PERSON_MAKKAH = "01AAAAAAAAAAAAAAAAAAAAAAAA";
const PERSON_SYDNEY = "01BBBBBBBBBBBBBBBBBBBBBBBB";

/** A case whose known truth is two geo claims: مكة (21.4225,39.8262) and
 *  سيدني (-33.8688,151.2093) — both appended through the real write path. */
async function seededCase(): Promise<string> {
  const caseId = await createCaseViaApi("قضية الخريطة الجغرافية", "التحقق من عرض النقاط الجغرافية على خريطة MapLibre في الوضع المعزول");
  const c = openCaseStore(caseDirOf(caseId), { actor: "e2e" });
  try {
    for (const [id, key, label] of [
      [PERSON_MAKKAH, "person:e2e-map-makkah", "أحمد المكي"],
      [PERSON_SYDNEY, "person:e2e-map-sydney", "سعيد السيدني"],
    ] as const) {
      c.append("entity.added", {
        id,
        type: "person",
        canonicalKey: key,
        labels: { ar: label },
        props: {},
      });
    }
    const sha = "ab".repeat(32);
    c.append("evidence.stored", {
      id: "01CCCCCCCCCCCCCCCCCCCCCCCC",
      sha256: sha,
      mime: "application/json",
      size: 2,
      blobRef: `blobs/ab/${sha}`,
      fetchedAt: "2026-03-01T00:00:00Z",
      request: { method: "LOCAL", url: "local://e2e", headers: {} },
      transformId: "tr-nominatim",
      version: "1",
    });
    c.append("claim.added", {
      id: "01DDDDDDDDDDDDDDDDDDDDDDD1",
      subjectId: PERSON_MAKKAH,
      predicate: "has_coordinates",
      value: "21.4225,39.8262",
      confidence: 0.9,
      explanation: "e2e geo claim",
      validFrom: null,
      validTo: null,
      occurredFrom: null,
      occurredTo: null,
    });
    c.append("claim.added", {
      id: "01DDDDDDDDDDDDDDDDDDDDDDD2",
      subjectId: PERSON_SYDNEY,
      predicate: "has_coordinates",
      value: "-33.8688,151.2093",
      confidence: 0.8,
      explanation: "e2e geo claim",
      validFrom: null,
      validTo: null,
      occurredFrom: null,
      occurredTo: null,
    });
  } finally {
    c.close();
  }
  return caseId;
}

/** Every request the page issues while the case is open and the map inits.
 *  The origin is pinned to the SERVER's own origin (helpers) — `page.url()` is
 *  about:blank while the very first document request fires, which would fake
 *  an "external" hit (a race, not an app request — measured in e2e). */
function externalRequests(page: Page): string[] {
  const external: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.origin !== new URL(origin).origin) external.push(req.url());
  });
  return external;
}

test("P4-012: geo map — real MapLibre init, isolated mode with ZERO external requests, honest points, real selection", async ({ page }) => {
  const caseId = await seededCase();
  const external = externalRequests(page);
  await openCase(page, caseId);

  const map = page.getByTestId("map-view");
  await expect(map).toBeVisible();

  // the points are the case's own geo claims — two claims, two rows, coords as-is
  const rows = page.getByTestId("map-point");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("21.4225,39.8262");
  await expect(rows.nth(1)).toContainText("-33.8688,151.2093");

  // MapLibre really initialized (WebGL): the canvas container reports ready
  await expect(page.getByTestId("map-canvas")).toHaveAttribute("data-map-status", "ready", { timeout: 20_000 });

  // ISOLATED MODE, measured not assumed: while the case rendered and the map
  // initialized, no request left the server's own origin (no tiles, no fonts).
  expect(external).toEqual([]);

  // the row is the selection affordance — clicking it selects the node and the
  // detail panel opens (the real interaction, same wiring as the timeline)
  await rows.nth(0).click();
  await expect(page.getByTestId("node-detail-panel")).toBeVisible();
});

test("P4-012: a case with NO geo claims says so honestly — no empty map pretending", async ({ page }) => {
  const caseId = await createCaseViaApi("قضية بلا نقاط جغرافية", "التحقق من الرسالة الصادقة عند غياب النقاط الجغرافية");
  const c = openCaseStore(caseDirOf(caseId), { actor: "e2e" });
  try {
    c.append("entity.added", {
      id: "01EEEEEEEEEEEEEEEEEEEEEEEE",
      type: "person",
      canonicalKey: "person:e2e-map-none",
      labels: { ar: "شخص بلا إحداثيات" },
      props: {},
    });
  } finally {
    c.close();
  }
  await openCase(page, caseId);

  const map = page.getByTestId("map-view");
  await expect(map).toBeVisible();
  await expect(page.getByTestId("map-no-points")).toBeVisible();
  await expect(page.getByTestId("map-point")).toHaveCount(0);
});
