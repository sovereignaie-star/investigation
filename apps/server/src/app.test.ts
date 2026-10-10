import { describe, expect, it } from "vitest";
import { redactRequestUrl } from "./app";

describe("request log redaction (P1-026)", () => {
  it("removes identifiers from current and legacy lookup paths", () => {
    expect(redactRequestUrl("/api/lookup/ip/203.0.113.8?debug=true")).toBe("/api/lookup/[redacted]");
    expect(redactRequestUrl("/api/lookup/breaches/name%40example.com")).toBe("/api/lookup/[redacted]");
  });

  it("keeps non-sensitive route paths without their query string", () => {
    expect(redactRequestUrl("/api/healthz?verbose=1")).toBe("/api/healthz");
    expect(redactRequestUrl(undefined)).toBeUndefined();
  });
});
