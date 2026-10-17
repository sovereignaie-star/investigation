/**
 * TR-043 contract test (T-RULE-06). Runs the VirusTotal reputation transform against a
 * deterministic sim and asserts exact findings. The manifest declares a secret (pinned mode);
 * the sim stands in for the egress gateway that would inject the `x-apikey` header — no real key
 * or connection is used. The path-template enforcement itself is pinned in
 * packages/egress/src/path-template.test.ts (the gateway-level contract); this file pins the
 * transform's own contract: subject routing, URL-encoding, the base64 url_id, the verdict
 * mapping, and every fail-closed attribution rule.
 */
import { describe, expect, it } from "vitest";
import { createSimServer } from "@ir/sim/server";
import { virustotalReputation } from "./transforms/tr-043-virustotal.ts";
import { runTransform } from "./runner.ts";

function vtResponse(dataOverrides: Record<string, unknown> = {}, attrOverrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    data: {
      id: "8.8.8.8",
      type: "ip_address",
      attributes: {
        reputation: 12,
        last_analysis_stats: { harmless: 80, malicious: 8, suspicious: 2, undetected: 10, timeout: 0 },
        ...attrOverrides,
      },
      ...dataOverrides,
    },
  });
}

describe("TR-043 virustotal-reputation", () => {
  it("emits the threat verdict on a flagged IP with the engines' share as confidence", async () => {
    const sim = createSimServer([
      { match: /^https:\/\/www\.virustotal\.com\/api\/v3\/ip_addresses\/8\.8\.8\.8$/, response: { status: 200, body: vtResponse() } },
    ]);
    const result = await runTransform(virustotalReputation, { transport: sim.transport, input: { ip: "8.8.8.8" } });
    expect(result.requestCount).toBe(1);
    expect(result.output.findings).toContainEqual(
      expect.objectContaining({
        predicate: "has_threat_verdict",
        objectType: "ipv4",
        objectValue: "8.8.8.8",
        confidence: 10 / 100,
      }),
    );
  });

  it("a clean result is a REAL result: the clean verdict is still claimed, carrying the counts", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/www\.virustotal\.com\/api\/v3\/ip_addresses\/1\.1\.1\.1$/,
        response: {
          status: 200,
          body: vtResponse(
            { id: "1.1.1.1" },
            { reputation: 320, last_analysis_stats: { harmless: 90, malicious: 0, suspicious: 0, undetected: 5, timeout: 0 } },
          ),
        },
      },
    ]);
    const result = await runTransform(virustotalReputation, { transport: sim.transport, input: { ip: "1.1.1.1" } });
    expect(result.output.findings).toContainEqual(
      expect.objectContaining({ predicate: "has_clean_verdict", objectType: "ipv4", objectValue: "1.1.1.1", confidence: 90 / 95 }),
    );
  });

  it("routes a domain subject to the domain template", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/www\.virustotal\.com\/api\/v3\/domains\/example\.com$/,
        response: { status: 200, body: vtResponse({ id: "example.com", type: "domain" }) },
      },
    ]);
    const result = await runTransform(virustotalReputation, { transport: sim.transport, input: { domain: "EXAMPLE.com" } });
    expect(result.requestCount).toBe(1);
    expect(result.output.findings).toContainEqual(
      expect.objectContaining({ predicate: "has_threat_verdict", objectType: "domain", objectValue: "example.com" }),
    );
  });

  it("routes a URL subject via the documented unpadded base64url identifier", async () => {
    const url = "https://example.com/bad";
    const urlId = Buffer.from(url, "utf8").toString("base64url");
    const sim = createSimServer([
      {
        // An exact string match — never a RegExp built from an interpolated string (the CodeQL rule).
        match: `https://www.virustotal.com/api/v3/urls/${urlId}`,
        response: { status: 200, body: vtResponse({ id: urlId, type: "url" }) },
      },
    ]);
    const result = await runTransform(virustotalReputation, { transport: sim.transport, input: { url } });
    expect(result.requestCount).toBe(1);
    expect(result.output.findings).toContainEqual(
      expect.objectContaining({ predicate: "has_threat_verdict", objectType: "url", objectValue: url }),
    );
  });

  it("routes a file-hash subject (md5/sha1/sha256) to the files template", async () => {
    const hash = "a".repeat(64);
    const sim = createSimServer([
      { match: `https://www.virustotal.com/api/v3/files/${hash}`, response: { status: 200, body: vtResponse({ id: hash, type: "file" }) } },
    ]);
    const result = await runTransform(virustotalReputation, { transport: sim.transport, input: { hash } });
    expect(result.requestCount).toBe(1);
    expect(result.output.findings).toContainEqual(
      expect.objectContaining({ predicate: "has_threat_verdict", objectType: "file_hash", objectValue: hash }),
    );
  });

  it("URL-encodes an IPv6 subject (colons are reserved in URIs)", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/www\.virustotal\.com\/api\/v3\/ip_addresses\/2001%3Adb8%3A%3A1$/,
        response: { status: 200, body: vtResponse({ id: "2001:db8::1" }) },
      },
    ]);
    const result = await runTransform(virustotalReputation, { transport: sim.transport, input: { ip: "2001:db8::1" } });
    expect(result.requestCount).toBe(1);
    expect(result.output.findings).toContainEqual(
      expect.objectContaining({ predicate: "has_threat_verdict", objectType: "ipv6", objectValue: "2001:db8::1" }),
    );
  });

  it("a response about a DIFFERENT subject is refused fail-closed — never attributed", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/www\.virustotal\.com\/api\/v3\/ip_addresses\/8\.8\.8\.8$/,
        response: { status: 200, body: vtResponse({ id: "9.9.9.9" }) },
      },
    ]);
    await expect(runTransform(virustotalReputation, { transport: sim.transport, input: { ip: "8.8.8.8" } })).rejects.toThrow(
      /returned a different subject/i,
    );
  });

  it("a malformed response (no data object) fails as a source error, not an empty success", async () => {
    const sim = createSimServer([
      { match: /^https:\/\/www\.virustotal\.com\/api\/v3\/ip_addresses\/8\.8\.8\.8$/, response: { status: 200, body: JSON.stringify({}) } },
    ]);
    await expect(runTransform(virustotalReputation, { transport: sim.transport, input: { ip: "8.8.8.8" } })).rejects.toThrow(
      /malformed response/i,
    );
  });

  it("fails closed on a non-200 status", async () => {
    const sim = createSimServer([
      { match: /^https:\/\/www\.virustotal\.com\/api\/v3\/ip_addresses\/8\.8\.8\.8$/, response: { status: 429, body: "{}" } },
    ]);
    await expect(runTransform(virustotalReputation, { transport: sim.transport, input: { ip: "8.8.8.8" } })).rejects.toThrow(/429/);
  });

  it("rejects a non-IP input before any request", async () => {
    const sim = createSimServer([]);
    await expect(runTransform(virustotalReputation, { transport: sim.transport, input: { ip: "not-an-ip" } })).rejects.toThrow(
      /is not a valid IP address/,
    );
    expect(sim.requestCount()).toBe(0);
  });

  it("rejects an invalid hash input before any request", async () => {
    const sim = createSimServer([]);
    await expect(runTransform(virustotalReputation, { transport: sim.transport, input: { hash: "zz".repeat(32) } })).rejects.toThrow(
      /is not an md5, sha1 or sha256 hash/,
    );
  });

  it("rejects a missing input before any request, and refuses two subjects at once", async () => {
    const sim = createSimServer([]);
    await expect(runTransform(virustotalReputation, { transport: sim.transport, input: {} })).rejects.toThrow(
      /exactly one of ip, domain, url or hash/,
    );
    await expect(
      runTransform(virustotalReputation, { transport: sim.transport, input: { ip: "8.8.8.8", domain: "example.com" } }),
    ).rejects.toThrow(/only one of ip, domain, url or hash/);
  });

  it("rejects a non-http(s) URL input before any request", async () => {
    const sim = createSimServer([]);
    await expect(runTransform(virustotalReputation, { transport: sim.transport, input: { url: "ftp://example.com" } })).rejects.toThrow(
      /only http\(s\) URLs/,
    );
  });
});
