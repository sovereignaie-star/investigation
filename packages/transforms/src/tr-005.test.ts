/**
 * P2-009 — TR-005 contract test (T-RULE-06). Runs the RIPEstat transform
 * against a deterministic sim and asserts exact findings for IP/ASN/prefix.
 */
import { describe, expect, it } from "vitest";
import { createSimServer } from "@ir/sim/server";
import { ripestat } from "./transforms/tr-005-ripestat.ts";
import { runTransform } from "./runner.ts";

describe("TR-005 ripestat", () => {
  it("emits announced prefixes for an IP", async () => {
    const sim = createSimServer([
      {
        match: "https://stat.ripe.net/data/announced-prefixes/data.json?resource=8.8.8.8",
        response: { status: 200, body: JSON.stringify({ data: { prefixes: [{ prefix: "8.8.8.0/24" }, { prefix: "8.8.4.0/24" }] } }) },
      },
    ]);
    const result = await runTransform(ripestat, { transport: sim.transport, input: { resource: "8.8.8.8" } });
    expect(result.requestCount).toBe(1);
    const findings = result.output.findings;
    expect(findings).toContainEqual(
      expect.objectContaining({ predicate: "in_prefix", objectType: "bgp_prefix", objectValue: "8.8.8.0/24" }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({ predicate: "in_prefix", objectType: "bgp_prefix", objectValue: "8.8.4.0/24" }),
    );
  });

  it("emits holder for an ASN", async () => {
    const sim = createSimServer([
      {
        match: "https://stat.ripe.net/data/as-overview/data.json?resource=15169",
        response: { status: 200, body: JSON.stringify({ data: { holder: "Google LLC", asn: "15169" } }) },
      },
    ]);
    const result = await runTransform(ripestat, { transport: sim.transport, input: { resource: "AS15169" } });
    const findings = result.output.findings;
    expect(findings).toContainEqual(
      expect.objectContaining({ predicate: "asn_named", objectType: "organization", objectValue: "Google LLC" }),
    );
  });

  it("emits announcing ASes for a prefix", async () => {
    const sim = createSimServer([
      {
        match: "https://stat.ripe.net/data/prefix-overview/data.json?resource=8.8.8.0%2F24",
        response: { status: 200, body: JSON.stringify({ data: { asns: [{ asn: "15169", holder: "Google" }] } }) },
      },
    ]);
    const result = await runTransform(ripestat, { transport: sim.transport, input: { resource: "8.8.8.0/24" } });
    const findings = result.output.findings;
    expect(findings).toContainEqual(expect.objectContaining({ predicate: "announced_by", objectType: "asn", objectValue: "AS15169" }));
  });

  it("rejects an invalid resource before any request", async () => {
    const sim = createSimServer([]);
    await expect(runTransform(ripestat, { transport: sim.transport, input: { resource: "not-a-resource" } })).rejects.toThrow(
      /invalid resource/,
    );
    expect(sim.requestCount()).toBe(0);
  });
});
