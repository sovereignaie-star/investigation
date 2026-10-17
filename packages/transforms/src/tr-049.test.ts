/**
 * TR-049 contract test (T-RULE-06). Runs the Censys hosts/certificates transform against a
 * deterministic sim and asserts exact findings. The manifest declares a secret (pinned mode); the
 * sim stands in for the egress gateway that would inject the `Authorization: Basic` header built
 * from the vault's credential PAIR (API ID + secret — the P2-026 credential_pair extension); no
 * real credential or connection is used. The path-template enforcement (/v2/hosts/{ip}) is
 * pinned in packages/egress/src/path-template.test.ts; this file pins the transform's own
 * contract.
 *
 * RED FIRST (the J-1 rule): written before the transform existed — the red round is the module's
 * own absence (the import fails to load), then each behavior below is pinned.
 *
 * NOTE on sim `match` values (P2-026): they are fully-escaped RegExp LITERALS (exact-match
 * anchors, every dot/question mark escaped), not plain URL strings. Two reasons, both measured:
 * (1) CodeQL's js/incomplete-hostname-regexp flags plain URL strings that flow into the sim
 * server's `new RegExp` (the wildcard branch) as unescaped-hostname regexes — a literal with
 * every metacharacter escaped is not flagged (precedent: tr-052.test.ts collinfo); (2) the
 * runtime semantics are identical: the sim's plain-string branch is exact equality, and an
 * anchored fully-escaped literal tests the same single URL.
 */
import { describe, expect, it } from "vitest";
import { createSimServer } from "@ir/sim/server";
import { censysHostsCertificates } from "./transforms/tr-049-censys.ts";
import { runTransform } from "./runner.ts";

function hostResponse(ip: string, services: unknown[]): string {
  return JSON.stringify({
    code: 200,
    status: "OK",
    result: {
      ip,
      services,
    },
  });
}

function certHit(fingerprint: string, names: string[]): unknown {
  return { fingerprint_sha256: fingerprint, parsed: { names } };
}

describe("TR-049 censys-hosts-certificates", () => {
  it("emits one exposes_service claim per observed service for an IP subject", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/search\.censys\.io\/v2\/hosts\/45\.83\.66\.10$/,
        response: {
          status: 200,
          body: hostResponse("45.83.66.10", [
            { port: 443, transport_protocol: "TCP", service_name: "HTTPS" },
            { port: 22, transport_protocol: "TCP", service_name: "SSH" },
          ]),
        },
      },
    ]);
    const result = await runTransform(censysHostsCertificates, {
      transport: sim.transport,
      input: { ip: "45.83.66.10" },
    });
    expect(result.requestCount).toBe(1);
    expect(result.output.findings).toContainEqual(
      expect.objectContaining({
        predicate: "exposes_service",
        objectType: "service",
        objectValue: "TCP/443",
        evidence: [0],
      }),
    );
    expect(result.output.findings).toContainEqual(
      expect.objectContaining({
        predicate: "exposes_service",
        objectType: "service",
        objectValue: "TCP/22",
        evidence: [0],
      }),
    );
    expect(result.output.findings).toHaveLength(2);
  });

  it("a host with no observed services is a true negative — no claims, no error", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/search\.censys\.io\/v2\/hosts\/192\.0\.2\.1$/,
        response: { status: 200, body: hostResponse("192.0.2.1", []) },
      },
    ]);
    const result = await runTransform(censysHostsCertificates, {
      transport: sim.transport,
      input: { ip: "192.0.2.1" },
    });
    expect(result.requestCount).toBe(1);
    expect(result.output.findings).toHaveLength(0);
  });

  it("emits one has_certificate claim per covering certificate for a domain subject", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/search\.censys\.io\/v2\/certificates\/search\?q=example\.com$/,
        response: {
          status: 200,
          body: JSON.stringify({
            code: 200,
            status: "OK",
            result: {
              total: 2,
              hits: [
                certHit("a1b2c3d4e5f60718293a4b5c6d7e8f9012345678901234567890abcdefabcdef", ["example.com", "www.example.com"]),
                certHit("deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef", ["example.com"]),
              ],
            },
          }),
        },
      },
    ]);
    const result = await runTransform(censysHostsCertificates, {
      transport: sim.transport,
      input: { domain: "example.com" },
    });
    expect(result.requestCount).toBe(1);
    expect(result.output.findings).toContainEqual(
      expect.objectContaining({
        predicate: "has_certificate",
        objectType: "certificate",
        objectValue: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678901234567890abcdefabcdef",
        evidence: [0],
      }),
    );
    expect(result.output.findings).toHaveLength(2);
  });

  it("certificate hits whose names do not cover the requested domain are not claimed", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/search\.censys\.io\/v2\/certificates\/search\?q=example\.com$/,
        response: {
          status: 200,
          body: JSON.stringify({
            code: 200,
            status: "OK",
            result: {
              total: 1,
              hits: [certHit("0".repeat(64), ["other.org"])],
            },
          }),
        },
      },
    ]);
    const result = await runTransform(censysHostsCertificates, {
      transport: sim.transport,
      input: { domain: "example.com" },
    });
    expect(result.requestCount).toBe(1);
    expect(result.output.findings).toHaveLength(0);
  });

  it("refuses a malformed host response (no result object)", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/search\.censys\.io\/v2\/hosts\/45\.83\.66\.10$/,
        response: { status: 200, body: JSON.stringify({ code: 200, status: "OK" }) },
      },
    ]);
    await expect(runTransform(censysHostsCertificates, { transport: sim.transport, input: { ip: "45.83.66.10" } })).rejects.toThrow(
      /malformed response \(no result object\)/,
    );
  });

  it("refuses a host response about a different IP (fail-closed, no misattribution)", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/search\.censys\.io\/v2\/hosts\/45\.83\.66\.10$/,
        response: { status: 200, body: hostResponse("203.0.113.9", [{ port: 80, service_name: "HTTP" }]) },
      },
    ]);
    await expect(runTransform(censysHostsCertificates, { transport: sim.transport, input: { ip: "45.83.66.10" } })).rejects.toThrow(
      /different address/,
    );
  });

  it("refuses a response whose body code is not the documented 200 envelope", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/search\.censys\.io\/v2\/certificates\/search\?q=example\.com$/,
        response: {
          status: 200,
          body: JSON.stringify({ code: 400, status: "Bad Request", result: { hits: [] } }),
        },
      },
    ]);
    await expect(runTransform(censysHostsCertificates, { transport: sim.transport, input: { domain: "example.com" } })).rejects.toThrow(
      /envelope/,
    );
  });

  it("refuses the input when neither ip nor domain is set, and when both are", async () => {
    await expect(runTransform(censysHostsCertificates, { transport: createSimServer([]).transport, input: {} })).rejects.toThrow(
      /exactly one of ip or domain/,
    );
    await expect(
      runTransform(censysHostsCertificates, {
        transport: createSimServer([]).transport,
        input: { ip: "1.2.3.4", domain: "example.com" },
      }),
    ).rejects.toThrow(/only one of ip or domain/);
  });

  it("refuses a non-IP, non-domain subject value", async () => {
    await expect(
      runTransform(censysHostsCertificates, {
        transport: createSimServer([]).transport,
        input: { ip: "not-an-ip" },
      }),
    ).rejects.toThrow(/is not a valid/);
    await expect(
      runTransform(censysHostsCertificates, {
        transport: createSimServer([]).transport,
        input: { domain: "not a domain" },
      }),
    ).rejects.toThrow(/is not a valid/);
  });
});
