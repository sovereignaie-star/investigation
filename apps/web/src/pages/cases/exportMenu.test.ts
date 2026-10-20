import { describe, expect, it } from "vitest";

import { EXPORT_FORMATS, exportUrl, filenameFromDisposition, isExportFormat } from "./exportMenu";

/**
 * P3-014: the export model — the formats available in THIS phase and nothing else.
 * The menu must never show a format the server does not support (an unsupported
 * format is an explicit 400 naming the supported ones — never a silent fallback),
 * and the downloaded filename must come from the server's Content-Disposition with
 * a safe fallback that never carries path separators.
 */

describe("EXPORT_FORMATS (P3-014 — الصيغ المتاحة في المرحلة)", () => {
  it("contains exactly the phase's available format — the projection snapshot JSON", () => {
    expect(EXPORT_FORMATS).toHaveLength(1);
    expect(EXPORT_FORMATS[0].id).toBe("projection");
    // The label says what the file IS: a projection snapshot, not a full case copy.
    expect(EXPORT_FORMATS[0].label).toContain("لقطة الإسقاط");
    expect(EXPORT_FORMATS[0].label).toContain("JSON");
  });

  it("isExportFormat accepts the phase's format and rejects invented ones — no silent fallback", () => {
    expect(isExportFormat("projection")).toBe(true);
    expect(isExportFormat("csv")).toBe(false);
    expect(isExportFormat("pdf")).toBe(false);
    expect(isExportFormat("")).toBe(false);
  });
});

describe("exportUrl (P3-014)", () => {
  it("builds the download URL for the phase's format — the only route the wired component calls", () => {
    expect(exportUrl("01ABC", "projection")).toBe("/api/cases/01ABC/export/projection");
  });
});

describe("filenameFromDisposition (P3-014)", () => {
  it("parses the server's attachment filename", () => {
    expect(filenameFromDisposition('attachment; filename="case-01A-projection.json"', "01A", "projection")).toBe(
      "case-01A-projection.json",
    );
  });

  it("falls back to a safe deterministic name when the header is missing or malformed — never empty", () => {
    expect(filenameFromDisposition(null, "01ABC", "projection")).toBe("case-01ABC-projection.json");
    expect(filenameFromDisposition("garbage without filename", "01ABC", "projection")).toBe("case-01ABC-projection.json");
  });

  it("never lets a crafted filename carry path separators or traversal out of the download", () => {
    expect(filenameFromDisposition('attachment; filename="../../etc/passwd"', "01A", "projection")).not.toContain("..");
    expect(filenameFromDisposition('attachment; filename="a/b/c.json"', "01A", "projection")).not.toContain("/");
  });
});
