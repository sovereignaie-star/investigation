/**
 * TR-048 contract test (T-RULE-06). Runs the SecurityTrails DNS-history transform against a
 * deterministic sim and asserts exact findings. The manifest declares a secret (pinned mode); the
 * sim stands in for the egress gateway that would inject the `apikey` header — no real key or
 * connection is used. The path-template enforcement itself is pinned in
 * packages/egress/src/path-template.test.ts; this file pins the transform's own contract: record
 * type routing, the per-type findings, the bounds, and every fail-closed attribution rule.
 
 * NOTE on sim `match` values (P2-026): they are fully-escaped RegExp LITERALS (anchored exact
 * match, every dot/question mark escaped), not plain URL strings — CodeQL's
 * js/incomplete-hostname-regexp flags plain URL strings that flow into the sim server's
 * `new RegExp` (wildcard branch) as unescaped-hostname regexes; an escaped literal is not
 * flagged (precedent: tr-052.test.ts collinfo) and the runtime semantics are identical (the
 * sim's plain-string branch is exact equality).*/
import { describe, expect, it } from "vitest";
import { createSimServer } from "@ir/sim/server";
import { securityTrailsDnsHistory } from "./transforms/tr-048-securitytrails-dns-history.ts";
import { runTransform } from "./runner.ts";

function stResponse(records: Array<{ values: string[]; first_seen?: string; last_seen?: string }>): string {
  return JSON.stringify({
    host: "example.com",
    type: "a",
    records: records.map((r) => ({
      values: r.values.map((value) => ({ value })),
      first_seen: r.first_seen ?? "2020-01-01",
      last_seen: r.last_seen ?? "2026-10-01",
    })),
  });
}

