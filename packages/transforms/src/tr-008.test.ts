/**
 * P2-009 — TR-008 contract test (T-RULE-06). Runs the Shodan transform
 * against a deterministic sim and asserts exact findings. The manifest
 * declares a secret (pinned mode); the sim stands in for the egress gateway
 * that would inject the key — no real key or connection is used.
 */
import { describe, expect, it } from "vitest";
import { createSimServer } from "@ir/sim/server";
import { shodanHost } from "./transforms/tr-008-shodan.ts";
import { runTransform } from "./runner.ts";

describe("TR-008 shodan-host", () => {
  it("emits open-port and product findings", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/api\.shodan\.io\/shodan\/host\/8\.8\.8\.8$/,
        response: {
          status: 200,
          body: JSON.stringify({
            ports: [80, 443],
            data: [{ port: 443, product: "nginx", transport: "tcp" }],
          }),
        },
      },
    ]);
    const result = await runTransform(shodanHost, { transport: sim.transport, input: { ip: "8.8.8.8" } });
    expect(result.requestCount).toBe(1);
    const findings = result.output.findings;
    expect(findings).toContainEqual(expect.objectContaining({ predicate: "has_open_port", objectType: "port_service", objectValue: "80" }));
    expect(findings).toContainEqual(
      expect.objectContaining({ predicate: "has_open_port", objectType: "port_service", objectValue: "443" }),
    );
    expect(findings).toContainEqual(expect.objectContaining({ predicate: "runs_service", objectType: "technology", objectValue: "nginx" }));
  });

  it("rejects an invalid IP before any request", async () => {
    const sim = createSimServer([]);
    await expect(runTransform(shodanHost, { transport: sim.transport, input: { ip: "bad" } })).rejects.toThrow(/invalid IP/);
    expect(sim.requestCount()).toBe(0);
  });

  it("returns an empty finding set for a host with no data", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/api\.shodan\.io\/shodan\/host\/8\.8\.8\.8$/,
        response: { status: 200, body: JSON.stringify({ ports: [], data: [] }) },
      },
    ]);
    const result = await runTransform(shodanHost, { transport: sim.transport, input: { ip: "8.8.8.8" } });
    expect(result.output.findings).toHaveLength(0);
  });
});
