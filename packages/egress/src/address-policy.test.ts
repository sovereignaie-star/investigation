import { describe, expect, it } from "vitest";
import { classifyAddress, classifyV4, classifyV6, isIpv4, isIpv6 } from "./address-policy";

describe("strict parsing", () => {
  it("rejects hex groups with trailing garbage (Number.parseInt prefix bug)", () => {
    expect(isIpv6("2001:4860:4860:0:0:0:0:8888g")).toBe(false);
    expect(isIpv6("2001:4860:4860:0:0:0:0:88x8")).toBe(false);
  });
  it("rejects zone IDs in IPv6", () => {
    expect(isIpv6("fe80::1%eth0")).toBe(false);
  });
  it("rejects leading zeros in IPv4", () => {
    expect(isIpv4("010.1.1.1")).toBe(false);
    expect(isIpv4("10.01.1.1")).toBe(false);
  });
  it("rejects out-of-range IPv4 octets", () => {
    expect(isIpv4("256.1.1.1")).toBe(false);
    expect(isIpv4("10.1.1.999")).toBe(false);
  });
  it("accepts well-formed addresses", () => {
    expect(isIpv4("8.8.8.8")).toBe(true);
    expect(isIpv6("2001:4860:4860::8888")).toBe(true);
    expect(isIpv6("2001:4860:4860:0:0:0:0:8888")).toBe(true);
  });
  it("compressed and full IPv6 forms are equivalent", () => {
    const a = classifyV6("2001:4860:4860::8888");
    const b = classifyV6("2001:4860:4860:0:0:0:0:8888");
    expect(a.ok).toBe(b.ok);
    expect(a.kind).toBe(b.kind);
  });
});

describe("IPv4 classification (IANA special-purpose)", () => {
  const deny: Array<[string, string]> = [
    ["0.0.0.0", "unspecified"],
    ["10.0.0.1", "private"],
    ["10.255.255.255", "private"],
    ["100.64.0.1", "private"], // CGNAT
    ["100.127.255.254", "private"],
    ["127.0.0.1", "loopback"],
    ["169.254.169.254", "link_local"], // cloud metadata
    ["172.16.0.1", "private"],
    ["172.31.255.255", "private"],
    ["192.0.0.1", "reserved"],
    ["192.0.2.1", "reserved"],
    ["192.168.1.1", "private"],
    ["198.18.0.1", "reserved"],
    ["198.51.100.1", "reserved"],
    ["203.0.113.1", "reserved"],
    ["224.0.0.1", "multicast"],
    ["240.0.0.1", "reserved"],
    ["255.255.255.255", "reserved"],
  ];
  for (const [ip, kind] of deny) {
    it(`denies ${ip} as ${kind}`, () => {
      const v = classifyV4(ip);
      expect(v.ok).toBe(false);
      expect(v.kind).toBe(kind);
    });
  }
  const allow = ["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.32.0.1", "172.15.255.255", "100.0.0.1"];
  for (const ip of allow) {
    it(`allows ${ip}`, () => {
      expect(classifyV4(ip).ok).toBe(true);
    });
  }
});

describe("IPv6 classification (IANA special-purpose)", () => {
  const deny: Array<[string, string]> = [
    ["::1", "loopback"],
    ["::", "unspecified"],
    ["fe80::1", "link_local"],
    ["fc00::1", "private"], // ULA
    ["fd00::1", "private"],
    ["ff02::1", "multicast"],
    ["2001:db8::1", "reserved"], // documentation
    ["2001:20::1", "reserved"], // ORCHIDv2 — ADR-08 policy reject
    ["2001:2::1", "reserved"], // benchmarking
    ["2002::1", "tunnel"], // 6to4 — always rejected
    ["2001:0::1", "tunnel"], // Teredo — always rejected
  ];
  for (const [ip, kind] of deny) {
    it(`denies ${ip} as ${kind}`, () => {
      const v = classifyV6(ip);
      expect(v.ok).toBe(false);
      expect(v.kind).toBe(kind);
    });
  }
  const allow = [
    "2606:4700:4700::1111",
    "2001:4860:4860::8888",
    "2001:1::1", // Port Control Protocol Anycast
    "2001:3::1", // AMT
    "2001:4:112::1", // AS112
    "2001:30::1", // DETs
  ];
  for (const ip of allow) {
    it(`allows ${ip}`, () => {
      expect(classifyV6(ip).ok).toBe(true);
    });
  }
});

