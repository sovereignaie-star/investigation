/**
 * P2-009 — TR-009 contract test (T-RULE-06). Runs the urlscan transform
 * against a deterministic sim and asserts exact findings. The manifest
 * declares a secret (pinned mode); the sim stands in for the egress gateway
 * that would inject the key — no real key or connection is used.
 */
import { describe, expect, it } from "vitest";
import { createSimServer } from "@ir/sim/server";
import { urlscanSearch } from "./transforms/tr-009-urlscan.ts";
import { runTransform } from "./runner.ts";

describe("TR-009 urlscan-search", () => {
  it("emits scanned-URL and subdomain findings", async () => {
    const sim = createSimServer([
      {
        match: "https://urlscan.io/api/v1/search/?q=domain:example.com",
        response: {
          status: 200,
          body: JSON.stringify({
            results: [
              { page: { url: "https://example.com/", domain: "example.com" } },
              { page: { url: "https://www.example.com/", domain: "www.example.com" } },
            ],
          }),
        },
      },
    ]);
    const result = await runTransform(urlscanSearch, { transport: sim.transport, input: { url: "https://example.com/" } });
    expect(result.requestCount).toBe(1);
    const findings = result.output.findings;
    expect(findings).toContainEqual(
      expect.objectContaining({ predicate: "has_scan", objectType: "url", objectValue: "https://example.com/" }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({ predicate: "has_scan", objectType: "url", objectValue: "https://www.example.com/" }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({ predicate: "has_subdomain", objectType: "hostname", objectValue: "www.example.com" }),
    );
  });

  it("rejects an invalid URL before any request", async () => {
    const sim = createSimServer([]);
    await expect(runTransform(urlscanSearch, { transport: sim.transport, input: { url: "not a url" } })).rejects.toThrow(/invalid URL/);
    expect(sim.requestCount()).toBe(0);
  });

  it("returns an empty finding set for no results", async () => {
    const sim = createSimServer([
      { match: "https://urlscan.io/api/v1/search/?q=domain:example.com", response: { status: 200, body: JSON.stringify({ results: [] }) } },
    ]);
    const result = await runTransform(urlscanSearch, { transport: sim.transport, input: { url: "https://example.com/" } });
    expect(result.output.findings).toHaveLength(0);
  });
});
