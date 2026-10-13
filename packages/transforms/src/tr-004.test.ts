/**
 * P2-009 — TR-004 contract test (T-RULE-06). Runs the cert-transparency
 * transform against a deterministic sim and asserts exact findings.
 */
import { describe, expect, it } from "vitest";
import { createSimServer } from "@ir/sim/server";
import { certTransparency } from "./transforms/tr-004-cert-transparency.ts";
import { runTransform } from "./runner.ts";

describe("TR-004 cert-transparency", () => {
  it("emits subdomain and certificate findings from crt.sh results", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/crt\.sh\/\?q=%25\.example\.com&output=json$/,
        response: {
          status: 200,
          body: JSON.stringify([
            { name_value: "example.com\nwww.example.com\n*.example.com", issuer_name: "Let's Encrypt", serial_number: "a1b2c3d4" },
            { name_value: "mail.example.com", issuer_name: "DigiCert", serial_number: "e5f6a7b8" },
          ]),
        },
      },
    ]);
    const result = await runTransform(certTransparency, { transport: sim.transport, input: { domain: "example.com" } });
    expect(result.requestCount).toBe(1);
    const findings = result.output.findings;
    expect(findings).toContainEqual(
      expect.objectContaining({ predicate: "has_subdomain", objectType: "hostname", objectValue: "example.com" }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({ predicate: "has_subdomain", objectType: "hostname", objectValue: "www.example.com" }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({ predicate: "has_subdomain", objectType: "hostname", objectValue: "mail.example.com" }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({ predicate: "has_certificate", objectType: "ssl_cert_hash", objectValue: "a1b2c3d4" }),
    );
    // wildcard is normalized to the bare domain, so no duplicate
    expect(findings.filter((f) => f.predicate === "has_subdomain" && f.objectValue === "example.com")).toHaveLength(1);
  });

  it("rejects an invalid domain before any request", async () => {
    const sim = createSimServer([]);
    await expect(runTransform(certTransparency, { transport: sim.transport, input: { domain: "bad domain" } })).rejects.toThrow(
      /invalid domain/,
    );
    expect(sim.requestCount()).toBe(0);
  });

  it("returns an empty finding set for an empty crt.sh response", async () => {
    const sim = createSimServer([
      { match: /^https:\/\/crt\.sh\/\?q=%25\.example\.com&output=json$/, response: { status: 200, body: "[]" } },
    ]);
    const result = await runTransform(certTransparency, { transport: sim.transport, input: { domain: "example.com" } });
    expect(result.output.findings).toHaveLength(0);
  });
});
