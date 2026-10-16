/**
 * TR-044 contract test (T-RULE-06). Runs the AbuseIPDB check transform against a deterministic
 * sim and asserts exact findings. The manifest declares a secret (pinned mode); the sim stands in
 * for the egress gateway that would inject the `Key` header — no real key or connection is used.
 */
import { describe, expect, it } from "vitest";
import { createSimServer } from "@ir/sim/server";
import type { TransportRequest } from "@ir/engine/transport";
import { abuseIpDbCheck } from "./transforms/tr-044-abuseipdb.ts";
import { runTransform } from "./runner.ts";

function abuseIpDbResponse(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    data: {
      ipAddress: "8.8.8.8",
      isPublic: true,
      ipVersion: 4,
      isWhitelisted: false,
      abuseConfidenceScore: 100,
      countryCode: "US",
      usageType: "Content Delivery Network",
      isp: "Google LLC",
      domain: "google.com",
      hostnames: ["dns.google"],
      isTor: false,
      totalReports: 2741,
      numDistinctUsers: 553,
      lastReportedAt: "2026-10-15T00:00:00Z",
      ...overrides,
    },
  });
}

describe("TR-044 abuseipdb-check", () => {
  it("emits the abuse score on the IP and its ISP/domain/hostname/country context", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/api\.abuseipdb\.com\/api\/v2\/check\?ipAddress=8\.8\.8\.8$/,
        response: { status: 200, body: abuseIpDbResponse() },
      },
    ]);
    const result = await runTransform(abuseIpDbCheck, { transport: sim.transport, input: { ip: "8.8.8.8" } });
    expect(result.requestCount).toBe(1);
    const findings = result.output.findings;
    expect(findings).toContainEqual(
      expect.objectContaining({
        predicate: "has_abuse_score",
        objectType: "ipv4",
        objectValue: "8.8.8.8",
        confidence: 1,
      }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({ predicate: "hosted_by", objectType: "organization", objectValue: "Google LLC" }),
    );
    expect(findings).toContainEqual(expect.objectContaining({ predicate: "has_domain", objectType: "domain", objectValue: "google.com" }));
    expect(findings).toContainEqual(
      expect.objectContaining({ predicate: "has_hostname", objectType: "hostname", objectValue: "dns.google" }),
    );
    expect(findings).toContainEqual(expect.objectContaining({ predicate: "located_in_country", objectType: "country", objectValue: "US" }));
  });

  it("sends ONLY the ipAddress query parameter (no maxAgeInDays, no verbose)", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/api\.abuseipdb\.com\/api\/v2\/check\?ipAddress=8\.8\.8\.8$/,
        response: { status: 200, body: abuseIpDbResponse() },
      },
    ]);
    const urls: string[] = [];
    const wrapped = {
      fetch: async (req: TransportRequest, signal: AbortSignal) => {
        urls.push(req.url);
        return sim.transport.fetch(req, signal);
      },
    };
    await runTransform(abuseIpDbCheck, { transport: wrapped, input: { ip: "8.8.8.8" } });
    expect(urls).toHaveLength(1);
    expect(urls[0]).toBe("https://api.abuseipdb.com/api/v2/check?ipAddress=8.8.8.8");
  });

  it("marks a Tor exit node on the IP itself", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/api\.abuseipdb\.com\/api\/v2\/check\?ipAddress=185\.220\.101\.1$/,
        response: { status: 200, body: abuseIpDbResponse({ ipAddress: "185.220.101.1", isTor: true }) },
      },
    ]);
    const result = await runTransform(abuseIpDbCheck, { transport: sim.transport, input: { ip: "185.220.101.1" } });
    expect(result.output.findings).toContainEqual(
      expect.objectContaining({
        predicate: "is_tor_exit",
        objectType: "ipv4",
        objectValue: "185.220.101.1",
        confidence: 0.9,
      }),
    );
  });

  it("URL-encodes an IPv6 subject (colons are reserved in URIs)", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/api\.abuseipdb\.com\/api\/v2\/check\?ipAddress=2001%3Adb8%3A%3A1$/,
        response: { status: 200, body: abuseIpDbResponse({ ipAddress: "2001:db8::1", ipVersion: 6 }) },
      },
    ]);
    const result = await runTransform(abuseIpDbCheck, { transport: sim.transport, input: { ip: "2001:db8::1" } });
    expect(result.requestCount).toBe(1);
    expect(result.output.findings).toContainEqual(
      expect.objectContaining({ predicate: "has_abuse_score", objectType: "ipv6", objectValue: "2001:db8::1" }),
    );
  });

  it("emits no findings when the source returns a zero-score clean report", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/api\.abuseipdb\.com\/api\/v2\/check\?ipAddress=1\.1\.1\.1$/,
        response: {
          status: 200,
          body: abuseIpDbResponse({
            ipAddress: "1.1.1.1",
            abuseConfidenceScore: 0,
            totalReports: 0,
            numDistinctUsers: 0,
            usageType: "Content Delivery Network",
            isp: "APNIC Labs",
            domain: "one.one",
            hostnames: ["one.one"],
            isTor: false,
          }),
        },
      },
    ]);
    const result = await runTransform(abuseIpDbCheck, { transport: sim.transport, input: { ip: "1.1.1.1" } });
    // Context findings (ISP/domain/hostname/country) still stand; the abuse-score claim does not.
    expect(result.output.findings.find((f) => f.predicate === "has_abuse_score")).toBeUndefined();
    expect(result.output.findings.find((f) => f.predicate === "is_tor_exit")).toBeUndefined();
  });

  it("fails closed on a non-200 status", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/api\.abuseipdb\.com\/api\/v2\/check\?ipAddress=8\.8\.8\.8$/,
        response: { status: 429, body: "" },
      },
    ]);
    await expect(runTransform(abuseIpDbCheck, { transport: sim.transport, input: { ip: "8.8.8.8" } })).rejects.toThrow(/AbuseIPDB check/);
  });

  it("rejects a non-IP input before any request", async () => {
    const sim = createSimServer([]);
    await expect(runTransform(abuseIpDbCheck, { transport: sim.transport, input: { ip: "not an ip" } })).rejects.toThrow(/valid IP/);
    expect(sim.requestCount()).toBe(0);
  });

  it("rejects a missing input field before any request", async () => {
    const sim = createSimServer([]);
    await expect(runTransform(abuseIpDbCheck, { transport: sim.transport, input: {} })).rejects.toThrow(/ip is required/);
    expect(sim.requestCount()).toBe(0);
  });
});
