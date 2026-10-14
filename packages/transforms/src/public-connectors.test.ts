/**
 * P2-037 — contract tests for the public connector batch (TR-001, TR-002, TR-003, TR-004, TR-006, TR-011) against the
 * real wire formats of each source (`fixtures/public-sources.ts`). Replaces the P2-009/P2-010 per-transform tests,
 * whose fixtures did not match the sources (DoH without `Status`, bootstrap URLs as a string, a top-level RDAP
 * `registrar`, a "start-end" cidr), which hid the data bugs fixed here.
 *
 * Every identifier finding is checked the way the ledger checks it: `canonicalKey` normalizes it AND the catalog
 * type's own pattern/validator accepts it (`accepts`). Every finding cites the request it came from.
 */
import { describe, expect, it } from "vitest";
import { canonicalKey } from "@ir/core";
import { accepts, specById } from "@ir/core/identifiers";
import { createSimServer, type SimRule } from "@ir/sim/server";
import * as F from "./fixtures/public-sources.ts";
import type { TransformOutput } from "./output.ts";
import { runTransform, TransformRunError, type RunTransformResult } from "./runner.ts";
import { dnsResolve } from "./transforms/tr-001-dns.ts";
import { rdapDomain } from "./transforms/tr-002-rdap-domain.ts";
import { rdapIp } from "./transforms/tr-003-rdap-ip.ts";
import { certTransparency } from "./transforms/tr-004-cert-transparency.ts";
import { ipToAsn } from "./transforms/tr-006-ip-to-asn.ts";
import { waybackCdx } from "./transforms/tr-011-wayback-cdx.ts";
import { ipv4RangeToCidrs, ipv6InCidr, ipv6ToBigInt, isAlignedIpv4Cidr } from "./transforms/util.ts";

/** A virtual clock for the rate limiter: waits advance it instantly (TR-001 at 1 rps makes six requests). */
function vclock() {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => void (t += ms) };
}

const ok = (body: string) => ({ status: 200, body, headers: { "content-type": "application/json" } });
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const exact = (url: string) => new RegExp(`^${esc(url)}$`);

/** Every identifier finding normalizes and matches its catalog type; every finding cites a response of the run. */
function assertTyped(result: RunTransformResult): void {
  const answered = new Set(result.evidence.filter((e) => e.status !== undefined).map((e) => e.requestId));
  for (const f of result.output.findings) {
    expect(f.evidence?.length, `${f.predicate} ${f.objectValue} cites evidence`).toBeGreaterThan(0);
    for (const ref of f.evidence ?? []) expect(answered.has(ref)).toBe(true);
    const spec = specById(f.objectType);
    if (!spec) continue; // a literal attribute (organization, date, ...), not a catalog identifier
    expect(() => canonicalKey(f.objectType, f.objectValue), `${f.objectType}:${f.objectValue} normalizes`).not.toThrow();
    expect(accepts(spec, f.objectValue), `${f.objectType}:${f.objectValue} matches the catalog format`).toBe(true);
  }
}

const values = (out: TransformOutput, predicate: string) => out.findings.filter((f) => f.predicate === predicate).map((f) => f.objectValue);

function dnsRules(overrides: Partial<Record<number, string>> = {}): SimRule[] {
  return [1, 28, 15, 2, 16, 5].map((t) => ({
    match: exact(`https://dns.google/resolve?name=example.com&type=${t}`),
    response: ok(overrides[t] ?? F.DNS_EXAMPLE[t]),
  }));
}

