import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CoverageMap } from "./CoverageMap";
import type { CoverageRow } from "./coverageModel";

/**
 * P4-010 (UC-21): خريطة التغطية — «ما فُحص وما لم يُفحص»، والقبول: «كل محوّل فارغ
 * يظهر». صادق الأدلة: كُتب قبل أي تنفيذ؛ الأحمر الأول هيكلي (الوحدة غير موجودة)
 * وموثق في WORKLOG، والنقر الفعلي يُثبت في e2e (uc21) وفق نمط المستودع
 * (الترميز الساكن يفحص جاهزية النقر: معرف العقدة على الصف).
 *
 * العرض صادق نصياً: «فُحص بنتيجة» مقابل «فُحص بلا نتيجة» مقابل «فشل» مقابل
 * «مختلط» — اللون وحده لا يكفي، والعدّادات تُعرض كلها (التاريخ المختلط لا
 * يُختزل)، والطوابع خام بمعزل اتجاهي (BiDi) وبدون كسر داخل السلسلة.
 */

const T1 = "2026-10-10T08:00:00.000Z";

function rowOf(over: Partial<CoverageRow> & { entityId: string }): CoverageRow {
  return { label: over.entityId, type: "domain", untouched: false, checked: [], unchecked: [], ...over };
}

const ROWS: CoverageRow[] = [
  rowOf({
    entityId: "n1",
    label: "عقدة ١",
    checked: [
      { entityId: "n1", transformId: "tr-dns", positive: 2, negative: 0, error: 0, last: "positive", lastAt: T1 },
      { entityId: "n1", transformId: "tr-empty", positive: 0, negative: 3, error: 0, last: "negative", lastAt: T1 },
      { entityId: "n1", transformId: "tr-whois", positive: 1, negative: 1, error: 2, last: "error", lastAt: T1 },
    ],
    unchecked: ["tr-mx"],
  }),
  rowOf({ entityId: "n2", label: "عقدة ٢", untouched: true, unchecked: ["tr-dns", "tr-empty", "tr-mx"] }),
];

function render(status: "ready" = "ready"): string {
  return renderToStaticMarkup(
    React.createElement(CoverageMap, { rows: ROWS, transforms: ["tr-dns", "tr-empty", "tr-mx", "tr-whois"], status }),
  );
}

describe("CoverageMap (P4-010/UC-21) — خريطة التغطية", () => {
  const html = render();

  it("renders one row per entity — the row is the selection affordance (node id on it, click proven in e2e)", () => {
    expect(html).toContain('data-node-id="n1"');
    expect(html).toContain('data-node-id="n2"');
    expect(html).toContain("عقدة ١");
    expect(html).toContain("عقدة ٢");
  });

  it("THE ACCEPTANCE — a transform whose only result is negative is VISIBLE with its state and counts, never filtered", () => {
    // the negative-only cell is on the row with its own label and counts
    const cellStart = html.indexOf('data-transform-id="tr-empty"');
    expect(cellStart).toBeGreaterThan(-1);
    const cellHtml = html.slice(cellStart, html.indexOf("</li>", cellStart));
    expect(cellHtml).toContain("فُحص بلا نتيجة");
    expect(cellHtml).toContain("tr-empty");
  });

  it("states are TEXTUALLY distinct — checked-with-results, checked-no-results, failed, mixed (color alone is not enough)", () => {
    const withResults = html.slice(
      html.indexOf('data-transform-id="tr-dns"'),
      html.indexOf("</li>", html.indexOf('data-transform-id="tr-dns"')),
    );
    expect(withResults).toContain("فُحص بنتيجة");
    const failed = html.slice(
      html.indexOf('data-transform-id="tr-whois"'),
      html.indexOf("</li>", html.indexOf('data-transform-id="tr-whois"')),
    );
    expect(failed).toContain("مختلط");
  });

  it("a mixed-history cell shows ALL its counts — the history is never collapsed to the last result", () => {
    const mixed = html.slice(
      html.indexOf('data-transform-id="tr-whois"'),
      html.indexOf("</li>", html.indexOf('data-transform-id="tr-whois"')),
    );
    expect(mixed).toContain("نتائج: 1");
    expect(mixed).toContain("بلا نتيجة: 1");
    expect(mixed).toContain("فشل: 2");
  });

  it("unchecked transforms are listed on the row — «ما لم يُفحص» is visible, not hidden", () => {
    expect(html).toContain("لم يُفحص: tr-mx");
    // the untouched row lists the whole universe
    expect(html).toContain("لم يُفحص: tr-dns");
  });

  it("an untouched entity is marked honestly — nothing has been tried on it yet", () => {
    const n2 = html.slice(html.indexOf('data-node-id="n2"'));
    expect(n2).toContain("لم يُفحص بعد");
  });

  it("ISO timestamps are directionally isolated (dir=ltr, no mid-string wrap) inside the RTL context", () => {
    // the contract is the isolation itself (dir=ltr + whitespace-nowrap), not the
    // exact class string — the span may carry color utilities alongside it.
    expect(html).toMatch(/<span dir="ltr" class="whitespace-nowrap[^"]*">\s*2026-10-10T08:00:00\.000Z\s*<\/span>/);
  });

  it("unavailable coverage says so honestly — no fabricated rows", () => {
    const unavailable = renderToStaticMarkup(React.createElement(CoverageMap, { rows: [], transforms: [], status: "unavailable" }));
    expect(unavailable).toContain("غير متاحة");
    expect(unavailable).not.toContain("data-node-id");
  });

  it("no opened case says so honestly — local identifiers are never classified as untouched", () => {
    const noCase = renderToStaticMarkup(React.createElement(CoverageMap, { rows: [], transforms: [], status: "no-case" }));
    expect(noCase).toContain("افتح قضية محفوظة");
    expect(noCase).not.toContain("data-node-id");
  });
});
