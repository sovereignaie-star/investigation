/**
 * P2-026 (owner decision 2026-10-17 — the path-parameter proposal, ADR-30 style): the CENTRAL
 * path-template enforcement. A provider whose endpoints carry the SUBJECT in the request PATH
 * (VT / GreyNoise / OTX / SecurityTrails) is declared as template rows in the policy table; the
 * gateway enforces every declared parameter (closed type + declared max length) fail-closed,
 * before DNS and on every hop — not each transform. These are the contract tests: written red
 * first (the module did not exist), they pin the encoding contract (split before decoding, decode
 * each parameter once) and every refusal reason in isolation.
 */
import { describe, expect, it } from "vitest";
import { matchPathTemplate, validatePathParam, type PathParamSpec, type PathParameterTemplate } from "./path-template.ts";
import { createEgressGateway, type EgressRequest, type EgressResult } from "./egress.ts";
import { virustotalPathPolicy, greynoisePathPolicy } from "../providers/post-policies.ts";

const PUB = "93.184.216.34";

/** A representative template row (the shapes come from the policy table's real rows). */
const T = (template: string, params: PathParameterTemplate["params"]): PathParameterTemplate => ({ template, params });

describe("path-template: matchPathTemplate", () => {
  const vtIp = T("/api/v3/ip_addresses/{ip}", [{ name: "ip", type: "ip", maxLength: 45 }]);
  const st = T("/v1/history/{hostname}/dns/{type}", [
    { name: "hostname", type: "domain", maxLength: 253 },
    { name: "type", type: "enum", values: ["a", "aaaa", "mx", "ns", "soa", "txt"], maxLength: 5 },
  ]);

  it("matches a literal-exact path with valid parameters (the positive control)", () => {
    expect(matchPathTemplate("/api/v3/ip_addresses/8.8.8.8", vtIp)).toEqual({ ok: true });
    expect(matchPathTemplate("/v1/history/example.com/dns/a", st)).toEqual({ ok: true });
  });

  it("refuses a different segment count: trailing slash, empty segment, extra segment", () => {
    expect(matchPathTemplate("/api/v3/ip_addresses/8.8.8.8/", vtIp).ok).toBe(false);
    expect(matchPathTemplate("/api/v3/ip_addresses//8.8.8.8", vtIp).ok).toBe(false);
    expect(matchPathTemplate("/api/v3/ip_addresses/8.8.8.8/extra", vtIp).ok).toBe(false);
    expect(matchPathTemplate("/api/v3/ip_addresses", vtIp).ok).toBe(false);
  });

  it("refuses a literal segment mismatch (no prefix matching, no wildcards)", () => {
    expect(matchPathTemplate("/api/v3/ip_addressesx/8.8.8.8", vtIp).ok).toBe(false);
    expect(matchPathTemplate("/api/v2/ip_addresses/8.8.8.8", vtIp).ok).toBe(false);
    expect(matchPathTemplate("/api/v3/ip_addresses/1.1.1.1%00.example.com", vtIp).ok).toBe(false);
  });

  it("refuses a parameter that fails its closed type (an IP segment must be a valid IP)", () => {
    expect(matchPathTemplate("/api/v3/ip_addresses/not-an-ip", vtIp).ok).toBe(false);
    expect(matchPathTemplate("/api/v3/ip_addresses/999.999.999.999", vtIp).ok).toBe(false);
    expect(matchPathTemplate("/api/v3/ip_addresses/8.8.8.8.8", vtIp).ok).toBe(false);
  });

  it("refuses a parameter over its declared max length", () => {
    const long = "8.8.8." + "1".repeat(60);
    expect(matchPathTemplate(`/api/v3/ip_addresses/${long}`, vtIp).ok).toBe(false);
  });

  it("refuses an enum parameter outside the declared closed list (and is case-strict as documented)", () => {
    expect(matchPathTemplate("/v1/history/example.com/dns/cname", st).ok).toBe(false);
    expect(matchPathTemplate("/v1/history/example.com/dns/A", st).ok).toBe(false);
    expect(matchPathTemplate("/v1/history/example.com/dns/", st).ok).toBe(false);
  });

  it("refuses a parameter segment that is empty or only whitespace", () => {
    expect(matchPathTemplate("/api/v3/ip_addresses/%20", vtIp).ok).toBe(false);
  });

  it("refuses dot-segments and backslashes (traversal shapes never reach a validator)", () => {
    expect(matchPathTemplate("/api/v3/ip_addresses/..", vtIp).ok).toBe(false);
    expect(matchPathTemplate("/api/v3/ip_addresses/.", vtIp).ok).toBe(false);
    expect(matchPathTemplate("/api/v3/ip_addresses/..%2f..", vtIp).ok).toBe(false);
    expect(matchPathTemplate("/api/v3/ip_addresses/..%5c..", vtIp).ok).toBe(false);
    expect(matchPathTemplate("/api/v3/ip_addresses/8.8.8.8%5c", vtIp).ok).toBe(false);
  });

  it("refuses a percent-encoded slash inside a parameter segment (a segment is ONE segment)", () => {
    expect(matchPathTemplate("/api/v3/ip_addresses/8.8.8.8%2fevil", vtIp).ok).toBe(false);
    expect(matchPathTemplate("/v1/history/example.com%2fdns/a", st).ok).toBe(false);
  });

  it("refuses double encoding (%252F decodes once to %2F — not a valid typed value)", () => {
    expect(matchPathTemplate("/api/v3/ip_addresses/8.8.8.8%252fevil", vtIp).ok).toBe(false);
  });

  it("refuses malformed percent-encoding (decode failure is a refusal, never a pass-through)", () => {
    expect(matchPathTemplate("/api/v3/ip_addresses/8.8.8.8%zz", vtIp).ok).toBe(false);
    expect(matchPathTemplate("/api/v3/ip_addresses/%", vtIp).ok).toBe(false);
  });

  it("accepts a legitimately percent-encoded typed value, decoded exactly once", () => {
    // An IPv6 containing a colon is percent-encoded by well-behaved clients in a path segment.
    const vtIpv6 = T("/api/v3/ip_addresses/{ip}", [{ name: "ip", type: "ip", maxLength: 45 }]);
    expect(matchPathTemplate("/api/v3/ip_addresses/2001%3Adb8%3A%3A1", vtIpv6)).toEqual({ ok: true });
    expect(matchPathTemplate("/api/v3/ip_addresses/2001:db8::1", vtIpv6)).toEqual({ ok: true });
  });

  it("a URL-like segment is refused for non-URL types (no free-form strings)", () => {
    expect(matchPathTemplate("/api/v3/ip_addresses/https%3A%2F%2Fevil.example", vtIp).ok).toBe(false);
  });
});

