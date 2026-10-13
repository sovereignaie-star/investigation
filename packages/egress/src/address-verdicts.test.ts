/**
 * T-SEC-SSRF-045 (P2-003): frozen verdict table for the address classifier.
 *
 * Independent of both the classifier and the reference model: the expected verdicts are DATA, reviewed by hand
 * against ADR-08 section 4 on 2026-10-13. For every row of both IANA snapshots: its first and last address; plus
 * embedded forms (IPv4-mapped, NAT64, IPv4-compatible), the 2000::/3 and 224.0.0.0/4 defaults, and the metadata
 * addresses. Any change in any verdict must change this table, so a classification change is visible in the D-8
 * review instead of passing silently because code and reference were changed together.
 */
import { describe, expect, it } from "vitest";
import { classifyAddress } from "./address-policy";

const EXPECTED: ReadonlyArray<readonly [string, boolean]> = [
  ["0.0.0.0", false], // 0.0.0.0/8 first — "This network"
  ["0.255.255.255", false], // 0.0.0.0/8 last
  ["10.0.0.0", false], // 10.0.0.0/8 first — Private-Use
  ["10.255.255.255", false], // 10.0.0.0/8 last
  ["100.64.0.0", false], // 100.64.0.0/10 first — Shared Address Space
  ["100.127.255.255", false], // 100.64.0.0/10 last
  ["127.0.0.0", false], // 127.0.0.0/8 first — Loopback
  ["127.255.255.255", false], // 127.0.0.0/8 last
  ["169.254.0.0", false], // 169.254.0.0/16 first — Link Local
  ["169.254.255.255", false], // 169.254.0.0/16 last
  ["172.16.0.0", false], // 172.16.0.0/12 first — Private-Use
  ["172.31.255.255", false], // 172.16.0.0/12 last
  ["192.0.0.0", false], // 192.0.0.0/24 first — IETF Protocol Assignments
  ["192.0.0.255", false], // 192.0.0.0/24 last
  ["192.0.0.7", false], // 192.0.0.0/29 last
  ["192.0.0.8", false], // 192.0.0.8/32 first — IPv4 dummy address
  ["192.0.0.9", true], // 192.0.0.9/32 first — Port Control Protocol Anycast
  ["192.0.0.10", true], // 192.0.0.10/32 first — Traversal Using Relays around NAT Anycast
  ["192.0.0.170", false], // 192.0.0.170/32 first — NAT64/DNS64 Discovery
  ["192.0.0.171", false], // 192.0.0.171/32 first — NAT64/DNS64 Discovery
  ["192.0.2.0", false], // 192.0.2.0/24 first — Documentation (TEST-NET-1)
  ["192.0.2.255", false], // 192.0.2.0/24 last
  ["192.31.196.0", true], // 192.31.196.0/24 first — AS112-v4
  ["192.31.196.255", true], // 192.31.196.0/24 last
  ["192.52.193.0", true], // 192.52.193.0/24 first — AMT
  ["192.52.193.255", true], // 192.52.193.0/24 last
  ["192.88.99.0", false], // 192.88.99.0/24 first — Deprecated (6to4 Relay Anycast)
  ["192.88.99.255", false], // 192.88.99.0/24 last
  ["192.88.99.2", false], // 192.88.99.2/32 first — 6a44-relay anycast address
  ["192.168.0.0", false], // 192.168.0.0/16 first — Private-Use
  ["192.168.255.255", false], // 192.168.0.0/16 last
  ["192.175.48.0", true], // 192.175.48.0/24 first — Direct Delegation AS112 Service
  ["192.175.48.255", true], // 192.175.48.0/24 last
  ["198.18.0.0", false], // 198.18.0.0/15 first — Benchmarking
  ["198.19.255.255", false], // 198.18.0.0/15 last
  ["198.51.100.0", false], // 198.51.100.0/24 first — Documentation (TEST-NET-2)
  ["198.51.100.255", false], // 198.51.100.0/24 last
  ["203.0.113.0", false], // 203.0.113.0/24 first — Documentation (TEST-NET-3)
  ["203.0.113.255", false], // 203.0.113.0/24 last
  ["240.0.0.0", false], // 240.0.0.0/4 first — Reserved
  ["255.255.255.255", false], // 240.0.0.0/4 last
  ["0:0:0:0:0:0:0:1", false], // ::1/128 first — Loopback Address
  ["0:0:0:0:0:0:0:0", false], // ::/128 first — Unspecified Address
  ["0:0:0:0:0:ffff:0:0", false], // ::ffff:0:0/96 first — IPv4-mapped Address
  ["0:0:0:0:0:ffff:ffff:ffff", false], // ::ffff:0:0/96 last
  ["64:ff9b:0:0:0:0:0:0", false], // 64:ff9b::/96 first — IPv4-IPv6 Translat.
  ["64:ff9b:0:0:0:0:ffff:ffff", false], // 64:ff9b::/96 last
  ["64:ff9b:1:0:0:0:0:0", false], // 64:ff9b:1::/48 first — IPv4-IPv6 Translat.
  ["64:ff9b:1:ffff:ffff:ffff:ffff:ffff", false], // 64:ff9b:1::/48 last
  ["100:0:0:0:0:0:0:0", false], // 100::/64 first — Discard-Only Address Block
  ["100:0:0:0:ffff:ffff:ffff:ffff", false], // 100::/64 last
  ["100:0:0:1:0:0:0:0", false], // 100:0:0:1::/64 first — Dummy IPv6 Prefix
  ["100:0:0:1:ffff:ffff:ffff:ffff", false], // 100:0:0:1::/64 last
  ["2001:0:0:0:0:0:0:0", false], // 2001::/23 first — IETF Protocol Assignments
  ["2001:1ff:ffff:ffff:ffff:ffff:ffff:ffff", false], // 2001::/23 last
  ["2001:0:ffff:ffff:ffff:ffff:ffff:ffff", false], // 2001::/32 last
  ["2001:1:0:0:0:0:0:1", true], // 2001:1::1/128 first — Port Control Protocol Anycast
  ["2001:1:0:0:0:0:0:2", true], // 2001:1::2/128 first — Traversal Using Relays around NAT Anycast
  ["2001:1:0:0:0:0:0:3", true], // 2001:1::3/128 first — DNS-SD Service Registration Protocol Anycast
  ["2001:2:0:0:0:0:0:0", false], // 2001:2::/48 first — Benchmarking
  ["2001:2:0:ffff:ffff:ffff:ffff:ffff", false], // 2001:2::/48 last
  ["2001:3:0:0:0:0:0:0", true], // 2001:3::/32 first — AMT
  ["2001:3:ffff:ffff:ffff:ffff:ffff:ffff", true], // 2001:3::/32 last
  ["2001:4:112:0:0:0:0:0", true], // 2001:4:112::/48 first — AS112-v6
  ["2001:4:112:ffff:ffff:ffff:ffff:ffff", true], // 2001:4:112::/48 last
  ["2001:10:0:0:0:0:0:0", false], // 2001:10::/28 first — Deprecated (previously ORCHID)
  ["2001:1f:ffff:ffff:ffff:ffff:ffff:ffff", false], // 2001:10::/28 last
  ["2001:20:0:0:0:0:0:0", false], // 2001:20::/28 first — ORCHIDv2
  ["2001:2f:ffff:ffff:ffff:ffff:ffff:ffff", false], // 2001:20::/28 last
  ["2001:30:0:0:0:0:0:0", true], // 2001:30::/28 first — Drone Remote ID Protocol Entity Tags (DETs) Prefix
  ["2001:3f:ffff:ffff:ffff:ffff:ffff:ffff", true], // 2001:30::/28 last
  ["2001:db8:0:0:0:0:0:0", false], // 2001:db8::/32 first — Documentation
  ["2001:db8:ffff:ffff:ffff:ffff:ffff:ffff", false], // 2001:db8::/32 last
  ["2002:0:0:0:0:0:0:0", false], // 2002::/16 first — 6to4
  ["2002:ffff:ffff:ffff:ffff:ffff:ffff:ffff", false], // 2002::/16 last
  ["2620:4f:8000:0:0:0:0:0", true], // 2620:4f:8000::/48 first — Direct Delegation AS112 Service
  ["2620:4f:8000:ffff:ffff:ffff:ffff:ffff", true], // 2620:4f:8000::/48 last
  ["3fff:0:0:0:0:0:0:0", false], // 3fff::/20 first — Documentation
  ["3fff:fff:ffff:ffff:ffff:ffff:ffff:ffff", false], // 3fff::/20 last
  ["5f00:0:0:0:0:0:0:0", false], // 5f00::/16 first — Segment Routing (SRv6) SIDs
  ["5f00:ffff:ffff:ffff:ffff:ffff:ffff:ffff", false], // 5f00::/16 last
  ["fc00:0:0:0:0:0:0:0", false], // fc00::/7 first — Unique-Local
  ["fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff", false], // fc00::/7 last
  ["fe80:0:0:0:0:0:0:0", false], // fe80::/10 first — Link-Local Unicast
  ["febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff", false], // fe80::/10 last
  ["0:0:0:0:0:0:ffff:ffff", false], // ::/96 last
  ["8.8.8.8", true], // public v4
  ["1.1.1.1", true], // public v4
  ["192.175.47.255", true], // just below AS112 DD
  ["192.175.49.0", true], // just above AS112 DD
  ["224.0.0.1", false], // multicast v4 (default rule)
  ["239.255.255.255", false], // multicast v4 last
  ["::ffff:8.8.8.8", true], // mapped public
  ["::ffff:127.0.0.1", false], // mapped loopback
  ["::ffff:192.175.48.1", true], // mapped AS112 DD
  ["64:ff9b::8.8.8.8", true], // NAT64 public
  ["64:ff9b::a9fe:a9fe", false], // NAT64 metadata
  ["64:ff9b::192.175.48.6", true], // NAT64 AS112 DD
  ["::8.8.8.8", true], // v4-compatible public
  ["::10.0.0.1", false], // v4-compatible private
  ["2606:4700::1111", true], // public v6
  ["1fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff", false], // just below 2000::/3
  ["4000::", false], // just above 2000::/3
  ["ff02::1", false], // multicast v6
  ["169.254.169.254", false], // metadata v4
  ["fd00:ec2::254", false], // metadata v6 (ULA)
];

