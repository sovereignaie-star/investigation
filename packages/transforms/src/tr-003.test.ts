/**
 * P2-009 — TR-003 contract test (T-RULE-06). Runs the RDAP IP/ASN transform
 * against a deterministic sim and asserts exact findings and failure paths.
 */
import { describe, expect, it } from "vitest";
import { createSimServer } from "@ir/sim/server";
import { rdapIp } from "./transforms/tr-003-rdap-ip.ts";
import { runTransform } from "./runner.ts";

const IPV4_BOOTSTRAP = JSON.stringify({
  services: [[["8.8.8.0/24"], "https://rdap.arin.net/registry/"]],
});
const ASN_BOOTSTRAP = JSON.stringify({
  services: [[["15169"], "https://rdap.arin.net/registry/"]],
});

describe("TR-003 rdap-ip", () => {
  it("emits network range, name and registrant findings for an IP", async () => {
    const sim = createSimServer([
      { match: "https://data.iana.org/rdap/ipv4.json", response: { status: 200, body: IPV4_BOOTSTRAP } },
      {
        match: "https://rdap.arin.net/registry/ip/8.8.8.8",
        response: {
          status: 200,
          body: JSON.stringify({
            startAddress: "8.8.8.0",
            endAddress: "8.8.8.255",
            name: "GOOGLE",
            entities: [{ roles: ["registrant"], vcardArray: ["vcard", [["fn", {}, "text", "Google LLC"]]] }],
          }),
        },
      },
    ]);
    const result = await runTransform(rdapIp, { transport: sim.transport, input: { ip: "8.8.8.8" } });
    expect(result.requestCount).toBe(2);
    const findings = result.output.findings;
    expect(findings).toContainEqual(
      expect.objectContaining({ predicate: "in_network", objectType: "cidr", objectValue: "8.8.8.0-8.8.8.255" }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({ predicate: "network_named", objectType: "organization", objectValue: "GOOGLE" }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({ predicate: "owned_by", objectType: "organization", objectValue: "Google LLC" }),
    );
  });

  it("emits holder findings for an ASN", async () => {
    const sim = createSimServer([
      { match: "https://data.iana.org/rdap/asn.json", response: { status: 200, body: ASN_BOOTSTRAP } },
      {
        match: "https://rdap.arin.net/registry/autnum/15169",
        response: {
          status: 200,
          body: JSON.stringify({
            name: "GOOGLE",
            entities: [{ roles: ["registrant"], vcardArray: ["vcard", [["fn", {}, "text", "Google LLC"]]] }],
          }),
        },
      },
    ]);
    const result = await runTransform(rdapIp, { transport: sim.transport, input: { ip: "AS15169" } });
    expect(result.requestCount).toBe(2);
    const findings = result.output.findings;
    expect(findings).toContainEqual(expect.objectContaining({ predicate: "asn_named", objectType: "organization", objectValue: "GOOGLE" }));
    expect(findings).toContainEqual(
      expect.objectContaining({ predicate: "owned_by", objectType: "organization", objectValue: "Google LLC" }),
    );
  });

  it("rejects an invalid IP/ASN before any request", async () => {
    const sim = createSimServer([]);
    await expect(runTransform(rdapIp, { transport: sim.transport, input: { ip: "999.1.1.1" } })).rejects.toThrow(/invalid IP or ASN/);
    expect(sim.requestCount()).toBe(0);
  });

  it("fails closed when no RIR covers the IP", async () => {
    const sim = createSimServer([
      {
        match: "https://data.iana.org/rdap/ipv4.json",
        response: { status: 200, body: JSON.stringify({ services: [[["10.0.0.0/8"], "https://rdap.example/"]] }) },
      },
    ]);
    await expect(runTransform(rdapIp, { transport: sim.transport, input: { ip: "8.8.8.8" } })).rejects.toThrow(/no RDAP server/);
  });
});
