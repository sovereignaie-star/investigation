/**
 * TR-045 contract test (T-RULE-06). Runs the GreyNoise classification transform against a
 * deterministic sim and asserts exact findings. The manifest declares a secret (pinned mode); the
 * sim stands in for the egress gateway that would inject the `key` header — no real key or
 * connection is used. The path-template enforcement itself is pinned in
 * packages/egress/src/path-template.test.ts; this file pins the transform's own contract.
 
 * NOTE on sim `match` values (P2-026): they are fully-escaped RegExp LITERALS (anchored exact
 * match, every dot/question mark escaped), not plain URL strings — CodeQL's
 * js/incomplete-hostname-regexp flags plain URL strings that flow into the sim server's
 * `new RegExp` (wildcard branch) as unescaped-hostname regexes; an escaped literal is not
 * flagged (precedent: tr-052.test.ts collinfo) and the runtime semantics are EQUIVALENT for
 * these fixed URLs (the sim's plain-string branch is exact equality). One documented JS
 * nuance: `$` also matches before a trailing newline; no URL in these tests contains one, so
 * the passing suite pins the equivalence on every exercised path.*/
import { describe, expect, it } from "vitest";
import { createSimServer } from "@ir/sim/server";
import { greyNoiseClassification } from "./transforms/tr-045-greynoise.ts";
import { runTransform } from "./runner.ts";

function gnResponse(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    ip: "45.83.66.10",
    noise: true,
    riot: false,
    classification: "unknown",
    name: "unknown",
    link: "https://viz.greynoise.io/ip/45.83.66.10",
    last_seen: "2026-10-15",
    message: [],
    ...overrides,
  });
}

describe("TR-045 greynoise-classification", () => {
  it("emits the mass-scanner claim when the source reports noise", async () => {
    const sim = createSimServer([
      { match: /^https:\/\/api\.greynoise\.io\/v3\/community\/45\.83\.66\.10$/, response: { status: 200, body: gnResponse() } },
    ]);
    const result = await runTransform(greyNoiseClassification, { transport: sim.transport, input: { ip: "45.83.66.10" } });
    expect(result.requestCount).toBe(1);
    expect(result.output.findings).toContainEqual(
      expect.objectContaining({
        predicate: "is_mass_scanner",
        objectType: "ipv4",
        objectValue: "45.83.66.10",
        confidence: 0.9,
      }),
    );
  });

  it("emits the benign classification and the named service for a RIOT address", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/api\.greynoise\.io\/v3\/community\/8\.8\.8\.8$/,
        response: {
          status: 200,
          body: gnResponse({
            ip: "8.8.8.8",
            noise: false,
            riot: true,
            classification: "benign",
            name: "Google LLC",
            last_seen: "2026-10-16",
          }),
        },
      },
    ]);
    const result = await runTransform(greyNoiseClassification, { transport: sim.transport, input: { ip: "8.8.8.8" } });
    const findings = result.output.findings;
    expect(findings).toContainEqual(
      expect.objectContaining({ predicate: "is_classified_benign", objectType: "ipv4", objectValue: "8.8.8.8", confidence: 0.8 }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({ predicate: "operates_service", objectType: "organization", objectValue: "Google LLC", confidence: 0.9 }),
    );
    expect(findings.some((f) => f.predicate === "is_mass_scanner")).toBe(false);
  });

  it("emits the malicious classification when the source reports one", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/api\.greynoise\.io\/v3\/community\/185\.220\.101\.1$/,
        response: { status: 200, body: gnResponse({ ip: "185.220.101.1", classification: "malicious" }) },
      },
    ]);
    const result = await runTransform(greyNoiseClassification, { transport: sim.transport, input: { ip: "185.220.101.1" } });
    expect(result.output.findings).toContainEqual(
      expect.objectContaining({ predicate: "is_classified_malicious", objectType: "ipv4", objectValue: "185.220.101.1" }),
    );
  });

  it("an unknown classification emits no classification claim (no invented verdict)", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/api\.greynoise\.io\/v3\/community\/1\.2\.3\.4$/,
        response: { status: 200, body: gnResponse({ ip: "1.2.3.4", noise: false, riot: false, classification: "unknown" }) },
      },
    ]);
    const result = await runTransform(greyNoiseClassification, { transport: sim.transport, input: { ip: "1.2.3.4" } });
    expect(result.output.findings).toEqual([]);
  });

  it("a response about a DIFFERENT address is refused fail-closed — never attributed", async () => {
    const sim = createSimServer([
      { match: /^https:\/\/api\.greynoise\.io\/v3\/community\/8\.8\.8\.8$/, response: { status: 200, body: gnResponse() } },
    ]);
    await expect(runTransform(greyNoiseClassification, { transport: sim.transport, input: { ip: "8.8.8.8" } })).rejects.toThrow(
      /returned a different address/i,
    );
  });

  it("fails closed on a non-200 status", async () => {
    const sim = createSimServer([
      { match: /^https:\/\/api\.greynoise\.io\/v3\/community\/8\.8\.8\.8$/, response: { status: 401, body: "{}" } },
    ]);
    await expect(runTransform(greyNoiseClassification, { transport: sim.transport, input: { ip: "8.8.8.8" } })).rejects.toThrow(/401/);
  });

  it("rejects an IPv6 subject before any request (the Community API takes IPv4 only)", async () => {
    const sim = createSimServer([]);
    await expect(runTransform(greyNoiseClassification, { transport: sim.transport, input: { ip: "2001:db8::1" } })).rejects.toThrow(
      /IPv4 only/,
    );
    expect(sim.requestCount()).toBe(0);
  });

  it("rejects a non-IP input before any request", async () => {
    const sim = createSimServer([]);
    await expect(runTransform(greyNoiseClassification, { transport: sim.transport, input: { ip: "example.com" } })).rejects.toThrow(
      /is not an IPv4 address/,
    );
    expect(sim.requestCount()).toBe(0);
  });
});