describe("T-SEC-SSRF-045: frozen address verdicts (regression guard)", () => {
  it("the table has no duplicate address", () => {
    expect(new Set(EXPECTED.map(([ip]) => ip)).size).toBe(EXPECTED.length);
  });
  for (const [ip, ok] of EXPECTED) {
    it(`${ip} is ${ok ? "accepted" : "refused"}`, () => {
      expect(classifyAddress(ip).ok).toBe(ok);
    });
  }
});

describe("T-SEC-SSRF-045: AS112 Direct Delegation (192.175.48.0/24), decided 2026-10-13", () => {
  // RFC 7534: every AS112 node originates 192.175.48.0/24, 192.31.196.0/24, 2620:4f:8000::/48 and 2001:4:112::/48.
  // ADR-08 has no rule refusing any of them, so they are classified alike, by the registry (GR=True for all four).
  const AS112 = ["192.175.48.1", "192.175.48.6", "192.175.48.42", "192.31.196.1", "2620:4f:8000::1", "2001:4:112::1"];
  it("the Direct Delegation servers (PRISONER, BLACKHOLE-1, BLACKHOLE-2) and the sibling AS112 prefixes get one verdict", () => {
    expect(AS112.map((ip) => classifyAddress(ip).ok)).toEqual(AS112.map(() => true));
  });
  it("the verdict holds through the embedded forms the gateway extracts", () => {
    for (const ip of ["::ffff:192.175.48.1", "64:ff9b::192.175.48.1", "::192.175.48.1"]) expect(classifyAddress(ip).ok, ip).toBe(true);
  });
});
