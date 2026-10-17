/**
 * TR-052 contract test (T-RULE-06). Runs the Common Crawl index transform against a deterministic
 * sim: the collinfo.json discovery request (the fixed, keyless, documented collection list) then
 * the newest collection's CDX API query for the domain. No key exists for this source at all
 * (LC-B, public) — the sim stands in for the egress gateway.
 */
import { describe, expect, it } from "vitest";
import { createSimServer } from "@ir/sim/server";
import { commonCrawlIndex } from "./transforms/tr-052-common-crawl.ts";
import { runTransform } from "./runner.ts";

/** The documented collinfo.json shape: newest-first array of collection records. */
const COLLINFO = JSON.stringify([
  {
    id: "CC-MAIN-2026-39",
    name: "September 2026 Index",
    timegate: "https://index.commoncrawl.org/CC-MAIN-2026-39/",
    "cdx-api": "https://index.commoncrawl.org/CC-MAIN-2026-39-index",
  },
  {
    id: "CC-MAIN-2026-25",
    name: "June 2026 Index",
    "cdx-api": "https://index.commoncrawl.org/CC-MAIN-2026-25-index",
  },
]);

/** CDXJ lines as the source documents them: "<urlkey> <timestamp> {json}" — with output=json the
 *  full line is JSON (a JSON string per line). */
function cdxBody(lines: string[]): string {
  return lines.map((l) => JSON.stringify(l)).join("\n");
}

const LINE_1 = 'com,example)/ 20260812000000 {"url": "http://example.com/", "mime": "text/html", "status": "200", "digest": "sha1:aaa"}';
const LINE_2 =
  'com,example)/ 20260815000000 {"url": "https://www.example.com/about", "mime": "text/html", "status": "200", "digest": "sha1:bbb"}';

/** The documented CDX query for the newest collection (matchType=domain, status:200, capped). */
const CDX_URL =
  "https://index.commoncrawl.org/CC-MAIN-2026-39-index?url=example.com&matchType=domain&output=json&filter=status:200&limit=100";

// P2-026 (CodeQL): the sim match is a fully-escaped RegExp LITERAL (anchored exact match) — a
// plain URL string flowing into the sim server's `new RegExp` trips js/incomplete-hostname-regexp;
// CDX_URL stays a string because the assertion below compares it as data. JS nuance (documented):
// `$` also matches before a trailing newline; no URL in this test contains one, so the passing
// suite pins the equivalence on every exercised path.
const CDX_URL_MATCH =
  /^https:\/\/index\.commoncrawl\.org\/CC-MAIN-2026-39-index\?url=example\.com&matchType=domain&output=json&filter=status:200&limit=100$/;

