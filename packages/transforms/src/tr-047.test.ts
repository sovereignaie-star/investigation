/**
 * TR-047 contract test (T-RULE-06). Runs the ThreatFox IOC-search transform against a
 * deterministic sim and asserts exact findings. The manifest declares a secret (pinned mode);
 * the sim stands in for the egress gateway that would inject the Auth-Key header — no real
 * key or connection is used.
 */
import { describe, expect, it } from "vitest";
import { createSimServer } from "@ir/sim/server";
import type { TransportRequest } from "@ir/engine/transport";
import { threatfoxSearch } from "./transforms/tr-047-threatfox.ts";
import { runTransform } from "./runner.ts";

function threatfoxResponse(entries: readonly unknown[]): string {
  return JSON.stringify({ query_status: "ok", data: entries });
}

describe("TR-047 threatfox-ioc-search", () => {
  it("emits a finding per reported IOC with its threat type and confidence", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/threatfox-api\.abuse\.ch\/api\/v1\/$/,
        response: {
          status: 200,
          body: threatfoxResponse([
            {
              ioc: "185.220.101.1",
              threat_type: "C2_server",
              malware_printable: "Emotet",
              confidence_level: 75,
            },
            {
              ioc: "185.220.101.1",
              threat_type: "C2_server",
              malware_printable: "Emotet",
              confidence_level: 75,
            },
          ]),
        },
      },
    ]);
    const result = await runTransform(threatfoxSearch, { transport: sim.transport, input: { ip: "139.180.203.104" } });
    expect(result.requestCount).toBe(1);
    const findings = result.output.findings;
    expect(findings).toHaveLength(1);
    expect(findings).toContainEqual(
      expect.objectContaining({
        predicate: "flagged_in_threatfox",
        objectType: "ipv4",
        objectValue: "185.220.101.1",
        confidence: 0.75,
      }),
    );
    expect(findings[0].explanation).toContain("C2_server");
    expect(findings[0].explanation).toContain("Emotet");
  });

  it("sends exactly the ADR-29 fixed body {query: search_ioc, search_term: the IOC}", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/threatfox-api\.abuse\.ch\/api\/v1\/$/,
        response: { status: 200, body: threatfoxResponse([]) },
      },
    ]);
    // Spy on the request body the transform hands to the transport.
    const bodies: string[] = [];
    const wrapped = {
      fetch: async (req: TransportRequest, signal: AbortSignal) => {
        bodies.push(req.body ?? "");
        return sim.transport.fetch(req, signal);
      },
    };
    await runTransform(threatfoxSearch, { transport: wrapped, input: { hash: "2151c4b970eff0071948dbbc19066aa4" } });
    expect(bodies).toHaveLength(1);
    expect(JSON.parse(bodies[0])).toEqual({ query: "search_ioc", search_term: "2151c4b970eff0071948dbbc19066aa4" });
  });

  it("returns an empty finding set for a no-result query", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/threatfox-api\.abuse\.ch\/api\/v1\/$/,
        response: { status: 200, body: JSON.stringify({ query_status: "no_result", data: [] }) },
      },
    ]);
    const result = await runTransform(threatfoxSearch, { transport: sim.transport, input: { domain: "example.com" } });
    expect(result.output.findings).toHaveLength(0);
  });

  it("fails closed on a source error status", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/threatfox-api\.abuse\.ch\/api\/v1\/$/,
        response: { status: 200, body: JSON.stringify({ query_status: "invalid_auth_key", data: [] }) },
      },
    ]);
    await expect(runTransform(threatfoxSearch, { transport: sim.transport, input: { url: "https://example.com/" } })).rejects.toThrow(
      /query failed/,
    );
  });

  it("rejects an input with no field or more than one field before any request", async () => {
    const sim = createSimServer([]);
    await expect(runTransform(threatfoxSearch, { transport: sim.transport, input: {} })).rejects.toThrow(/exactly one of/);
    await expect(
      runTransform(threatfoxSearch, { transport: sim.transport, input: { ip: "1.2.3.4", domain: "example.com" } }),
    ).rejects.toThrow(/exactly one of/);
    expect(sim.requestCount()).toBe(0);
  });

  it("rejects a value that matches no catalog IOC type before any request", async () => {
    const sim = createSimServer([]);
    await expect(runTransform(threatfoxSearch, { transport: sim.transport, input: { ip: "not an ip" } })).rejects.toThrow(
      /catalog IOC type/,
    );
    expect(sim.requestCount()).toBe(0);
  });

  it("rejects an IOC longer than 256 characters before any request (ADR-29 condition 1)", async () => {
    const sim = createSimServer([]);
    await expect(runTransform(threatfoxSearch, { transport: sim.transport, input: { domain: `${"a".repeat(257)}.com` } })).rejects.toThrow(
      /at most 256 characters/,
    );
    expect(sim.requestCount()).toBe(0);
  });
});
