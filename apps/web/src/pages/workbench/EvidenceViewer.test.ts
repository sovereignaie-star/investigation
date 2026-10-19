// P3-010: the EvidenceViewer component — safe raw display. HTML renders inside a sandboxed
// iframe (sandbox="" — no scripts, no same-origin, no forms: even a sanitization escape
// cannot execute), text renders escaped in a <pre>, binary evidence is refused honestly.
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { buildEvidenceView } from "./evidenceViewerModel";
import { EvidenceViewer } from "./EvidenceViewer";

const sanitize = (html: string): string => `SANITIZED(${html})`;

function view(mime: string, content: string, encoding = "utf-8", size = 0) {
  return buildEvidenceView({ mime, encoding, content, size }, { sanitize });
}

function render(props: Parameters<typeof EvidenceViewer>[0]): string {
  return renderToStaticMarkup(React.createElement(EvidenceViewer, props));
}

describe("EvidenceViewer (P3-010)", () => {
  it("renders HTML in an iframe with an empty sandbox — no script origin, no same-origin", () => {
    const html = render({
      view: view("text/html", "<h1>تقرير</h1>"),
      fetchedAt: "2026-10-19T00:00:00Z",
      evidenceId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    });
    expect(html).toContain('data-testid="evidence-frame"');
    expect(html).toContain('sandbox=""');
    expect(html).toContain("SANITIZED(");
    // The iframe must carry the sanitized document, not the raw one.
    expect(html).not.toContain("<h1>تقرير</h1>");
  });

  it("renders text evidence escaped in a pre — no markup interpretation at all", () => {
    const html = render({ view: view("text/plain", "<script>alert(1)</script>"), fetchedAt: null, evidenceId: null });
    expect(html).toContain('data-testid="evidence-text"');
    // React escapes text content: the script tag appears as entities, never as markup.
    expect(html).toContain("&" + "lt;script" + "&" + "gt;");
    expect(html).not.toContain("<script>");
  });

  it("marks truncated text honestly", () => {
    const html = render({ view: { kind: "text", body: "a", truncated: true }, fetchedAt: null, evidenceId: null });
    expect(html).toContain('data-testid="evidence-truncated"');
  });

  it("refuses binary evidence with its mime and size — no invented content", () => {
    const html = render({ view: view("image/png", "", "binary", 2048), fetchedAt: null, evidenceId: null });
    expect(html).toContain('data-testid="evidence-binary"');
    expect(html).toContain("image/png");
    expect(html).toContain("2048");
  });

  it("shows the evidence metadata (id and fetched time) for traceability", () => {
    const html = render({
      view: view("text/html", "<p>نص</p>"),
      fetchedAt: "2026-10-19T12:00:00Z",
      evidenceId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    });
    expect(html).toContain("01ARZ3NDEKTSV4RRFFQ69G5FAV");
    expect(html).toContain("2026-10-19T12:00:00Z");
  });
});