describe("TR-001 dns-resolve (P2-037)", () => {
  it("emits typed, catalog-valid findings for every record type, each citing its own query", async () => {
    const sim = createSimServer(dnsRules());
    const result = await runTransform(dnsResolve, { ...vclock(), transport: sim.transport, input: { domain: "Example.COM." } });
    expect(result.requestCount).toBe(6);
    const out = result.output;
    expect(values(out, "resolves_to")).toEqual(["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"]);
    expect(values(out, "has_mail_server")).toEqual(["10 mail.example.com", "20 mx2.example.net"]);
    expect(values(out, "has_name_server")).toEqual(["a.iana-servers.net", "b.iana-servers.net"]);
    expect(values(out, "has_txt_record")).toEqual(['"v=spf1 -all"', '"google-site-verification=abc123"']);
    assertTyped(result);
    // Each finding cites the query of its own record type, not the last query (CNAME).
    for (const f of out.findings) {
      const rec = result.evidence.find((e) => e.requestId === f.evidence?.[0]);
      const type = Number(new URL(rec?.url ?? "http://x/").searchParams.get("type"));
      expect({ predicate: f.predicate, type }).toEqual({
        predicate: f.predicate,
        type: { resolves_to: f.objectType === "ipv4" ? 1 : 28, has_mail_server: 15, has_name_server: 2, has_txt_record: 16 }[f.predicate],
      });
    }
  });

  it("rejects an invalid domain before any request", async () => {
    const sim = createSimServer([]);
    await expect(
      runTransform(dnsResolve, { ...vclock(), transport: sim.transport, input: { domain: "not a domain!" } }),
    ).rejects.toMatchObject({
      stage: "transform",
    });
    expect(sim.requests).toHaveLength(0);
  });

  it("NXDOMAIN is a genuine negative (no findings)", async () => {
    const sim = createSimServer(dnsRules(Object.fromEntries([1, 28, 15, 2, 16, 5].map((t) => [t, F.DNS_NXDOMAIN]))));
    const result = await runTransform(dnsResolve, { ...vclock(), transport: sim.transport, input: { domain: "example.com" } });
    expect(result.output.findings).toEqual([]);
  });

  it("SERVFAIL fails the run instead of reporting no records", async () => {
    const sim = createSimServer(dnsRules({ 15: F.DNS_SERVFAIL }));
    const err = await runTransform(dnsResolve, { ...vclock(), transport: sim.transport, input: { domain: "example.com" } }).catch((e) => e);
    expect(err).toBeInstanceOf(TransformRunError);
    expect(err.message).toMatch(/RCODE 2/);
  });

  it("an HTTP error status fails the run", async () => {
    const sim = createSimServer([{ match: /dns\.google/, response: { status: 503, body: "busy" } }]);
    const err = await runTransform(dnsResolve, { ...vclock(), transport: sim.transport, input: { domain: "example.com" } }).catch((e) => e);
    expect(err.message).toMatch(/HTTP 503/);
  });

  it("drops records of other names (CNAME/MX/NS/TXT) and TXT values the catalog cannot represent", async () => {
    const other = JSON.stringify({ Status: 0, Answer: [{ name: "other.example.", type: 15, data: "10 evil.example." }] });
    const badTxt = JSON.stringify({ Status: 0, Answer: [{ name: "example.com.", type: 16, data: '"a\\"b"' }] });
    const sim = createSimServer(dnsRules({ 15: other, 16: badTxt }));
    const result = await runTransform(dnsResolve, { ...vclock(), transport: sim.transport, input: { domain: "example.com" } });
    expect(values(result.output, "has_mail_server")).toEqual([]);
    expect(values(result.output, "has_txt_record")).toEqual([]);
  });
});

describe("TR-002 rdap-domain (P2-037)", () => {
  const rules = (rdap: string, status = 200): SimRule[] => [
    { match: exact("https://data.iana.org/rdap/dns.json"), response: ok(F.IANA_DNS) },
    { match: exact("https://rdap.verisign.com/com/v1/domain/example.com"), response: { status, body: rdap } },
  ];

  it("reads the bootstrap URL list and the registrar entity; never reports an individual", async () => {
    const sim = createSimServer(rules(F.RDAP_DOMAIN_EXAMPLE));
    const result = await runTransform(rdapDomain, { ...vclock(), transport: sim.transport, input: { domain: "example.com" } });
    const out = result.output;
    expect(values(out, "registered_with")).toEqual(["RESERVED-Internet Assigned Numbers Authority"]);
    expect(values(out, "registered_on")).toEqual(["1995-08-14T04:00:00Z"]);
    expect(values(out, "expires_on")).toEqual(["2027-08-13T04:00:00Z"]);
    expect(values(out, "has_domain_status")).toHaveLength(3);
    expect(values(out, "has_name_server")).toEqual(["a.iana-servers.net", "b.iana-servers.net"]);
    expect(JSON.stringify(out)).not.toMatch(/Jane Doe|Abuse Contact/);
    // Every finding cites the RDAP response (request 1), not the bootstrap (request 0).
    expect(new Set(out.findings.flatMap((f) => f.evidence))).toEqual(new Set([1]));
    assertTyped(result);
  });

  it("RDAP 404 is a genuine negative; a 5xx fails the run", async () => {
    const notFound = await runTransform(rdapDomain, {
      ...vclock(),
      transport: createSimServer(rules("{}", 404)).transport,
      input: { domain: "example.com" },
    });
    expect(notFound.output.findings).toEqual([]);
    const err = await runTransform(rdapDomain, {
      ...vclock(),
      transport: createSimServer(rules("{}", 502)).transport,
      input: { domain: "example.com" },
    }).catch((e) => e);
    expect(err.message).toMatch(/HTTP 502/);
  });

  it("rejects an invalid domain before any request; a TLD without an https RDAP server fails closed", async () => {
    const sim = createSimServer(rules(F.RDAP_DOMAIN_EXAMPLE));
    await expect(
      runTransform(rdapDomain, { ...vclock(), transport: sim.transport, input: { domain: "bad domain" } }),
    ).rejects.toBeInstanceOf(TransformRunError);
    expect(sim.requests).toHaveLength(0);
    const err = await runTransform(rdapDomain, { ...vclock(), transport: sim.transport, input: { domain: "example.zz" } }).catch((e) => e);
    expect(err.message).toMatch(/no https RDAP server for TLD "zz"/);
  });
});

