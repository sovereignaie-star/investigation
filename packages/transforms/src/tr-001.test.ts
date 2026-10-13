/**
 * P2-009 — TR-001 contract test (T-RULE-06). Runs the DNS transform against a
 * deterministic sim and asserts exact findings, evidence, and failure paths.
 */
import { describe, expect, it } from "vitest";
import { createSimServer } from "@ir/sim/server";
import { dnsResolve } from "./transforms/tr-001-dns.ts";
import { runTransform } from "./runner.ts";

describe("TR-001 dns-resolve", () => {
  it("emits typed findings for A/AAAA/MX/NS/TXT/CNAME answers", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/dns\.google\/resolve\?name=example\.com&type=1$/,
        response: { status: 200, body: JSON.stringify({ Answer: [{ name: "example.com.", type: 1, data: "93.184.216.34" }] }) },
      },
      {
        match: /^https:\/\/dns\.google\/resolve\?name=example\.com&type=28$/,
        response: {
          status: 200,
          body: JSON.stringify({ Answer: [{ name: "example.com.", type: 28, data: "2606:2800:220:1:248:1893:25c8:1946" }] }),
        },
      },
      {
        match: /^https:\/\/dns\.google\/resolve\?name=example\.com&type=15$/,
        response: { status: 200, body: JSON.stringify({ Answer: [{ name: "example.com.", type: 15, data: "10 mail.example.com" }] }) },
      },
      {
        match: /^https:\/\/dns\.google\/resolve\?name=example\.com&type=2$/,
        response: { status: 200, body: JSON.stringify({ Answer: [{ name: "example.com.", type: 2, data: "a.iana-servers.net." }] }) },
      },
      {
        match: /^https:\/\/dns\.google\/resolve\?name=example\.com&type=16$/,
        response: { status: 200, body: JSON.stringify({ Answer: [{ name: "example.com.", type: 16, data: '"v=spf1 -all"' }] }) },
      },
      {
        match: /^https:\/\/dns\.google\/resolve\?name=example\.com&type=5$/,
        response: { status: 200, body: JSON.stringify({ Answer: [{ name: "www.example.com.", type: 5, data: "example.com." }] }) },
      },
    ]);
    const result = await runTransform(dnsResolve, { transport: sim.transport, input: { domain: "example.com" } });
    expect(result.requestCount).toBe(6);
    const findings = result.output.findings;
    expect(findings).toContainEqual(
      expect.objectContaining({ predicate: "resolves_to", objectType: "ipv4", objectValue: "93.184.216.34" }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({ predicate: "resolves_to", objectType: "ipv6", objectValue: "2606:2800:220:1:248:1893:25c8:1946" }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({ predicate: "has_mail_server", objectType: "mx_record", objectValue: "10 mail.example.com" }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({ predicate: "has_name_server", objectType: "hostname", objectValue: "a.iana-servers.net" }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({ predicate: "has_txt_record", objectType: "txt_record", objectValue: '"v=spf1 -all"' }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({ predicate: "is_cname_of", objectType: "hostname", objectValue: "example.com" }),
    );
  });

  it("rejects an invalid domain before any request (fail-closed)", async () => {
    const sim = createSimServer([]);
    await expect(runTransform(dnsResolve, { transport: sim.transport, input: { domain: "not a domain" } })).rejects.toThrow(
      /invalid domain/,
    );
    expect(sim.requestCount()).toBe(0);
  });

  it("returns an empty finding set when a record type has no answer", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/dns\.google\/resolve\?name=example\.com&type=1$/,
        response: { status: 200, body: JSON.stringify({ Answer: [] }) },
      },
      {
        match: /^https:\/\/dns\.google\/resolve\?name=example\.com&type=28$/,
        response: { status: 200, body: JSON.stringify({ Answer: [] }) },
      },
      {
        match: /^https:\/\/dns\.google\/resolve\?name=example\.com&type=15$/,
        response: { status: 200, body: JSON.stringify({ Answer: [] }) },
      },
      {
        match: /^https:\/\/dns\.google\/resolve\?name=example\.com&type=2$/,
        response: { status: 200, body: JSON.stringify({ Answer: [] }) },
      },
      {
        match: /^https:\/\/dns\.google\/resolve\?name=example\.com&type=16$/,
        response: { status: 200, body: JSON.stringify({ Answer: [] }) },
      },
      {
        match: /^https:\/\/dns\.google\/resolve\?name=example\.com&type=5$/,
        response: { status: 200, body: JSON.stringify({ Answer: [] }) },
      },
    ]);
    const result = await runTransform(dnsResolve, { transport: sim.transport, input: { domain: "example.com" } });
    expect(result.output.findings).toHaveLength(0);
  });

  it("propagates a transport failure as a transform error", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/dns\.google\/resolve\?name=example\.com&type=1$/,
        response: { kind: "transport:network", message: "sim: no route" },
      },
    ]);
    await expect(runTransform(dnsResolve, { transport: sim.transport, input: { domain: "example.com" } })).rejects.toThrow();
  });
});
