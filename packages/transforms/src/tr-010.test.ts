/**
 * P2-004 — TR-010 contract test (T-RULE-06). Runs the example transform against a
 * deterministic fake transport and asserts the exact findings and evidence. The
 * real-response snapshot (redacted) is added when the transform is wired to @ir/sim.
 */
import { describe, expect, it } from "vitest";
import { httpScan } from "./transforms/tr-010-http-scan.ts";
import { runTransform } from "./runner.ts";
import type { HttpTransport } from "@ir/engine/transport";

function fakeTransport(responses: Array<{ status: number; body?: string; headers?: Record<string, string> }> = []): HttpTransport {
  return {
    async fetch(_req) {
      const r = responses.shift() ?? { status: 200, body: "" };
      return { status: r.status, body: r.body ?? "", headers: r.headers };
    },
  };
}

describe("TR-010 http-scan", () => {
  it("reports the HTTP status and fingerprints technologies from headers", async () => {
    const result = await runTransform(httpScan, {
      transport: fakeTransport([
        {
          status: 200,
          body: "<html></html>",
          headers: { "content-type": "text/html", server: "nginx", "x-powered-by": "Express" },
        },
      ]),
      input: { url: "https://example.com/" },
    });
    expect(result.requestCount).toBe(1);
    expect(result.evidence[0].url).toBe("https://example.com/");
    expect(result.evidence[0].status).toBe(200);
    const findings = result.output.findings;
    expect(findings[0]).toMatchObject({ predicate: "has_http_response", objectType: "http_status", objectValue: "200" });
    expect(findings).toContainEqual(
      expect.objectContaining({ predicate: "has_technology", objectType: "technology", objectValue: "server: nginx" }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({ predicate: "has_technology", objectType: "technology", objectValue: "x-powered-by: Express" }),
    );
  });

  it("rejects a non-http(s) URL (T-RULE-02)", async () => {
    await expect(runTransform(httpScan, { transport: fakeTransport(), input: { url: "ftp://example.com/" } })).rejects.toThrow(
      /unsupported protocol/,
    );
  });

  it("records an empty finding set explicitly for a bare response (T-RULE-05)", async () => {
    const result = await runTransform(httpScan, {
      transport: fakeTransport([{ status: 204, body: "" }]),
      input: { url: "https://example.com/" },
    });
    expect(result.output.findings).toHaveLength(1); // the status finding is always present
    expect(result.evidence).toHaveLength(1);
  });
});