describe("TR-003 rdap-ip (P2-037)", () => {
  const ipRules = (path: string, body: string, boot = F.IANA_IPV4, bootUrl = "https://data.iana.org/rdap/ipv4.json"): SimRule[] => [
    { match: exact(bootUrl), response: ok(boot) },
    { match: exact(`https://rdap.arin.net/registry/${path}`), response: ok(body) },
  ];

  it("emits the network as an aligned, catalog-valid CIDR (not a start-end range) containing the address", async () => {
    const result = await runTransform(rdapIp, {
      ...vclock(),
      transport: createSimServer(ipRules("ip/8.8.8.8", F.RDAP_IP_8888)).transport,
      input: { ip: "8.8.8.8" },
    });
    expect(values(result.output, "in_network")).toEqual(["8.8.8.0/24"]);
    expect(values(result.output, "network_named")).toEqual(["GOGL"]);
    expect(result.output.findings.find((f) => f.predicate === "network_named")?.objectType).toBe("network_name");
    expect(values(result.output, "owned_by")).toEqual(["Google LLC"]);
    assertTyped(result);
  });

  it("a range that is not one block is decomposed; only the block containing the address is the address's network", async () => {
    const result = await runTransform(rdapIp, {
      ...vclock(),
      transport: createSimServer(ipRules("ip/23.0.2.9", F.RDAP_IP_RANGE)).transport,
      input: { ip: "23.0.2.9" },
    });
    expect(values(result.output, "in_network")).toEqual(["23.0.2.0/24"]);
    assertTyped(result);
  });

  it("an RDAP network that does not contain the queried address fails the run", async () => {
    const err = await runTransform(rdapIp, {
      ...vclock(),
      transport: createSimServer(ipRules("ip/8.8.8.8", F.RDAP_IP_WRONG)).transport,
      input: { ip: "8.8.8.8" },
    }).catch((e) => e);
    expect(err.message).toMatch(/does not contain 8\.8\.8\.8/);
  });

  it("IPv6 uses the ipv6 bootstrap; no cidr finding (catalog cidr is IPv4-only), name and owner still reported", async () => {
    const ip = "2001:4860:4860::8888";
    const sim = createSimServer(ipRules(`ip/${encodeURIComponent(ip)}`, F.RDAP_IP6, F.IANA_IPV6, "https://data.iana.org/rdap/ipv6.json"));
    const result = await runTransform(rdapIp, { ...vclock(), transport: sim.transport, input: { ip } });
    expect(values(result.output, "in_network")).toEqual([]);
    expect(values(result.output, "network_named")).toEqual(["GOOGLE-IPV6"]);
    expect(values(result.output, "owned_by")).toEqual(["Google LLC"]);
    assertTyped(result);
  });

  it("an ASN (AS15169 or 15169) resolves through the ASN bootstrap", async () => {
    for (const input of ["AS15169", "15169"]) {
      const result = await runTransform(rdapIp, {
        ...vclock(),
        transport: createSimServer(ipRules("autnum/15169", F.RDAP_AS15169, F.IANA_ASN, "https://data.iana.org/rdap/asn.json")).transport,
        input: { ip: input },
      });
      expect(values(result.output, "asn_named")).toEqual(["GOOGLE"]);
      expect(values(result.output, "owned_by")).toEqual(["Google LLC"]);
    }
  });

  it("rejects an invalid IP/ASN before any request; an address no RIR covers fails closed", async () => {
    const sim = createSimServer(ipRules("ip/8.8.8.8", F.RDAP_IP_8888));
    for (const ip of ["999.1.1.1", "2001:::1", "ASX"]) {
      await expect(runTransform(rdapIp, { ...vclock(), transport: sim.transport, input: { ip } })).rejects.toBeInstanceOf(
        TransformRunError,
      );
    }
    expect(sim.requests).toHaveLength(0);
    const err = await runTransform(rdapIp, { ...vclock(), transport: sim.transport, input: { ip: "203.0.113.1" } }).catch((e) => e);
    expect(err.message).toMatch(/no https RDAP server/);
  });
});