describe("TR-052 common-crawl-index", () => {
  it("discovers the newest collection via collinfo.json, then emits a finding per capture of the domain (timestamp/status/mime in the explanation)", async () => {
    const sim = createSimServer([
      { match: /^https:\/\/index\.commoncrawl\.org\/collinfo\.json$/, response: { status: 200, body: COLLINFO } },
      {
        // An exact string match (no regex) — the sim server compares the URL literally; this also
        // keeps code scanners from seeing a regex built from an interpolated string.
        match: CDX_URL_MATCH,
        response: { status: 200, body: cdxBody([LINE_1, LINE_2]) },
      },
    ]);
    const result = await runTransform(commonCrawlIndex, { transport: sim.transport, input: { domain: "example.com" } });
    expect(result.requestCount).toBe(2);
    const findings = result.output.findings;
    expect(findings).toContainEqual(
      expect.objectContaining({ predicate: "has_crawl_capture", objectType: "url", objectValue: "http://example.com/" }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({ predicate: "has_crawl_capture", objectType: "url", objectValue: "https://www.example.com/about" }),
    );
    expect(findings.find((f) => f.objectValue === "http://example.com/")?.explanation).toContain("20260812000000");
    expect(findings.find((f) => f.objectValue === "http://example.com/")?.explanation).toContain("2026-39");
  });

  it("sends ONLY the documented query parameters (url, matchType, output, filter, limit) to the newest collection", async () => {
    const sim = createSimServer([
      { match: /^https:\/\/index\.commoncrawl\.org\/collinfo\.json$/, response: { status: 200, body: COLLINFO } },
      {
        match: /^https:\/\/index\.commoncrawl\.org\/CC-MAIN-2026-39-index\?url=example\.com/,
        response: { status: 200, body: cdxBody([]) },
      },
    ]);
    const urls: string[] = [];
    const wrapped = {
      fetch: async (req: { url: string }, signal: AbortSignal) => {
        urls.push(req.url);
        return sim.transport.fetch(req as never, signal);
      },
    };
    await runTransform(commonCrawlIndex, { transport: wrapped as never, input: { domain: "example.com" } });
    expect(urls).toEqual(["https://index.commoncrawl.org/collinfo.json", CDX_URL]);
  });

  it("an empty CDX body is a real negative: empty findings, no error (no captures)", async () => {
    const sim = createSimServer([
      { match: /^https:\/\/index\.commoncrawl\.org\/collinfo\.json$/, response: { status: 200, body: COLLINFO } },
      { match: /^https:\/\/index\.commoncrawl\.org\/CC-MAIN-2026-39-index\?url=nowhere\.example/, response: { status: 200, body: "" } },
    ]);
    const result = await runTransform(commonCrawlIndex, { transport: sim.transport, input: { domain: "nowhere.example" } });
    expect(result.output.findings).toHaveLength(0);
    expect(result.requestCount).toBe(2);
  });

  it("a malformed collinfo (not an array) fails as a source error, not an empty success", async () => {
    const sim = createSimServer([
      { match: /^https:\/\/index\.commoncrawl\.org\/collinfo\.json$/, response: { status: 200, body: JSON.stringify({}) } },
    ]);
    await expect(runTransform(commonCrawlIndex, { transport: sim.transport, input: { domain: "example.com" } })).rejects.toThrow(
      /Common Crawl/,
    );
  });

  it("a collinfo entry without a cdx-api field is a source error — nothing is guessed", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/index\.commoncrawl\.org\/collinfo\.json$/,
        response: { status: 200, body: JSON.stringify([{ id: "CC-MAIN-2026-39" }]) },
      },
    ]);
    await expect(runTransform(commonCrawlIndex, { transport: sim.transport, input: { domain: "example.com" } })).rejects.toThrow(
      /Common Crawl/,
    );
  });

  it("a cdx-api on a DIFFERENT host is refused fail-closed — never followed", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/index\.commoncrawl\.org\/collinfo\.json$/,
        response: {
          status: 200,
          body: JSON.stringify([{ id: "CC-MAIN-2026-39", "cdx-api": "https://evil.example.com/CC-MAIN-2026-39-index" }]),
        },
      },
    ]);
    await expect(runTransform(commonCrawlIndex, { transport: sim.transport, input: { domain: "example.com" } })).rejects.toThrow(
      /different host|Common Crawl/i,
    );
  });

  it("a malformed CDXJ line is skipped, not emitted as a finding", async () => {
    const sim = createSimServer([
      { match: /^https:\/\/index\.commoncrawl\.org\/collinfo\.json$/, response: { status: 200, body: COLLINFO } },
      {
        match: /^https:\/\/index\.commoncrawl\.org\/CC-MAIN-2026-39-index\?url=example\.com/,
        response: { status: 200, body: cdxBody(["not a cdxj line at all", LINE_1]) },
      },
    ]);
    const result = await runTransform(commonCrawlIndex, { transport: sim.transport, input: { domain: "example.com" } });
    expect(result.output.findings).toHaveLength(1);
  });

  it("a capture row whose JSON has no url or timestamp is skipped", async () => {
    const sim = createSimServer([
      { match: /^https:\/\/index\.commoncrawl\.org\/collinfo\.json$/, response: { status: 200, body: COLLINFO } },
      {
        match: /^https:\/\/index\.commoncrawl\.org\/CC-MAIN-2026-39-index\?url=example\.com/,
        response: { status: 200, body: cdxBody(['com,example)/ 20260812000000 {"mime": "text/html", "status": "200"}']) },
      },
    ]);
    const result = await runTransform(commonCrawlIndex, { transport: sim.transport, input: { domain: "example.com" } });
    expect(result.output.findings).toHaveLength(0);
  });

  it("fails closed on a non-200 from collinfo", async () => {
    const sim = createSimServer([{ match: /^https:\/\/index\.commoncrawl\.org\/collinfo\.json$/, response: { status: 503, body: "" } }]);
    await expect(runTransform(commonCrawlIndex, { transport: sim.transport, input: { domain: "example.com" } })).rejects.toThrow(
      /Common Crawl/,
    );
  });

  it("fails closed on a non-200 from the CDX query", async () => {
    const sim = createSimServer([
      { match: /^https:\/\/index\.commoncrawl\.org\/collinfo\.json$/, response: { status: 200, body: COLLINFO } },
      { match: /^https:\/\/index\.commoncrawl\.org\/CC-MAIN-2026-39-index\?url=example\.com/, response: { status: 429, body: "" } },
    ]);
    await expect(runTransform(commonCrawlIndex, { transport: sim.transport, input: { domain: "example.com" } })).rejects.toThrow(
      /Common Crawl/,
    );
  });

  it("rejects a non-domain input before any request", async () => {
    const sim = createSimServer([]);
    await expect(runTransform(commonCrawlIndex, { transport: sim.transport, input: { domain: "not a domain" } })).rejects.toThrow(/domain/);
    expect(sim.requestCount()).toBe(0);
  });

  it("rejects a missing input field before any request", async () => {
    const sim = createSimServer([]);
    await expect(runTransform(commonCrawlIndex, { transport: sim.transport, input: {} })).rejects.toThrow(/domain is required/);
    expect(sim.requestCount()).toBe(0);
  });
});
