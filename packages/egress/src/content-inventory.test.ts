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

  // ---- detection limits (P2-003, 2026-10-13): what the check does NOT find, stated as tests ----
  const passes = (u: string, sends: string[] = []) => judgeInventory(inventoryRequest(new URL(u), undefined, undefined), sends);

  it("a person's name on the wire refuses ALWAYS (P2-011 review fix): the screening subject's name never goes on the wire, even when the run declares person_name; a single-word value and free text are not found", () => {
    // P2-011 (review fix, 2026-10-15): person_name is a catalog type since TR-026, and a two-word name
    // on the wire is the subject's own data — it refuses as natural_person whatever sends declares
    // (ADR-08 reason precedence: the protected category is recorded first). The person transforms
    // download fixed files and match locally, so a legitimate person run never trips this.
    expect(passes("https://h.example/?name=John%20Smith")).toEqual({
      reason: "natural_person",
      detail: "query carries a natural-person identifier (person_name)",
    });
    expect(passes("https://h.example/?name=John%20Smith", ["person_name"])).toEqual({
      reason: "natural_person",
      detail: "query carries a natural-person identifier (person_name)",
    });
    expect(passes("https://h.example/?name=Bob", ["person_name"])).toBeNull();
    expect(passes("https://h.example/?addr=12%20Main%20Street")).toBeNull();
    expect(passes("https://h.example/?note=suspect%20lives%20in%20Riyadh")).toBeNull();
  });

  it("known limit: an encoding the detector does not undo hides the value (base64 of an email address)", () => {
    expect(passes("https://h.example/?b64=YWxpY2VAZXhhbXBsZS5vcmc%3D")).toBeNull();
  });

  it("internal names: a dotted internal name is domain data; a bare label is not found (known limit)", () => {
    expect(passes("https://h.example/host.corp.local")?.reason).toBe("undeclared_data");
    expect(passes("https://h.example/host.corp.local", ["domain"])).toBeNull();
    expect(passes("https://h.example/fileserver01")).toBeNull();
  });

  it("ambiguous numbers: the boundary is the catalog's natural-person patterns, not a length rule", () => {
    for (const n of ["2", "12345", "12345678", "1234567890"]) expect(passes(`https://h.example/?id=${n}`), n).toBeNull();
    // over-refusal accepted as fail-closed until P2-013: 11-13 digit values match national-id patterns
    for (const n of ["12345678901", "123456789012", "1760300000000"])
      expect(passes(`https://h.example/?id=${n}`)?.reason, n).toBe("natural_person");
  });

  it("known identifiers with their own evidence are found without any context word", () => {
    expect(passes("https://h.example/?x=4111111111111111")?.reason).toBe("undeclared_data");
    expect(passes("https://h.example/AKIAIOSFODNN7EXAMPLE")?.reason).toBe("undeclared_data");
    expect(passes("https://h.example/?x=%2B966501234567")?.reason).toBe("undeclared_data");
  });
});