describe("TR-004 cert-transparency (P2-037)", () => {
  const rules = (body: string, status = 200): SimRule[] => [
    { match: exact("https://crt.sh/?q=%25.example.com&output=json"), response: { status, body } },
  ];

  it("emits only true subdomains; no serial typed as ssl_cert_hash", async () => {
    const result = await runTransform(certTransparency, {
      ...vclock(),
      transport: createSimServer(rules(F.CRT_EXAMPLE)).transport,
      input: { domain: "example.com" },
    });
    // not example.com itself, not evilexample.com, not an e-mail SAN, not an invalid label
    expect(values(result.output, "has_subdomain")).toEqual(["www.example.com", "api.example.com"]);
    expect(result.output.findings.some((f) => f.objectType === "ssl_cert_hash")).toBe(false);
    expect(certTransparency.manifest.outputs).toEqual(["hostname"]);
    assertTyped(result);
  });

  it("an empty list is a negative; a 5xx fails the run; an invalid domain never reaches the network", async () => {
    expect(
      (
        await runTransform(certTransparency, {
          ...vclock(),
          transport: createSimServer(rules("[]")).transport,
          input: { domain: "example.com" },
        })
      ).output.findings,
    ).toEqual([]);
    const err = await runTransform(certTransparency, {
      ...vclock(),
      transport: createSimServer(rules("", 502)).transport,
      input: { domain: "example.com" },
    }).catch((e) => e);
    expect(err.message).toMatch(/HTTP 502/);
    const sim = createSimServer(rules("[]"));
    await expect(
      runTransform(certTransparency, { ...vclock(), transport: sim.transport, input: { domain: "-bad-" } }),
    ).rejects.toBeInstanceOf(TransformRunError);
    expect(sim.requests).toHaveLength(0);
  });
});

describe("TR-006 ip-to-asn (P2-037)", () => {
  const rules = (name: string, body: string): SimRule[] => [
    { match: exact(`https://dns.google/resolve?name=${name}.origin.asn.cymru.com&type=16`), response: ok(body) },
  ];

  it("emits ASN and aligned prefix", async () => {
    const result = await runTransform(ipToAsn, {
      ...vclock(),
      transport: createSimServer(rules("8.8.8.8", F.CYMRU_8888)).transport,
      input: { ip: "8.8.8.8" },
    });
    expect(values(result.output, "has_asn")).toEqual(["AS15169"]);
    expect(values(result.output, "in_prefix")).toEqual(["8.8.8.0/24"]);
    assertTyped(result);
  });

  it("a multi-origin announcement yields one has_asn per origin (not one invalid value)", async () => {
    const result = await runTransform(ipToAsn, {
      ...vclock(),
      transport: createSimServer(rules("4.3.2.1", F.CYMRU_MOAS)).transport,
      input: { ip: "1.2.3.4" },
    });
    expect(values(result.output, "has_asn")).toEqual(["AS13335", "AS15169"]);
    assertTyped(result);
  });

  it("NXDOMAIN (not announced) is a negative; SERVFAIL fails; a non-IPv4 input never reaches the network", async () => {
    expect(
      (
        await runTransform(ipToAsn, {
          ...vclock(),
          transport: createSimServer(rules("8.8.8.8", F.DNS_NXDOMAIN)).transport,
          input: { ip: "8.8.8.8" },
        })
      ).output.findings,
    ).toEqual([]);
    const err = await runTransform(ipToAsn, {
      ...vclock(),
      transport: createSimServer(rules("8.8.8.8", F.DNS_SERVFAIL)).transport,
      input: { ip: "8.8.8.8" },
    }).catch((e) => e);
    expect(err.message).toMatch(/RCODE 2/);
    const sim = createSimServer([]);
    await expect(runTransform(ipToAsn, { ...vclock(), transport: sim.transport, input: { ip: "2001:db8::1" } })).rejects.toBeInstanceOf(
      TransformRunError,
    );
    expect(sim.requests).toHaveLength(0);
  });
});

