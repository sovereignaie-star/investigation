import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { GraphNode } from "@ir/ledger/projections";

import { buildEntityRows } from "./entityTableModel";
import { EntityTable } from "./EntityTable";

function node(id: string, i: number): GraphNode {
  return {
    id,
    type: "domain",
    canonicalKey: `domain:${String(i).padStart(6, "0")}.example`,
    labels: { ar: `نطاق ${i}` },
    props: {},
    aliases: [],
    attributes: [],
    observations: { positive: 0, negative: 0, error: 0 },
    evidenceIds: [],
  };
}

type TableProps = Parameters<typeof EntityTable>[0];

function table(rows: TableProps["rows"], props: Partial<TableProps> = {}) {
  return renderToStaticMarkup(
    React.createElement(EntityTable, {
      rows,
      sort: { key: "type", dir: "asc" },
      onSortChange: () => undefined,
      filter: "",
      onFilterChange: () => undefined,
      ...props,
    }),
  );
}

describe("EntityTable (P3-009)", () => {
  it("renders the header with sortable columns and the filter input", () => {
    const html = table(buildEntityRows([node("a", 0)]));
    expect(html).toContain('data-testid="entity-table"');
    expect(html).toContain('data-testid="entity-filter"');
    for (const col of ["type", "label", "canonicalKey", "claims", "evidence"]) {
      expect(html).toContain(`data-sort-key="${col}"`);
    }
  });

  it("marks the active sort column and direction (aria-sort)", () => {
    const html = table(buildEntityRows([node("a", 0)]), { sort: { key: "claims", dir: "desc" } });
    expect(html).toMatch(/data-sort-key="claims"[^>]*aria-sort="descending"/);
  });

  it("shows an honest empty state when there are no rows", () => {
    const html = table([]);
    expect(html).toContain("لا كيانات");
  });

  it("virtualizes: 100,000 rows render only the visible window, not the list", () => {
    const many = Array.from({ length: 100_000 }, (_, i) => node(`n${i}`, i));
    const html = table(buildEntityRows(many));
    // the window for viewport 360 / rowHeight 36 / overscan 3 is rows 0..12
    const rendered = (html.match(/data-testid="entity-row"/g) ?? []).length;
    expect(rendered).toBe(13);
    // the first row is present, a far-away row is not
    expect(html).toContain("نطاق 0");
    expect(html).not.toContain("نطاق 50000");
    // the spacers reserve the full list height so the scrollbar reflects 100k rows:
    // (100000 - 13) * 36 = 3599532px below the window, 0 above it
    expect(html).toContain("entity-spacer-top");
    expect(html).toMatch(/height:0"[^>]*entity-spacer-top|entity-spacer-top/); // top spacer collapses to zero
    expect(html).toContain("entity-spacer-bottom");
    expect(html).toContain("height:3599532px");
  });

  it("shows the total count and the filtered count", () => {
    const html = table(buildEntityRows([node("a", 0), node("b", 1)]), { filter: "نطاق", totalRows: 100000 });
    expect(html).toContain("2 من 100,000");
  });
});
