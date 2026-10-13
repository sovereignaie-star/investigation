/**
 * P2-010 — TR-013 contract test (T-RULE-06). Runs the Save Page Now transform
 * against a deterministic sim and asserts the snapshot finding.
 */
import { describe, expect, it } from "vitest";
import { createSimServer } from "@ir/sim/server";
import { savePageNow } from "./transforms/tr-013-save-page-now.ts";
import { runTransform } from "./runner.ts";

describe("TR-013 save-page-now", () => {
  it("emits a snapshot finding from the Location header", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/web\.archive\.org\/save\//,
        response: { status: 200, body: "", headers: { location: "https://web.archive.org/web/20240101000000/https://example.com/" } },
      },
    ]);
    const result = await runTransform(savePageNow, { transport: sim.transport, input: { url: "https://example.com/" } });
    expect(result.requestCount).toBe(1);
    expect(result.output.findings[0]).toEqual(
      expect.objectContaining({
        predicate: "has_archive_snapshot",
        objectType: "url",
        objectValue: "https://web.archive.org/web/20240101000000/https://example.com/",
      }),
    );
  });

  it("rejects an invalid URL before any request (fail-closed)", async () => {
    const sim = createSimServer([]);
    await expect(runTransform(savePageNow, { transport: sim.transport, input: { url: "not a url" } })).rejects.toThrow(/invalid URL/);
    expect(sim.requestCount()).toBe(0);
  });
});
