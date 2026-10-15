/**
 * P2-012 — TR-033 contract test (T-RULE-06). Reverse image search links are
 * CONSTRUCTED, never fetched: no automatic upload of the image (LC-A, the
 * investigator opens the link manually). The transport is a noop that throws if
 * any request is attempted.
 *
 * Red first: this test was written before the transform existed and failed on the
 * missing module (the failing test for the right reason).
 */
import { describe, expect, it } from "vitest";
import { reverseImageLinks } from "./transforms/tr-033-reverse-image.ts";
import { runTransform } from "./runner.ts";
import type { HttpTransport } from "@ir/engine/transport";

const noopTransport: HttpTransport = {
  async fetch() {
    throw new Error("TR-033 must never make a network request");
  },
};

const IMAGE_URL = "https://example.com/photo.jpg";

describe("TR-033 reverse image links", () => {
  it("constructs manual-open links for each engine, encoded from the image URL", async () => {
    const result = await runTransform(reverseImageLinks, { transport: noopTransport, input: { url: IMAGE_URL } });
    expect(result.requestCount).toBe(0);
    const findings = result.output.findings;
    expect(findings).toHaveLength(3);
    for (const f of findings) {
      expect(f.objectType).toBe("url");
      expect(f.predicate).toBe("has_reverse_image_search");
      expect(f.objectValue).toContain(encodeURIComponent(IMAGE_URL));
      expect(f.derivedFrom).toBe("input");
      expect(f.evidence).toBeUndefined();
    }
    const engines = findings.map((f) => f.explanation);
    expect(engines.some((e) => e.includes("Google Lens"))).toBe(true);
    expect(engines.some((e) => e.includes("Yandex"))).toBe(true);
    expect(engines.some((e) => e.includes("TinEye"))).toBe(true);
  });

  it("links point at the engines' documented URL schemes, not at the image host", async () => {
    const result = await runTransform(reverseImageLinks, { transport: noopTransport, input: { url: IMAGE_URL } });
    const hosts = result.output.findings.map((f) => new URL(f.objectValue).host);
    expect(hosts).toEqual(expect.arrayContaining(["lens.google.com", "yandex.com", "tineye.com"]));
  });

  it("a non-http(s) input is rejected fail-closed before any link is built", async () => {
    await expect(runTransform(reverseImageLinks, { transport: noopTransport, input: { url: "javascript:alert(1)" } })).rejects.toThrow(
      /valid http\(s\) image URL/,
    );
    await expect(runTransform(reverseImageLinks, { transport: noopTransport, input: { url: "not a url" } })).rejects.toThrow(
      /valid http\(s\) image URL/,
    );
  });

  it("an empty URL is rejected (a URL is required)", async () => {
    await expect(runTransform(reverseImageLinks, { transport: noopTransport, input: {} })).rejects.toThrow(/image URL is required/);
  });
});
