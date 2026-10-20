import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ExportMenuView } from "./ExportMenu";

/**
 * P3-014: the ExportMenu's presentational states, checked headlessly via static
 * markup (the app's established web test pattern). The menu lists exactly the
 * formats available in the phase — nothing invented, nothing hidden — and a
 * locked case (J-17) gets no export action at all.
 */

const render = (props: { caseId: string; canExport: boolean; onExport?: (f: string) => void }): string =>
  renderToStaticMarkup(React.createElement(ExportMenuView, { ...props, onExport: props.onExport ?? (() => {}) }));

describe("ExportMenuView (P3-014)", () => {
  it("lists exactly the phase's available format — one item, labeled honestly as a projection snapshot", () => {
    const html = render({ caseId: "01ABC", canExport: true });
    expect(html).toContain('data-testid="export-menu-01ABC"');
    expect(html).toContain('data-testid="export-item-projection-01ABC"');
    // The item says what the file IS: a projection snapshot (JSON), not a full case copy.
    expect(html).toContain("لقطة الإسقاط");
    expect(html).toContain("JSON");
    // Exactly one format item — the phase has one available format.
    expect(html.match(/data-testid="export-item-/g)).toHaveLength(1);
  });

  it("surfaces a failed export honestly and disables the item while busy — never a silent no-download", () => {
    const busy = render({ caseId: "01ABC", canExport: true, busy: true, error: null });
    expect(busy).toContain('disabled=""');
    const failed = render({ caseId: "01ABC", canExport: true, busy: false, error: "HTTP 403" });
    expect(failed).toContain('data-testid="export-error-01ABC"');
    expect(failed).toContain("HTTP 403");
  });

  it("a locked case (J-17) gets no export action at all — nothing is exported from it", () => {
    const html = render({ caseId: "01LOCKED", canExport: false });
    expect(html).toContain('data-testid="export-menu-01LOCKED"');
    expect(html).not.toContain("export-item-");
    expect(html).toContain("لا تصدير قبل فك التشفير");
  });
});
