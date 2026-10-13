/**
 * P2-009 — TR-006 contract test (T-RULE-06). Runs the IP→ASN transform
 * against a deterministic sim and asserts exact findings.
 */
import { describe, expect, it } from "vitest";
import { createSimServer } from "@ir/sim/server";
import { ipToAsn } from "./transforms/tr-006-ip-to-asn.ts";
import { runTransform } from "./runner.ts";

describe("TR-006 ip-to-asn", () => {
  it("emits ASN and prefix findings from the Team Cymru TXT answer", async () => {
    const sim = createSimServer([
      {
        match: "https://dns.google/resolve?name=8.8.8.8.origin.asn.cymru.com&type=TXT",
        response: {
          status: 200,
          body: JSON.stringify({
            Answer: [{ name: "8.8.8.8.origin.asn.cymru.com.", type: 16, data: '"15169 | 8.8.8.0/24 | US | arin | 2010-08-30"' }],
          }),
        },
      },
    ]);
    const result = await runTransform(ipToAsn, { transport: sim.transport, input: { ip: "8.8.8.8" } });
    expect(result.requestCount).toBe(1);
    const findings = result.output.findings;
    expect(findings).toContainEqual(expect.objectContaining({ predicate: "has_asn", objectType: "asn", objectValue: "AS15169" }));
    expect(findings).toContainEqual(
      expect.objectContaining({ predicate: "in_prefix", objectType: "bgp_prefix", objectValue: "8.8.8.0/24" }),
    );
  });

  it("rejects a non-IPv4 input before any request", async () => {
    const sim = createSimServer([]);
    await expect(runTransform(ipToAsn, { transport: sim.transport, input: { ip: "example.com" } })).rejects.toThrow(/invalid IPv4/);
    expect(sim.requestCount()).toBe(0);
  });

  it("returns an empty finding set when there is no answer", async () => {
    const sim = createSimServer([
      {
        match: "https://dns.google/resolve?name=8.8.8.8.origin.asn.cymru.com&type=TXT",
        response: { status: 200, body: JSON.stringify({ Answer: [] }) },
      },
    ]);
    const result = await runTransform(ipToAsn, { transport: sim.transport, input: { ip: "8.8.8.8" } });
    expect(result.output.findings).toHaveLength(0);
  });
});
