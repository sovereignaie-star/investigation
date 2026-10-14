/**
 * P2-009 — TR-002 contract test (T-RULE-06). Runs the RDAP-domain transform
 * against a deterministic sim and asserts exact findings and failure paths.
 */
import { describe, expect, it } from "vitest";
import { createSimServer } from "@ir/sim/server";
import { rdapDomain } from "./transforms/tr-002-rdap-domain.ts";
import { runTransform } from "./runner.ts";

const BOOTSTRAP = JSON.stringify({
  services: [[["com"], "https://rdap.verisign.com/com/v1/"]],
});

describe("TR-002 rdap-domain", () => {
  it("emits registrar, dates, status and nameserver findings", async () => {
    const sim = createSimServer([
      { match: /^https:\/\/data\.iana\.org\/rdap\/dns\.json$/, response: { status: 200, body: BOOTSTRAP } },
      {
        match: /^https:\/\/rdap\.verisign\.com\/com\/v1\/domain\/example\.com$/,
        response: {
          status: 200,
          body: JSON.stringify({
            registrar: { name: "Example Registrar Inc" },
            events: [
              { eventAction: "registration", eventDate: "2020-01-01T00:00:00Z" },
              { eventAction: "expiration", eventDate: "2026-01-01T00:00:00Z" },
            ],
            status: ["clientTransferProhibited"],
            nameservers: [{ ldhName: "ns1.example.com." }],
          }),
        },
      },
    ]);
    const result = await runTransform(rdapDomain, { transport: sim.transport, input: { domain: "example.com" } });
    expect(result.requestCount).toBe(2);
    const findings = result.output.findings;
    expect(findings).toContainEqual(
      expect.objectContaining({ predicate: "registered_with", objectType: "organization", objectValue: "Example Registrar Inc" }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({ predicate: "registered_on", objectType: "date", objectValue: "2020-01-01T00:00:00Z" }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({ predicate: "expires_on", objectType: "date", objectValue: "2026-01-01T00:00:00Z" }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({ predicate: "has_domain_status", objectType: "domain_status", objectValue: "clientTransferProhibited" }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({ predicate: "has_name_server", objectType: "hostname", objectValue: "ns1.example.com" }),
    );
  });

  it("rejects an invalid domain before any request", async () => {
    const sim = createSimServer([]);
    await expect(runTransform(rdapDomain, { transport: sim.transport, input: { domain: "bad domain" } })).rejects.toThrow(/invalid domain/);
    expect(sim.requestCount()).toBe(0);
  });

  it("fails closed when the TLD has no RDAP bootstrap entry", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/data\.iana\.org\/rdap\/dns\.json$/,
        response: { status: 200, body: JSON.stringify({ services: [[["com"], "https://rdap.verisign.com/com/v1/"]] }) },
      },
    ]);
    await expect(runTransform(rdapDomain, { transport: sim.transport, input: { domain: "example.zz" } })).rejects.toThrow(/no RDAP server/);
  });
});
