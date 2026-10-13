/**
 * P2-009 — TR-007 contract test (T-RULE-06). Runs the ipinfo transform
 * against a deterministic sim and asserts exact findings.
 */
import { describe, expect, it } from "vitest";
import { createSimServer } from "@ir/sim/server";
import { ipInfo } from "./transforms/tr-007-ipinfo.ts";
import { runTransform } from "./runner.ts";

describe("TR-007 ipinfo", () => {
  it("emits ASN, org, city and country findings", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/ipinfo\.io\/8\.8\.8\.8\/json$/,
        response: {
          status: 200,
          body: JSON.stringify({ org: "AS15169 Google LLC", city: "Mountain View", region: "California", country: "US" }),
        },
      },
    ]);
    const result = await runTransform(ipInfo, { transport: sim.transport, input: { ip: "8.8.8.8" } });
    expect(result.requestCount).toBe(1);
    const findings = result.output.findings;
    expect(findings).toContainEqual(expect.objectContaining({ predicate: "has_asn", objectType: "asn", objectValue: "AS15169" }));
    expect(findings).toContainEqual(
      expect.objectContaining({ predicate: "hosted_by", objectType: "organization", objectValue: "Google LLC" }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({ predicate: "located_in_city", objectType: "city", objectValue: "Mountain View" }),
    );
    expect(findings).toContainEqual(expect.objectContaining({ predicate: "located_in_country", objectType: "country", objectValue: "US" }));
  });

  it("rejects an invalid IP before any request", async () => {
    const sim = createSimServer([]);
    await expect(runTransform(ipInfo, { transport: sim.transport, input: { ip: "not-an-ip" } })).rejects.toThrow(/invalid IP/);
    expect(sim.requestCount()).toBe(0);
  });

  it("returns an empty finding set for a bare response", async () => {
    const sim = createSimServer([{ match: /^https:\/\/ipinfo\.io\/8\.8\.8\.8\/json$/, response: { status: 200, body: "{}" } }]);
    const result = await runTransform(ipInfo, { transport: sim.transport, input: { ip: "8.8.8.8" } });
    expect(result.output.findings).toHaveLength(0);
  });
});
