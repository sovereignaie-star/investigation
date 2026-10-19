// P3-010: the evidence-viewer model — pure classification and display building.
// The security contract (ROADMAP 5.6 injection row): external HTML is rendered sanitized
// (DOMPurify) inside an isolated iframe; everything textual renders as text; binary
// evidence is refused honestly instead of corrupted. The sanitizer is injected so the
// model is testable in node; the browser wiring uses DOMPurify.
import { describe, expect, it } from "vitest";

import { buildEvidenceView, classifyMime, displayOn, submitDecision, TEXT_DISPLAY_LIMIT } from "./evidenceViewerModel";

/** A deterministic fake sanitizer: records and tags whatever it was given. */
function fakeSanitize() {
  const calls: string[] = [];
  return {
    calls,
    sanitize: (html: string): string => {
      calls.push(html);
      return `SANITIZED(${html})`;
    },
  };
}

describe("classifyMime (P3-010)", () => {
  it("classifies HTML by mime — with or without parameters", () => {
    expect(classifyMime("text/html")).toBe("html");
    expect(classifyMime("text/html; charset=utf-8")).toBe("html");
  });

  it("classifies plain text and structured text as text", () => {
    expect(classifyMime("text/plain")).toBe("text");
    expect(classifyMime("application/json")).toBe("text");
    expect(classifyMime("application/ld+json")).toBe("text");
    expect(classifyMime("application/xml")).toBe("text");
    expect(classifyMime("application/yaml")).toBe("text");
  });

  it("classifies everything else as binary (images, archives, unknown)", () => {
    expect(classifyMime("image/png")).toBe("binary");
    expect(classifyMime("application/zip")).toBe("binary");
    expect(classifyMime("application/octet-stream")).toBe("binary");
    expect(classifyMime("")).toBe("binary");
  });
});

describe("buildEvidenceView (P3-010)", () => {
  it("builds an html view with the sanitizer applied — the raw HTML never passes through", () => {
    const s = fakeSanitize();
    const view = buildEvidenceView({ mime: "text/html", encoding: "utf-8", content: "<h1>عنوان</h1>" }, { sanitize: s.sanitize });
    expect(view.kind).toBe("html");
    expect(s.calls).toEqual(["<h1>عنوان</h1>"]);
  });

  it("builds a text view verbatim — no sanitizer call", () => {
    const s = fakeSanitize();
    const view = buildEvidenceView({ mime: "application/json", encoding: "utf-8", content: '{"a": 1}' }, { sanitize: s.sanitize });
    expect(view.kind).toBe("text");
    expect(view.body).toBe('{"a": 1}');
    expect(s.calls).toEqual([]);
  });

  it("truncates long text with an honest marker", () => {
    const s = fakeSanitize();
    const content = "a".repeat(TEXT_DISPLAY_LIMIT + 500);
    const view = buildEvidenceView({ mime: "text/plain", encoding: "utf-8", content }, { sanitize: s.sanitize });
    expect(view.kind).toBe("text");
    expect(view.truncated).toBe(true);
    expect(view.body.length).toBe(TEXT_DISPLAY_LIMIT);
  });

  it("never truncates html silently — the sanitizer gets the full document", () => {
    const s = fakeSanitize();
    const content = `<p>${"b".repeat(TEXT_DISPLAY_LIMIT + 500)}</p>`;
    const view = buildEvidenceView({ mime: "text/html", encoding: "utf-8", content }, { sanitize: s.sanitize });
    expect(view.kind).toBe("html");
    expect(s.calls).toEqual([content]);
    // the CSP prefix comes first; the sanitizer's full output follows it verbatim.
    expect(view.body.endsWith(`SANITIZED(${content})`)).toBe(true);
  });

  it("refuses binary evidence honestly — no content is invented", () => {
    const s = fakeSanitize();
    const view = buildEvidenceView({ mime: "image/png", encoding: "binary", content: "", size: 1024 }, { sanitize: s.sanitize });
    expect(view.kind).toBe("binary");
    expect(s.calls).toEqual([]);
  });

  it("treats a binary-encoded payload as binary even if the mime claims text", () => {
    const s = fakeSanitize();
    const view = buildEvidenceView({ mime: "text/html", encoding: "binary", content: "", size: 7 }, { sanitize: s.sanitize });
    expect(view.kind).toBe("binary");
    expect(s.calls).toEqual([]);
  });

  it("pins a no-egress CSP onto the html document — the evidence page can never load a foreign resource", () => {
    const s = fakeSanitize();
    const view = buildEvidenceView(
      { mime: "text/html", encoding: "utf-8", content: '<p>نص</p><img src="https://evil.example/px.gif">' },
      { sanitize: s.sanitize },
    );
    expect(view.kind).toBe("html");
    expect(view.body.startsWith('<meta http-equiv="Content-Security-Policy"'));
    expect(view.body).toContain("default-src 'none'");
    // the CSP comes first so it governs everything the sanitizer kept.
    expect(view.body.indexOf("Content-Security-Policy")).toBeLessThan(view.body.indexOf("SANITIZED("));
  });
});

describe("submitDecision (P3-010 — a corrected token must re-fetch the same pair)", () => {
  const PAIR = { caseId: "01ARZ3NDEKTSV4RRFFQ69G5FAV", evidenceId: "01HZZZZZZZZZZZZZZZZZZZZZZZ" };

  it("a new pair runs a fresh query (no refetch flag)", () => {
    expect(submitDecision(null, PAIR)).toEqual({ target: PAIR, refetch: false });
    expect(submitDecision(PAIR, { ...PAIR, evidenceId: "01HYYYYYYYYYYYYYYYYYYYYYYYYY" })).toEqual({
      target: { ...PAIR, evidenceId: "01HYYYYYYYYYYYYYYYYYYYYYYYYY" },
      refetch: false,
    });
  });

  it("the SAME pair resubmitted must refetch — a corrected admin token changes nothing in the query key", () => {
    expect(submitDecision(PAIR, PAIR)).toEqual({ target: PAIR, refetch: true });
  });

  it("an empty pair never fires a request", () => {
    expect(submitDecision(PAIR, { caseId: "", evidenceId: "" })).toEqual({ target: null, refetch: false });
  });
});

describe("displayOn (P3-010 — an error must not leave stale content on screen)", () => {
  it("shows the view only with data and no error", () => {
    expect(displayOn(false, true)).toBe(true);
    expect(displayOn(false, false)).toBe(false);
  });

  it("hides the view when the request failed — even if old data lingers in the cache", () => {
    expect(displayOn(true, true)).toBe(false);
    expect(displayOn(true, false)).toBe(false);
  });
});
