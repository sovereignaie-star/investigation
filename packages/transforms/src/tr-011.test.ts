/**
 * P2-010 — TR-011 contract test (T-RULE-06). Runs the Wayback CDX transform
 * against a deterministic sim and asserts exact findings and failure paths.
 */
import { describe, expect, it } from "vitest";
import { createSimServer } from "@ir/sim/server";
import { waybackCdx } from "./transforms/tr-011-wayback-cdx.ts";
import { runTransform } from "./runner.ts";

describe("TR-011 wayback-cdx", () => {
  it("emits a snapshot finding per CDX row", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/web\.archive\.org\/cdx\/search\/cdx\?url=/,
        response: {
          status: 200,
          body: JSON.stringify([
            ["timestamp", "original", "statuscode"],
            ["20240101000000", "https://example.com/", "200"],
            ["20240201000000", "https://example.com/", "200"],
          ]),
        },
      },
    ]);
    const result = await runTransform(waybackCdx, { transport: sim.transport, input: { url: "https://example.com/" } });
    expect(result.requestCount).toBe(1);
    expect(result.output.findings).toHaveLength(2);
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
    await expect(runTransform(waybackCdx, { transport: sim.transport, input: { url: "not a url" } })).rejects.toThrow(/invalid URL/);
    expect(sim.requestCount()).toBe(0);
  });

  it("returns empty findings for an empty CDX response", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/web\.archive\.org\/cdx\/search\/cdx\?url=/,
        response: { status: 200, body: JSON.stringify([["timestamp", "original", "statuscode"]]) },
      },
    ]);
    const result = await runTransform(waybackCdx, { transport: sim.transport, input: { url: "https://example.com/" } });
    expect(result.output.findings).toHaveLength(0);
  });
});
