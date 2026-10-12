/**
 * T-SEC-SSRF-043 (P2-003): unit tests for the request content inventory. The end-to-end cases (refusal before DNS,
 * zero transport calls, acceptance with destination and pinned IP) live in ssrf-cases.ts.
 */
import { describe, expect, it } from "vitest";
import { inventoryRequest, judgeInventory, sendKindOf } from "./content-inventory";

describe("T-SEC-SSRF-043: content inventory", () => {
  it("maps catalog types to sends kinds; anything else keeps its own id (never a public kind)", () => {
    expect(sendKindOf("ipv4", "Network")).toBe("ip");
    expect(sendKindOf("cidr", "Network")).toBe("ip");
    expect(sendKindOf("asn", "Network")).toBe("asn");
    expect(sendKindOf("subdomain", "Domain")).toBe("domain");
    expect(sendKindOf("url_https", "Domain")).toBe("url");
    expect(sendKindOf("ssl_cert_hash", "Network")).toBe("certificate");
    expect(sendKindOf("sha256_hash", "Hash")).toBe("hash");
    expect(sendKindOf("email", "Email")).toBe("email");
    expect(sendKindOf("mac_address", "Network")).toBe("mac_address");
  });

  it("inspects path, query, fragment and header surfaces", () => {
    const f = inventoryRequest(
      new URL("https://h.example/a/8.8.8.8?q=alice%40example.org#bob@example.org"),
      { "x-a": "carol@example.org" },
      undefined,
    );
    expect(f.map((x) => x.surface)).toEqual(expect.arrayContaining(["path", "query", "fragment", "header"]));
  });

  it("does not inspect the destination host itself", () => {
    expect(inventoryRequest(new URL("https://8.8.8.8/"), undefined, undefined)).toEqual([]);
  });

  it("skips a header value that carries the request's own secret (the secret rules govern it)", () => {
    const secret = "alice@example.org";
    expect(inventoryRequest(new URL("https://h.example/"), { authorization: `Bearer ${secret}` }, secret)).toEqual([]);
    expect(inventoryRequest(new URL("https://h.example/"), { authorization: `Bearer ${secret}` }, undefined).length).toBeGreaterThan(0);
  });

  it("the refusal detail names the surface and kind, never the value", () => {
    const v = judgeInventory(inventoryRequest(new URL("https://h.example/?q=alice%40example.org"), undefined, undefined), ["domain"]);
    expect(v?.reason).toBe("undeclared_data");
    expect(v?.detail).not.toContain("alice");
    const np = judgeInventory(inventoryRequest(new URL("https://h.example/A1234567"), undefined, undefined), ["domain"]);
    expect(np?.reason).toBe("natural_person");
    expect(np?.detail).not.toContain("A1234567");
  });

  it("a value whose readings include a declared kind passes; a natural-person reading always refuses", () => {
    const f = inventoryRequest(new URL("https://h.example/8.8.8.8"), undefined, undefined);
    expect(judgeInventory(f, ["ip"])).toBeNull();
    expect(judgeInventory(f, ["domain"])?.reason).toBe("undeclared_data");
  });

  it("known limit: a bare single label is not reported as domain data (documented in content-inventory.ts)", () => {
    expect(inventoryRequest(new URL("https://h.example/intranet?page=1"), undefined, undefined)).toEqual([]);
  });
});