describe("TR-048 securitytrails-dns-history", () => {
  it("emits a resolves_to finding per A-record value (an IP is a graph object)", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/api\.securitytrails\.com\/v1\/history\/example\.com\/dns\/a$/,
        response: { status: 200, body: stResponse([{ values: ["93.184.216.34"] }]) },
      },
    ]);
    const result = await runTransform(securityTrailsDnsHistory, { transport: sim.transport, input: { domain: "example.com" } });
    expect(result.requestCount).toBe(1);
    expect(result.output.findings).toContainEqual(
      expect.objectContaining({
        predicate: "resolves_to",
        objectType: "ipv4",
        objectValue: "93.184.216.34",
        confidence: 0.9,
      }),
    );
    expect(result.output.findings[0]?.explanation).toContain("2020-01-01");
    expect(result.output.findings[0]?.explanation).toContain("2026-10-01");
  });

  it("defaults to the a record type when none is given, and routes an explicit type", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/api\.securitytrails\.com\/v1\/history\/example\.com\/dns\/mx$/,
        response: {
          status: 200,
          body: JSON.stringify({
            host: "example.com",
            type: "mx",
            records: [{ values: [{ value: "10 mail.example.com" }], first_seen: "2021-01-01", last_seen: "2026-10-01" }],
          }),
        },
      },
      {
        match: /^https:\/\/api\.securitytrails\.com\/v1\/history\/example\.com\/dns\/ns$/,
        response: {
          status: 200,
          body: JSON.stringify({
            host: "example.com",
            type: "ns",
            records: [{ values: [{ value: "ns1.example.com" }], first_seen: "2021-01-01", last_seen: "2026-10-01" }],
          }),
        },
      },
      {
        match: /^https:\/\/api\.securitytrails\.com\/v1\/history\/example\.com\/dns\/txt$/,
        response: {
          status: 200,
          body: JSON.stringify({
            host: "example.com",
            type: "txt",
            records: [{ values: [{ value: "v=spf1 include:example.com -all" }], first_seen: "2021-01-01", last_seen: "2026-10-01" }],
          }),
        },
      },
      {
        match: /^https:\/\/api\.securitytrails\.com\/v1\/history\/example\.com\/dns\/soa$/,
        response: {
          status: 200,
          body: JSON.stringify({
            host: "example.com",
            type: "soa",
            records: [{ values: [{ value: "ns1.example.com hostmaster.example.com" }], first_seen: "2021-01-01", last_seen: "2026-10-01" }],
          }),
        },
      },
    ]);
    const mx = await runTransform(securityTrailsDnsHistory, { transport: sim.transport, input: { domain: "example.com", type: "mx" } });
    expect(mx.output.findings).toContainEqual(
      expect.objectContaining({ predicate: "has_mail_server", objectType: "hostname", objectValue: "mail.example.com" }),
    );
    const ns = await runTransform(securityTrailsDnsHistory, { transport: sim.transport, input: { domain: "example.com", type: "ns" } });
    expect(ns.output.findings).toContainEqual(
      expect.objectContaining({ predicate: "has_nameserver", objectType: "hostname", objectValue: "ns1.example.com" }),
    );
    const txt = await runTransform(securityTrailsDnsHistory, { transport: sim.transport, input: { domain: "example.com", type: "txt" } });
    expect(txt.output.findings).toContainEqual(
      expect.objectContaining({ predicate: "has_txt_record", objectType: "hostname", objectValue: "example.com" }),
    );
    expect(txt.output.findings[0]?.explanation).toContain("v=spf1");
    const soa = await runTransform(securityTrailsDnsHistory, { transport: sim.transport, input: { domain: "example.com", type: "soa" } });
    expect(soa.output.findings).toContainEqual(
      expect.objectContaining({ predicate: "has_soa_record", objectType: "hostname", objectValue: "example.com" }),
    );
  });

  it("routes an aaaa record type to ipv6 objects", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/api\.securitytrails\.com\/v1\/history\/example\.com\/dns\/aaaa$/,
        response: {
          status: 200,
          body: JSON.stringify({
            host: "example.com",
            type: "aaaa",
            records: [{ values: [{ value: "2606:2800:220:1:248:1893:25c8:1946" }], first_seen: "2021-01-01", last_seen: "2026-10-01" }],
          }),
        },
      },
    ]);
    const result = await runTransform(securityTrailsDnsHistory, {
      transport: sim.transport,
      input: { domain: "example.com", type: "aaaa" },
    });
    expect(result.output.findings).toContainEqual(
      expect.objectContaining({ predicate: "resolves_to", objectType: "ipv6", objectValue: "2606:2800:220:1:248:1893:25c8:1946" }),
    );
  });

  it("bounds the emitted records at one page (100 values) — no silent unbounded flood", async () => {
    const records = Array.from({ length: 150 }, (_, i) => ({
      values: [`192.0.2.${i}`],
      first_seen: "2020-01-01",
      last_seen: "2026-10-01",
    }));
    const sim = createSimServer([
      {
        match: /^https:\/\/api\.securitytrails\.com\/v1\/history\/example\.com\/dns\/a$/,
        response: { status: 200, body: stResponse(records) },
      },
    ]);
    const result = await runTransform(securityTrailsDnsHistory, { transport: sim.transport, input: { domain: "example.com" } });
    expect(result.output.findings).toHaveLength(100);
  });

  it("an invalid record value is skipped, never emitted as a finding (D-018)", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/api\.securitytrails\.com\/v1\/history\/example\.com\/dns\/a$/,
        response: { status: 200, body: stResponse([{ values: ["999.999.999.999", "not-an-ip"] }]) },
      },
    ]);
    const result = await runTransform(securityTrailsDnsHistory, { transport: sim.transport, input: { domain: "example.com" } });
    expect(result.output.findings).toEqual([]);
  });

  it("a response about a DIFFERENT host is refused fail-closed — never attributed", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/api\.securitytrails\.com\/v1\/history\/example\.com\/dns\/a$/,
        response: { status: 200, body: stResponse([{ values: ["93.184.216.34"] }]).replace('"host":"example.com"', '"host":"other.com"') },
      },
    ]);
    await expect(runTransform(securityTrailsDnsHistory, { transport: sim.transport, input: { domain: "example.com" } })).rejects.toThrow(
      /returned a different host/i,
    );
  });

  it("fails closed on a non-200 status", async () => {
    const sim = createSimServer([
      { match: /^https:\/\/api\.securitytrails\.com\/v1\/history\/example\.com\/dns\/a$/, response: { status: 403, body: "{}" } },
    ]);
    await expect(runTransform(securityTrailsDnsHistory, { transport: sim.transport, input: { domain: "example.com" } })).rejects.toThrow(
      /403/,
    );
  });

  it("rejects an undeclared record type before any request (the closed enum is enforced locally too)", async () => {
    const sim = createSimServer([]);
    await expect(
      runTransform(securityTrailsDnsHistory, { transport: sim.transport, input: { domain: "example.com", type: "cname" as "a" } }),
    ).rejects.toThrow(/not one of the allowed record types/);
    expect(sim.requestCount()).toBe(0);
  });

  it("rejects a non-hostname input before any request", async () => {
    const sim = createSimServer([]);
    await expect(runTransform(securityTrailsDnsHistory, { transport: sim.transport, input: { domain: "not a hostname" } })).rejects.toThrow(
      /is not a valid host name/,
    );
    expect(sim.requestCount()).toBe(0);
  });
});