describe("embedded IPv4 extraction", () => {
  it("rejects IPv4-mapped loopback in both dotted and hex form", () => {
    expect(classifyV6("::ffff:127.0.0.1").ok).toBe(false);
    expect(classifyV6("::ffff:7f00:1").ok).toBe(false);
    expect(classifyV6("::ffff:127.0.0.1").kind).toBe("loopback");
  });
  it("rejects IPv4-mapped link-local (cloud metadata)", () => {
    expect(classifyV6("::ffff:169.254.169.254").ok).toBe(false);
    expect(classifyV6("::ffff:169.254.169.254").kind).toBe("link_local");
  });
  it("rejects IPv4-mapped private", () => {
    expect(classifyV6("::ffff:10.0.0.1").ok).toBe(false);
    expect(classifyV6("::ffff:10.0.0.1").kind).toBe("private");
  });
  it("accepts IPv4-mapped public", () => {
    expect(classifyV6("::ffff:8.8.8.8").ok).toBe(true);
  });
  it("rejects NAT64 public with embedded private IPv4", () => {
    const v = classifyV6("64:ff9b::10.0.0.1");
    expect(v.ok).toBe(false);
    expect(v.kind).toBe("private");
  });
  it("rejects NAT64 local (RFC 8215)", () => {
    const v = classifyV6("64:ff9b:1::1");
    expect(v.ok).toBe(false);
    expect(v.kind).toBe("nat_local");
  });
  it("accepts NAT64 public with embedded public IPv4", () => {
    expect(classifyV6("64:ff9b::8.8.8.8").ok).toBe(true);
  });
  it("rejects IPv4-compatible (deprecated) with private IPv4", () => {
    expect(classifyV6("::10.0.0.1").ok).toBe(false);
  });
});

describe("URL-parser alternate forms", () => {
  it("classifies a URL-normalized loopback form", () => {
    // new URL("http://127.1/") → hostname "127.0.0.1"
    expect(classifyAddress("127.0.0.1").ok).toBe(false);
  });
  it("classifies bracketed IPv6", () => {
    expect(classifyAddress("[::1]").ok).toBe(false);
    expect(classifyAddress("[2606:4700::1111]").ok).toBe(true);
  });
  it("rejects non-IP strings", () => {
    const v = classifyAddress("not-an-ip");
    expect(v.ok).toBe(false);
    expect(v.kind).toBe("not_globally_reachable");
  });
});

describe("boundary values", () => {
  // Start and end of each critical block.
  const cases: Array<[string, boolean]> = [
    ["10.0.0.0", false],
    ["10.255.255.255", false],
    ["9.255.255.255", true],
    ["11.0.0.0", true],
    ["172.16.0.0", false],
    ["172.31.255.255", false],
    ["172.15.255.255", true],
    ["172.32.0.0", true],
    ["192.168.0.0", false],
    ["192.168.255.255", false],
    ["192.167.255.255", true],
    ["192.169.0.0", true],
    ["169.254.0.0", false],
    ["169.254.255.255", false],
    ["169.253.255.255", true],
    ["169.255.0.0", true],
    ["127.0.0.0", false],
    ["127.255.255.255", false],
    ["126.255.255.255", true],
    ["128.0.0.0", true],
  ];
  for (const [ip, ok] of cases) {
    it(`${ip} → ${ok ? "allow" : "deny"}`, () => {
      expect(classifyV4(ip).ok).toBe(ok);
    });
  }
});
