import { describe, expect, it } from "vitest";
import { resolveHost, resolvePort } from "./runtime";

describe("runtime network configuration (P1-026)", () => {
  it("binds local startup to loopback unless an address is configured explicitly", () => {
    expect(resolveHost({})).toBe("127.0.0.1");
    expect(resolveHost({ HOST: "192.0.2.10" })).toBe("192.0.2.10");
  });

  it("binds production/container startup publicly only when production is explicit", () => {
    expect(resolveHost({ NODE_ENV: "production" })).toBe("0.0.0.0");
    expect(resolveHost({ NODE_ENV: "production", HOST: "127.0.0.1" })).toBe("127.0.0.1");
  });

  it("accepts valid TCP ports and rejects values outside their range", () => {
    expect(resolvePort({})).toBe(8080);
    expect(resolvePort({ PORT: "65535" })).toBe(65_535);
    expect(() => resolvePort({ PORT: "0" })).toThrow('Invalid PORT value: "0"');
    expect(() => resolvePort({ PORT: "65536" })).toThrow('Invalid PORT value: "65536"');
  });
});
