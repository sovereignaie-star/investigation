/**
 * P2-010 — TR-012 contract test (T-RULE-06). Runs the WARC archive transform
 * against a deterministic sim and asserts the content hash finding.
 */
import { describe, expect, it } from "vitest";
import { createSimServer } from "@ir/sim/server";
import { warcArchive } from "./transforms/tr-012-warc-archive.ts";
import { runTransform } from "./runner.ts";

describe("TR-012 warc-archive", () => {
  it("emits a content hash and snapshot finding for a fetched page", async () => {
    const sim = createSimServer([{ match: /^https:\/\/example\.com\/$/, response: { status: 200, body: "hello world" } }]);
    const result = await runTransform(warcArchive, { transport: sim.transport, input: { url: "https://example.com/" } });
    expect(result.requestCount).toBe(1);
    const findings = result.output.findings;
    expect(findings).toContainEqual(expect.objectContaining({ predicate: "has_content_hash", objectType: "sha256_hash" }));
    expect(findings).toContainEqual(
      expect.objectContaining({ predicate: "has_archive_snapshot", objectType: "url", objectValue: "https://example.com/" }),
    );
    // SHA-256 of "hello world"
    const hash = findings.find((f) => f.predicate === "has_content_hash")?.objectValue;
    expect(hash).toBe("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
  });

  it("rejects an invalid URL before any request (fail-closed)", async () => {
    const sim = createSimServer([]);
    await expect(runTransform(warcArchive, { transport: sim.transport, input: { url: "not a url" } })).rejects.toThrow(/invalid URL/);
    expect(sim.requestCount()).toBe(0);
  });
});