describe("TR-011 wayback-cdx (P2-037)", () => {
  const cdx =
    "https://web.archive.org/cdx/search/cdx?url=https%3A%2F%2Fexample.com%2F&output=json&fl=timestamp,original,statuscode&filter=statuscode:200&limit=100";
  const rules = (body: string, status = 200): SimRule[] => [{ match: exact(cdx), response: { status, body } }];

  it("emits one catalog-valid snapshot URL per valid row (malformed timestamps skipped)", async () => {
    const result = await runTransform(waybackCdx, {
      ...vclock(),
      transport: createSimServer(rules(F.CDX_EXAMPLE)).transport,
      input: { url: "https://example.com/" },
    });
    expect(values(result.output, "has_archive_snapshot")).toEqual([
      "https://web.archive.org/web/20200101000000/https://example.com/",
      "https://web.archive.org/web/20210615123456/https://example.com/",
    ]);
    assertTyped(result);
  });

  it("empty body or [] is a negative; a 5xx or non-list fails; invalid or non-http URL never reaches the network", async () => {
    for (const body of ["", "[]"]) {
      expect(
        (
          await runTransform(waybackCdx, {
            ...vclock(),
            transport: createSimServer(rules(body)).transport,
            input: { url: "https://example.com/" },
          })
        ).output.findings,
      ).toEqual([]);
    }
    for (const [body, status, msg] of [
      ["", 503, /HTTP 503/],
      ['{"a":1}', 200, /not a list/],
    ] as const) {
      const err = await runTransform(waybackCdx, {
        ...vclock(),
        transport: createSimServer(rules(body, status)).transport,
        input: { url: "https://example.com/" },
      }).catch((e) => e);
      expect(err.message).toMatch(msg);
    }
    const sim = createSimServer([]);
    for (const url of ["not a url", "ftp://example.com/"]) {
      await expect(runTransform(waybackCdx, { ...vclock(), transport: sim.transport, input: { url } })).rejects.toBeInstanceOf(
        TransformRunError,
      );
    }
    expect(sim.requests).toHaveLength(0);
  });
});

describe("network arithmetic used by the connectors (P2-037)", () => {
  it("ipv4RangeToCidrs is the exact aligned decomposition", () => {
    expect(ipv4RangeToCidrs("8.8.8.0", "8.8.8.255")).toEqual(["8.8.8.0/24"]);
    expect(ipv4RangeToCidrs("23.0.0.0", "23.0.2.255")).toEqual(["23.0.0.0/23", "23.0.2.0/24"]);
    expect(ipv4RangeToCidrs("10.0.0.1", "10.0.0.6")).toEqual(["10.0.0.1/32", "10.0.0.2/31", "10.0.0.4/31", "10.0.0.6/32"]);
    expect(ipv4RangeToCidrs("0.0.0.0", "255.255.255.255")).toEqual(["0.0.0.0/0"]);
    expect(() => ipv4RangeToCidrs("10.0.0.9", "10.0.0.1")).toThrow(/inverted/);
    for (const c of ipv4RangeToCidrs("10.0.0.1", "10.0.0.6")) expect(isAlignedIpv4Cidr(c)).toBe(true);
    expect(isAlignedIpv4Cidr("8.8.8.1/24")).toBe(false);
  });

  it("IPv6 parsing and containment", () => {
    expect(ipv6ToBigInt("::1")).toBe(1n);
    expect(ipv6ToBigInt("::ffff:1.2.3.4")).toBe(0xffff01020304n);
    expect(() => ipv6ToBigInt("1::2::3")).toThrow();
    expect(() => ipv6ToBigInt("1:2:3:4:5:6:7")).toThrow();
    expect(ipv6InCidr("2001:4860:4860::8888", "2001:4800::/23")).toBe(true);
    expect(ipv6InCidr("2600::1", "2001:4800::/23")).toBe(false);
  });
});
