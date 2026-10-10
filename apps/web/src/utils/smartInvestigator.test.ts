import { describe, expect, it } from "vitest";
import { makeNodeId } from "./smartInvestigator";

describe("makeNodeId uses the canonical key (D-020, D-021)", () => {
  it("merges spellings of one identifier", () => {
    expect(makeNodeId("Example.COM.", "domain")).toBe(makeNodeId("example.com", "domain"));
  });
  it("keeps long and symbol-heavy values distinct", () => {
    const base = "https://example.com/" + "x".repeat(60);
    expect(makeNodeId(base + "/1", "url")).not.toBe(makeNodeId(base + "/2", "url"));
    expect(makeNodeId("a+b@x.com", "email")).not.toBe(makeNodeId("a/b@x.com", "email"));
  });
  it("falls back to text when the value does not fit its detected type", () => {
    expect(makeNodeId("999.1.1.1", "ipv4")).toBe("text:999.1.1.1");
  });
});
