/**
 * TR-046 contract test (T-RULE-06). Runs the OTX pulses transform against a deterministic sim
 * and asserts exact findings. The manifest declares a secret (pinned mode); the sim stands in for
 * the egress gateway that would inject the `X-OTX-API-KEY` header — no real key or connection is
 * used. The path-template enforcement itself is pinned in packages/egress/src/path-template.test.ts;
 * this file pins the transform's own contract: indicator routing, the pulse findings, the emission
 * bound, and every fail-closed attribution rule.
 
 * NOTE on sim `match` values (P2-026): they are fully-escaped RegExp LITERALS (anchored exact
 * match, every dot/question mark escaped), not plain URL strings — CodeQL's
 * js/incomplete-hostname-regexp flags plain URL strings that flow into the sim server's
 * `new RegExp` (wildcard branch) as unescaped-hostname regexes; an escaped literal is not
 * flagged (precedent: tr-052.test.ts collinfo) and the runtime semantics are identical (the
 * sim's plain-string branch is exact equality).*/
import { describe, expect, it } from "vitest";
import { createSimServer } from "@ir/sim/server";
import { otxPulses } from "./transforms/tr-046-otx-pulses.ts";
import { runTransform } from "./runner.ts";

function otxResponse(pulses: Array<{ id: string; name: string; author_name?: string }>, count?: number): string {
  return JSON.stringify({
    indicator: "8.8.8.8",
    pulse_info: { count: count ?? pulses.length, pulses },
  });
}

