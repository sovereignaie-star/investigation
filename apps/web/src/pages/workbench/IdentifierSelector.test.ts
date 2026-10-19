import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { IdentifierRow } from "./model";
import { IdentifierSelector } from "./IdentifierSelector";

function row(i: number): IdentifierRow {
  return {
    id: `ip:${i}`,
    value: `10.0.${Math.floor(i / 256)}.${i % 256}`,
    typeId: "ip",
    typeLabelAr: "عنوان IP",
    category: "network",
    confidence: 0.9,
    validated: false,
  };
}

function selector(rows: IdentifierRow[], selected = new Set<string>()) {
  return renderToStaticMarkup(React.createElement(IdentifierSelector, { rows, selected, onToggle: () => undefined }));
}

describe("IdentifierSelector virtualization (P3-026)", () => {
  it("still renders the header, count line and selectable rows for small lists", () => {
    const html = selector([row(0), row(1)]);
    expect(html).toContain('data-testid="identifier-selector"');
    expect(html).toContain("محدد المعرّفات: 0/2");
    expect(html).toContain('name="identifier:ip:0"');
  });

  it("keeps the honest empty state", () => {
    const html = selector([]);
    expect(html).toContain("لا معرّفات بعد");
  });

  it("virtualizes: 100,000 identifiers render a constant-size window, not the list", () => {
    const many = Array.from({ length: 100_000 }, (_, i) => row(i));
    const html = selector(many);
    const rendered = (html.match(/identifier:ip:/g) ?? []).length;
    // viewport 360px / rowHeight 40px + overscan 3 => rows 0..11 (12 rows)
    expect(rendered).toBe(12);
    expect(html).toContain("10.0.0.0");
    expect(html).not.toContain("10.0.195.200");
    // spacers reserve the full list height (100000-12)*40 = 3999520px
    expect(html).toContain("height:3999520px");
    // the count line still reports the true total
    expect(html).toContain("100,000");
  });
});
