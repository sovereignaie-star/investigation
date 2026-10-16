/**
 * P2-012 — TR-034 contract test (T-RULE-06). Document metadata, LOCAL ONLY —
 * PDF part via pdfjs-dist (Apache-2.0, owner decision 2026-10-16; canvas-free
 * operation VERIFIED in this environment before adoption: text and metadata
 * extraction work with no `canvas` package installed — rendering is never
 * needed for this transform's contract).
 *
 * The input is a base64-encoded PDF; the transform extracts the document's
 * author, creation time, producing application and text — with ZERO network
 * requests (findings cite `derivedFrom: "input"`).
 *
 * Library behavior MEASURED 2026-10-16 (pdfjs-dist 6.4.299, Node, no canvas):
 *   - getDocument({ data: Uint8Array }) parses; Buffer is refused — the
 *     transform converts to Uint8Array itself;
 *   - getMetadata() returns Info (Author, CreationDate, Producer);
 *   - getTextContent() returns the text items per page.
 *
 * The test PDF is crafted in the helper (a minimal one-page PDF with an Info
 * dictionary: Author "Test Author", CreationDate D:20260102030405, Producer
 * "pdfjs-test", and the text "Investigation room test").
 *
 * Red first: this test was written before the transform existed and failed on
 * the missing module (the failing test for the right reason).
 */
import { describe, expect, it } from "vitest";
import { createSimServer } from "@ir/sim/server";
import { pdfMetadata } from "./transforms/tr-034-pdf-metadata.ts";
import { runTransform } from "./runner.ts";

/** The sim server's transport shape — the counting wrapper keeps it. */
type SimTransport = ReturnType<typeof createSimServer>["transport"];

/** A transport that counts every fetch: the local analysis must issue none. */
function counting(t: SimTransport): { transport: SimTransport; calls: () => number } {
  let n = 0;
  return {
    calls: () => n,
    transport: {
      ...t,
      fetch: (...args: Parameters<SimTransport["fetch"]>) => {
        n++;
        return t.fetch(...args);
      },
    },
  };
}

/** A minimal one-page PDF with an Info dictionary (verified against pdf.js). */
function craftPdf(): Buffer {
  const stream = "BT /F1 12 Tf 10 50 Td (Investigation room test) Tj ET";
  return Buffer.from(
    [
      "%PDF-1.4",
      "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
      "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
      "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj",
      `4 0 obj << /Length ${stream.length} >> stream`,
      stream,
      "endstream endobj",
      "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
      "6 0 obj << /Author (Test Author) /CreationDate (D:20260102030405) /Producer (pdfjs-test) >> endobj",
      "trailer << /Root 1 0 R /Info 6 0 R >>",
    ].join("\n"),
    "latin1",
  );
}

describe("TR-034 PDF document metadata (local, no network, no canvas)", () => {
  it("extracts author, date, application and text — zero requests, findings cite the input", async () => {
    const sim = createSimServer([]);
    const counted = counting(sim.transport);
    const result = await runTransform(pdfMetadata, { transport: counted.transport, input: { content: craftPdf().toString("base64") } });
    expect(result.requestCount).toBe(0);
    expect(counted.calls()).toBe(0);
    const findings = result.output.findings;
    expect(findings).toContainEqual(
      expect.objectContaining({
        predicate: "has_author",
        objectType: "author",
        objectValue: "Test Author",
        derivedFrom: "input",
      }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({
        predicate: "created_at_time",
        objectType: "date",
        objectValue: "2026-01-02 03:04:05",
        derivedFrom: "input",
      }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({
        predicate: "created_with",
        objectType: "application",
        objectValue: "pdfjs-test",
        derivedFrom: "input",
      }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({
        predicate: "contains_text",
        objectType: "text",
        objectValue: "Investigation room test",
        derivedFrom: "input",
      }),
    );
    for (const f of findings) expect(f.evidence).toBeUndefined();
  });

  it("a PDF without an Info dictionary yields the text finding only (nothing guessed)", async () => {
    const sim = createSimServer([]);
    const stream = "BT /F1 12 Tf 10 50 Td (Plain text only) Tj ET";
    const pdf = Buffer.from(
      [
        "%PDF-1.4",
        "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
        "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
        "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj",
        `4 0 obj << /Length ${stream.length} >> stream`,
        stream,
        "endstream endobj",
        "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
        "trailer << /Root 1 0 R >>",
      ].join("\n"),
      "latin1",
    );
    const result = await runTransform(pdfMetadata, { transport: sim.transport, input: { content: pdf.toString("base64") } });
    expect(result.requestCount).toBe(0);
    const findings = result.output.findings;
    expect(findings).toHaveLength(1);
    expect(findings).toContainEqual(
      expect.objectContaining({ predicate: "contains_text", objectType: "text", objectValue: "Plain text only" }),
    );
  });

  it("rejects non-PDF bytes before anything runs (fail-closed, zero transport calls)", async () => {
    const sim = createSimServer([]);
    const counted = counting(sim.transport);
    for (const bad of ["aGVsbG8gd29ybGQgbm90IGEgcGRm", ""]) {
      await expect(runTransform(pdfMetadata, { transport: counted.transport, input: { content: bad } })).rejects.toThrow(
        /not a valid PDF|is required/,
      );
    }
    expect(counted.calls()).toBe(0);
  });
});