describe("TR-046 otx-pulses", () => {
  it("emits one referenced_in_pulse finding per pulse on the indicator", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/otx\.alienvault\.com\/api\/v1\/indicators\/IPv4\/8\.8\.8\.8\/general$/,
        response: {
          status: 200,
          body: otxResponse([
            { id: "pulse-1", name: "Malicious infrastructure campaign", author_name: "researcher-a" },
            { id: "pulse-2", name: "DNS hijack set" },
          ]),
        },
      },
    ]);
    const result = await runTransform(otxPulses, { transport: sim.transport, input: { ip: "8.8.8.8" } });
    expect(result.requestCount).toBe(1);
    const findings = result.output.findings;
    expect(findings).toHaveLength(2);
    expect(findings[0]).toMatchObject({
      predicate: "referenced_in_pulse",
      objectType: "ipv4",
      objectValue: "8.8.8.8",
      confidence: 0.8,
    });
    expect(findings[0]?.explanation).toContain("Malicious infrastructure campaign");
    expect(findings[0]?.explanation).toContain("researcher-a");
  });

  it("routes a domain subject to the domain template (lowercased)", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/otx\.alienvault\.com\/api\/v1\/indicators\/domain\/example\.com\/general$/,
        response: { status: 200, body: otxResponse([{ id: "p", name: "n" }]).replace('"8.8.8.8"', '"example.com"') },
      },
    ]);
    const result = await runTransform(otxPulses, { transport: sim.transport, input: { domain: "EXAMPLE.com" } });
    expect(result.requestCount).toBe(1);
    expect(result.output.findings[0]).toMatchObject({ objectType: "domain", objectValue: "example.com" });
  });

  it("routes a hostname subject to the hostname template and a file hash to the file template", async () => {
    const hash = "b".repeat(40);
    const sim = createSimServer([
      {
        match: /^https:\/\/otx\.alienvault\.com\/api\/v1\/indicators\/hostname\/dns\.google\/general$/,
        response: { status: 200, body: otxResponse([{ id: "p", name: "n" }]).replace('"8.8.8.8"', '"dns.google"') },
      },
      {
        match: `https://otx.alienvault.com/api/v1/indicators/file/${hash}/general`,
        response: { status: 200, body: otxResponse([{ id: "p", name: "n" }]).replace('"8.8.8.8"', `"${hash}"`) },
      },
    ]);
    const a = await runTransform(otxPulses, { transport: sim.transport, input: { hostname: "dns.google" } });
    expect(a.output.findings[0]).toMatchObject({ objectType: "hostname", objectValue: "dns.google" });
    const b = await runTransform(otxPulses, { transport: sim.transport, input: { hash } });
    expect(b.output.findings[0]).toMatchObject({ objectType: "file_hash", objectValue: hash });
  });

  it("URL-encodes an IPv6 subject (colons are reserved in URIs)", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/otx\.alienvault\.com\/api\/v1\/indicators\/IPv6\/2001%3Adb8%3A%3A1\/general$/,
        response: { status: 200, body: otxResponse([{ id: "p", name: "n" }]).replace('"8.8.8.8"', '"2001:db8::1"') },
      },
    ]);
    const result = await runTransform(otxPulses, { transport: sim.transport, input: { ip: "2001:db8::1" } });
    expect(result.requestCount).toBe(1);
    expect(result.output.findings[0]).toMatchObject({ objectType: "ipv6", objectValue: "2001:db8::1" });
  });

  it("bounds the pulse findings at 10 and carries the source's own total in the last claim", async () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ id: `pulse-${i}`, name: `pulse ${i}` }));
    const sim = createSimServer([
      {
        match: /^https:\/\/otx\.alienvault\.com\/api\/v1\/indicators\/IPv4\/8\.8\.8\.8\/general$/,
        response: { status: 200, body: otxResponse(many, 23) },
      },
    ]);
    const result = await runTransform(otxPulses, { transport: sim.transport, input: { ip: "8.8.8.8" } });
    const findings = result.output.findings;
    expect(findings).toHaveLength(10);
    expect(findings[9]?.explanation).toContain("and 13 more pulses");
  });

  it("no pulses is a real result: no findings, no error", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/otx\.alienvault\.com\/api\/v1\/indicators\/IPv4\/1\.1\.1\.1\/general$/,
        response: { status: 200, body: otxResponse([]).replace('"8.8.8.8"', '"1.1.1.1"') },
      },
    ]);
    const result = await runTransform(otxPulses, { transport: sim.transport, input: { ip: "1.1.1.1" } });
    expect(result.output.findings).toEqual([]);
  });

  it("a response about a DIFFERENT indicator is refused fail-closed — never attributed", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/otx\.alienvault\.com\/api\/v1\/indicators\/IPv4\/8\.8\.8\.8\/general$/,
        response: { status: 200, body: otxResponse([{ id: "p", name: "n" }]).replace('"indicator":"8.8.8.8"', '"indicator":"9.9.9.9"') },
      },
    ]);
    await expect(runTransform(otxPulses, { transport: sim.transport, input: { ip: "8.8.8.8" } })).rejects.toThrow(
      /returned a different indicator/i,
    );
  });

  it("a malformed response (no pulse_info) yields no findings, not an error", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/otx\.alienvault\.com\/api\/v1\/indicators\/IPv4\/8\.8\.8\.8\/general$/,
        response: { status: 200, body: JSON.stringify({ some: "other shape" }) },
      },
    ]);
    const result = await runTransform(otxPulses, { transport: sim.transport, input: { ip: "8.8.8.8" } });
    expect(result.output.findings).toEqual([]);
  });

  it("fails closed on a non-200 status", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/otx\.alienvault\.com\/api\/v1\/indicators\/IPv4\/8\.8\.8\.8\/general$/,
        response: { status: 403, body: "{}" },
      },
    ]);
    await expect(runTransform(otxPulses, { transport: sim.transport, input: { ip: "8.8.8.8" } })).rejects.toThrow(/403/);
  });

  it("rejects a non-IP, non-domain input before any request", async () => {
    const sim = createSimServer([]);
    await expect(runTransform(otxPulses, { transport: sim.transport, input: { ip: "not-an-ip" } })).rejects.toThrow(
      /is not a valid IP address/,
    );
    expect(sim.requestCount()).toBe(0);
  });

  it("rejects a missing input before any request, and refuses two subjects at once", async () => {
    const sim = createSimServer([]);
    await expect(runTransform(otxPulses, { transport: sim.transport, input: {} })).rejects.toThrow(
      /exactly one of ip, domain, hostname or hash/,
    );
    await expect(runTransform(otxPulses, { transport: sim.transport, input: { ip: "8.8.8.8", domain: "example.com" } })).rejects.toThrow(
      /only one of ip, domain, hostname or hash/,
    );
    expect(sim.requestCount()).toBe(0);
  });
});
