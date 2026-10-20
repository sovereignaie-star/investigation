import * as React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { extract, specById, type Extracted } from "@ir/core/identifiers";

import { SearchBar } from "./pages/workbench/SearchBar";
import { FileUploader, isFileTooLarge, MAX_FILE_BYTES } from "./pages/workbench/FileUploader";
import { IdentifierSelector } from "./pages/workbench/IdentifierSelector";
import { toIdentifierRows, toggleSelection, type IdentifierRow } from "./pages/workbench/model";
import { WorkbenchPage } from "./pages/WorkbenchPage";

/**
 * P3-004 acceptance = UC-02: paste free text (or read a text file), extract identifiers with the
 * real engine (`extract`, P1-020/P1-006), and show a classified list with confidence. These tests
 * were written red-first: the components did not exist when the suite was authored.
 *
 * Fixture values and scores below are [مُقاس] against the real engine on this tree (see WORKLOG
 * entry for the probe commands); labels are read from the live catalog via `specById`.
 */

const FIXTURE_TEXT = ["192.168.1.10", "example.com", "test@gmail.com", "0x71C7656EC7ab88b098defB751B7401B5f6d8976F", "192.168.1.10"].join(
  "\n",
);

const extracted: Extracted[] = extract(FIXTURE_TEXT);

/** Fixture row lookup that fails loudly instead of asserting non-null. */
function row(rows: readonly IdentifierRow[], value: string): IdentifierRow {
  const found = rows.find((r) => r.value === value);
  if (found === undefined) throw new Error(`missing fixture row: ${value}`);
  return found;
}

/** Catalog label lookup that fails loudly instead of asserting non-null. */
function labelOf(typeId: string): string {
  const spec = specById(typeId);
  if (spec === undefined) throw new Error(`missing spec: ${typeId}`);
  return spec.labels.ar;
}

describe("P3-004 model: extraction to classified rows (UC-02)", () => {
  it("classifies each extracted identifier with its catalog label, confidence and validation", () => {
    const rows = toIdentifierRows(extracted);
    const ip = row(rows, "192.168.1.10");
    expect(ip.typeId).toBe("ip_private");
    expect(ip.typeLabelAr).toBe(labelOf("ip_private"));
    expect(ip.validated).toBe(true);
    expect(ip.confidence).toBeGreaterThan(0.7);

    const domain = row(rows, "example.com");
    expect(domain.typeId).toBe("domain");
    expect(domain.validated).toBe(true);
    expect(domain.confidence).toBeGreaterThan(0.6);

    const mail = row(rows, "test@gmail.com");
    expect(mail.typeId).toBe("gmail");
    expect(mail.validated).toBe(false);
    expect(mail.confidence).toBeGreaterThan(0.3);
  });

  it("deduplicates repeated values and sorts by confidence descending", () => {
    const rows = toIdentifierRows(extracted);
    expect(rows.filter((r) => r.value === "192.168.1.10")).toHaveLength(1);
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i - 1].confidence).toBeGreaterThanOrEqual(rows[i].confidence);
    }
  });

  it("selection toggles without mutating the input set", () => {
    const set = new Set(["a"]);
    const next = toggleSelection(set, "b");
    expect([...next].sort()).toEqual(["a", "b"]);
    expect([...set]).toEqual(["a"]);
    expect([...toggleSelection(next, "a")].sort()).toEqual(["b"]);
  });
});

describe("P3-004 SearchBar (UC-02 step: paste free text)", () => {
  it("renders a labelled textarea and the extraction submit button", () => {
    const html = renderToStaticMarkup(React.createElement(SearchBar, { onText: () => undefined }));
    expect(html).toContain('data-testid="search-bar"');
    expect(html).toContain("الصق نصاً حراً");
    expect(html).toContain("استخراج المعرّفات");
    expect(html).toMatch(/<textarea[^>]*name="search-text"/);
    expect(html).toMatch(/<button[^>]*type="submit"/);
  });
});

describe("P3-004 FileUploader (UC-02 step: read a text file in memory)", () => {
  it("renders a file input limited to text files", () => {
    const html = renderToStaticMarkup(React.createElement(FileUploader, { onText: () => undefined }));
    expect(html).toContain('data-testid="file-uploader"');
    expect(html).toMatch(/<input[^>]*type="file"[^>]*accept="[^"]*text\/plain/);
    expect(html).toContain("ارفع ملفاً");
  });

  it("caps the file size (no unbounded reads) [مُقاس]", () => {
    expect(MAX_FILE_BYTES).toBe(1_000_000);
    expect(isFileTooLarge(999_999)).toBe(false);
    expect(isFileTooLarge(1_000_001)).toBe(true);
  });
});

describe("P3-004 IdentifierSelector (UC-02 step: classified list with confidence)", () => {
  const rows: IdentifierRow[] = [
    {
      id: "ip_private:192.168.1.10",
      value: "192.168.1.10",
      typeId: "ip_private",
      typeLabelAr: labelOf("ip_private"),
      category: "Network",
      confidence: 0.74,
      validated: true,
    },
    {
      id: "gmail:test@gmail.com",
      value: "test@gmail.com",
      typeId: "gmail",
      typeLabelAr: labelOf("gmail"),
      category: "Email",
      confidence: 0.35,
      validated: false,
    },
  ];

  it("renders each identifier with its value (LTR), label, confidence and validation badge", () => {
    const html = renderToStaticMarkup(
      React.createElement(IdentifierSelector, {
        rows,
        selected: new Set([rows[0].id]),
        onToggle: () => undefined,
      }),
    );
    expect(html).toContain('data-testid="identifier-selector"');
    expect(html).toContain('dir="ltr"');
    expect(html).toContain("192.168.1.10");
    expect(html).toContain(labelOf("ip_private"));
    expect(html).toContain("74%");
    expect(html).toContain("مؤكد");
    expect(html).toContain("35%");
    expect(html).toContain("test@gmail.com");
    // selection control per identifier, keyed by row id
    expect(html).toContain(`name="identifier:${rows[0].id}"`);
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*checked/);
  });

  it("shows an explicit empty state when nothing was extracted yet", () => {
    const html = renderToStaticMarkup(
      React.createElement(IdentifierSelector, {
        rows: [],
        selected: new Set<string>(),
        onToggle: () => undefined,
      }),
    );
    expect(html).toContain("لا معرّفات بعد");
  });

  it("shows the selected count", () => {
    const html = renderToStaticMarkup(
      React.createElement(IdentifierSelector, {
        rows,
        selected: new Set([rows[0].id, rows[1].id]),
        onToggle: () => undefined,
      }),
    );
    expect(html).toContain("2/2");
  });
});

describe("P3-004 WorkbenchPage (UC-02 wiring)", () => {
  // P3-015: the page now mounts the saved-investigations surface, whose list comes
  // from the generated hook — so the page renders inside a QueryClientProvider
  // (exactly as App.tsx mounts it); the extraction assertions are unchanged.
  const renderPage = (props: { initialText?: string } = {}): string => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return renderToStaticMarkup(React.createElement(QueryClientProvider, { client }, React.createElement(WorkbenchPage, props)));
  };

  it("extracts and displays classified identifiers from the pasted text on first render", () => {
    const html = renderPage({ initialText: FIXTURE_TEXT });
    expect(html).toContain('data-testid="workbench-page"');
    expect(html).toContain("192.168.1.10");
    expect(html).toContain(labelOf("ip_private"));
    expect(html).toContain("74%");
  });

  it("shows the empty state before any input", () => {
    const html = renderPage();
    expect(html).toContain("لا معرّفات بعد");
  });
});