describe("path-template: validatePathParam (the closed type vocabulary)", () => {
  it("ipv4: dotted quads only, octets 0-255", () => {
    expect(validatePathParam("8.8.8.8", { name: "x", type: "ipv4", maxLength: 15 })).toEqual({ ok: true });
    expect(validatePathParam("255.255.255.255", { name: "x", type: "ipv4", maxLength: 15 })).toEqual({ ok: true });
    expect(validatePathParam("256.1.1.1", { name: "x", type: "ipv4", maxLength: 15 }).ok).toBe(false);
    expect(validatePathParam("1.2.3", { name: "x", type: "ipv4", maxLength: 15 }).ok).toBe(false);
  });

  it("ipv6: colon-hex only", () => {
    expect(validatePathParam("2001:db8::1", { name: "x", type: "ipv6", maxLength: 45 })).toEqual({ ok: true });
    expect(validatePathParam("::1", { name: "x", type: "ipv6", maxLength: 45 })).toEqual({ ok: true });
    expect(validatePathParam("2001:db8::g", { name: "x", type: "ipv6", maxLength: 45 }).ok).toBe(false);
    expect(validatePathParam("8.8.8.8", { name: "x", type: "ipv6", maxLength: 45 }).ok).toBe(false);
  });

  it("ip: either v4 or v6", () => {
    const spec = { name: "x", type: "ip", maxLength: 45 } as const;
    expect(validatePathParam("8.8.8.8", spec)).toEqual({ ok: true });
    expect(validatePathParam("2001:db8::1", spec)).toEqual({ ok: true });
    expect(validatePathParam("example.com", spec).ok).toBe(false);
  });

  it("domain: RFC 1123 labels, no leading/trailing hyphen, no empty label", () => {
    const spec: PathParamSpec = { name: "x", type: "domain", maxLength: 253 };
    expect(validatePathParam("example.com", spec)).toEqual({ ok: true });
    expect(validatePathParam("a-b.example.co.uk", spec)).toEqual({ ok: true });
    expect(validatePathParam("localhost", spec)).toEqual({ ok: true });
    expect(validatePathParam("-bad.example.com", spec).ok).toBe(false);
    expect(validatePathParam("bad-.example.com", spec).ok).toBe(false);
    expect(validatePathParam("bad..example.com", spec).ok).toBe(false);
    expect(validatePathParam("exa mple.com", spec).ok).toBe(false);
  });

  it("hash: hex of the declared lengths only (md5/sha1/sha256)", () => {
    const spec: PathParamSpec = { name: "x", type: "hash", lengths: [32, 40, 64], maxLength: 64 };
    expect(validatePathParam("a".repeat(32), spec)).toEqual({ ok: true });
    expect(validatePathParam("A".repeat(40), spec)).toEqual({ ok: true });
    expect(validatePathParam("a".repeat(64), spec)).toEqual({ ok: true });
    expect(validatePathParam("a".repeat(31), spec).ok).toBe(false);
    expect(validatePathParam("g".repeat(32), spec).ok).toBe(false);
  });

  it("vtUrlId: unpadded base64url or a 64-hex sha256 — never a raw URL, never padding", () => {
    const spec: PathParamSpec = { name: "x", type: "vtUrlId", maxLength: 2048 };
    expect(validatePathParam("aHR0cHM6Ly9leGFtcGxlLmNvbQ", spec)).toEqual({ ok: true });
    expect(validatePathParam("a".repeat(64), spec)).toEqual({ ok: true });
    expect(validatePathParam("aHR0cHM6Ly9leGFtcGxlLmNvbQ=", spec).ok).toBe(false);
    expect(validatePathParam("https://example.com", spec).ok).toBe(false);
    expect(validatePathParam("a b c", spec).ok).toBe(false);
  });

  it("enum: only the declared values, case-SENSITIVE (the source documents lowercase — anything else is undocumented and refused)", () => {
    const spec: PathParamSpec = { name: "x", type: "enum", values: ["a", "aaaa"], maxLength: 5 };
    expect(validatePathParam("a", spec)).toEqual({ ok: true });
    expect(validatePathParam("A", spec).ok).toBe(false);
    expect(validatePathParam("cname", spec).ok).toBe(false);
  });

  it("an unknown type in a row is a refusal (the vocabulary is closed)", () => {
    expect(validatePathParam("x", { name: "x", type: "weird" as "ipv4", maxLength: 5 }).ok).toBe(false);
  });
});

