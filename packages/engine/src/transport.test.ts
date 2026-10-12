import { describe, expect, it } from "vitest";
import { TransportError } from "./transport.ts";

describe("TransportError", () => {
  it("classifies non-retryable failures", () => {
    const e = new TransportError("transport:ssrf-blocked", "loopback refused");
    expect(e.retryable).toBe(false);
    expect(e.kind).toBe("transport:ssrf-blocked");
  });

  it("marks retryable with retryAfterMs", () => {
    const e = new TransportError("transport:rate-limit", "429", { retryable: true, retryAfterMs: 250 });
    expect(e.retryable).toBe(true);
    expect(e.retryAfterMs).toBe(250);
  });
});