describe("path-template: the GATEWAY enforces the policy rows (T-SEC-SSRF-042 extension)", () => {
  /** Fake resolver/transport: no DNS, no sockets — the decision and the call counts are observed. */
  function gateway(calls: string[], redirect?: string, withTemplates = true) {
    const g = createEgressGateway({
      resolver: { resolve: async () => [PUB] },
      transport: {
        fetch: async (r: { method: string; url: string }) => {
          calls.push(`${r.method} ${r.url}`);
          return redirect !== undefined && calls.length === 1
            ? { status: 302, headers: { location: redirect } }
            : { status: 200, body: "{}" };
        },
      },
      allowedHosts: ["www.virustotal.com", "api.greynoise.io"],
      providerHosts: { virustotal: ["www.virustotal.com"], greynoise: ["api.greynoise.io"] },
      // The VT registry entry declares NO literal paths — only templates (the P2-026 shape). The
      // negative control drops BOTH registries (paths and templates) — no path restriction at all.
      ...(withTemplates
        ? {
            providerPaths: { virustotal: [], greynoise: [] },
            providerPathTemplates: { virustotal: virustotalPathPolicy.templates, greynoise: greynoisePathPolicy.templates },
          }
        : {}),
      limits: { rateLimitPerHostPerSecond: 1000, rateLimitBurst: 100 },
    });
    return g;
  }
  const SECRET = "vt-key-value-0123456789";
  const req = (url: string): EgressRequest => ({
    caseId: "case-p2-026",
    purposeRef: "purpose-p2-026",
    transform: "path.template@1",
    url,
    method: "GET",
    sends: ["ip"],
    sensitivity: "normal",
    pinnedHost: "www.virustotal.com",
    headers: { "x-apikey": SECRET },
    secret: SECRET,
    secretProvider: "virustotal",
  });

  it("control: a valid template request reaches the transport, once, secret in the header", async () => {
    const calls: string[] = [];
    const r = (await gateway(calls).request(req("https://www.virustotal.com/api/v3/ip_addresses/8.8.8.8"))) as EgressResult;
    expect(r.ok).toBe(true);
    expect(calls).toEqual(["GET https://www.virustotal.com/api/v3/ip_addresses/8.8.8.8"]);
  });

  it("a traversal-shaped path is refused before DNS (no transport call) — normalization cannot smuggle it", async () => {
    const calls: string[] = [];
    const r = await gateway(calls).request(req("https://www.virustotal.com/api/v3/ip_addresses/..%2fusers%2fme"));
    expect(r).toMatchObject({ ok: false, reason: "secret_host_mismatch", transportCalls: 0 });
    expect(calls).toEqual([]);
  });

  it("a same-host path that matches no template (the users endpoint) is refused before DNS", async () => {
    const calls: string[] = [];
    const r = await gateway(calls).request(req("https://www.virustotal.com/api/v3/users/me"));
    expect(r).toMatchObject({ ok: false, reason: "secret_host_mismatch", transportCalls: 0 });
    expect(calls).toEqual([]);
  });

  it("a subject of the wrong closed type (a dotted-quad with octets over 255, where an IP is declared) is refused", async () => {
    const calls: string[] = [];
    // 999.999.999.999 passes the content inventory's IP shape but fails the CLOSED type (octets
    // 0-255) — the template check itself refuses it, which is what this case pins.
    const r = await gateway(calls).request(req("https://www.virustotal.com/api/v3/ip_addresses/999.999.999.999"));
    expect(r).toMatchObject({ ok: false, reason: "secret_host_mismatch", transportCalls: 0 });
    expect(calls).toEqual([]);
  });

  it("a same-host redirect to an off-template path is refused at the hop (one transport call)", async () => {
    const calls: string[] = [];
    const r = await gateway(calls, "/api/v3/users/me").request(req("https://www.virustotal.com/api/v3/ip_addresses/8.8.8.8"));
    expect(r).toMatchObject({ ok: false, reason: "secret_host_mismatch", transportCalls: 1 });
    expect(calls).toEqual(["GET https://www.virustotal.com/api/v3/ip_addresses/8.8.8.8"]);
  });

  it("a POST to a template path is refused (the rows are method-bound GET)", async () => {
    const calls: string[] = [];
    const r = await gateway(calls).request({ ...req("https://www.virustotal.com/api/v3/ip_addresses/8.8.8.8"), method: "POST" });
    expect(r).toMatchObject({ ok: false, transportCalls: 0 });
    expect(calls).toEqual([]);
  });

  it("a template of ANOTHER provider does not unlock this provider's host (rows are per-provider)", async () => {
    const calls: string[] = [];
    // greynoise's template shape, sent with the virustotal secret to virustotal's host:
    const r = await gateway(calls).request(req("https://www.virustotal.com/v3/community/8.8.8.8"));
    expect(r).toMatchObject({ ok: false, reason: "secret_host_mismatch", transportCalls: 0 });
    expect(calls).toEqual([]);
  });

  it("negative control: without BOTH registries the same off-template request DOES reach the transport", async () => {
    const calls: string[] = [];
    const r = (await gateway(calls, undefined, false).request(req("https://www.virustotal.com/api/v3/users/me"))) as EgressResult;
    expect(r.ok).toBe(true);
    expect(calls).toEqual(["GET https://www.virustotal.com/api/v3/users/me"]);
  });
});
