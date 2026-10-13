import { describe, expect, it } from "vitest";
import { createEgressGateway } from "./egress.ts";
import { createVaultKeyValidationCapability, vaultGatewayOptions } from "./vault-capability.ts";

/** A resolver that answers with a public IP for any host in the map. */
function fakeResolver(map: Record<string, string[]>) {
  return { resolve: async (h: string) => map[h] ?? [] };
}
/** A transport that records calls and returns a fixed response. */
function fakeTransport(status = 200, body = "ok") {
  const calls: unknown[] = [];
  return {
    calls,
    async fetch(req: unknown) {
      calls.push(req);
      return { status, body };
    },
  };
}

describe("vault capability (private symbol)", () => {
  it("a systemContext request without a caseId is denied when no capability is attached", async () => {
    const t = fakeTransport();
    const resolver = fakeResolver({ "ipinfo.io": ["93.184.216.34"] });
    const g = createEgressGateway({ resolver, transport: t });
    const r = await g.request({
      systemContext: true,
      purposeRef: "vault-key-validation",
      transform: "vault.test@1",
      url: "https://ipinfo.io/8.8.8.8",
      method: "GET",
      headers: { accept: "application/json" },
      sends: ["ip"],
      sensitivity: "normal",
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("no_case");
    expect(r.transportCalls).toBe(0);
  });

  it("with a capability attached, a systemContext vault request is allowed through the shared gateway", async () => {
    const events: unknown[] = [];
    const sink = { record: (e: unknown) => events.push(e) };
    const cap = createVaultKeyValidationCapability(
      {
        ipinfo: { hosts: "ipinfo.io", paths: ["/8.8.8.8"] },
        virustotal: { hosts: "www.virustotal.com", paths: ["/api/v3/ip_addresses/8.8.8.8"] },
      },
      sink,
    );
    const t = fakeTransport(200, '{"ok":true}');
    const resolver = fakeResolver({ "ipinfo.io": ["93.184.216.34"] });
    const opts = vaultGatewayOptions(cap, resolver, t, {
      maxRedirects: 1,
      maxSizeBytes: 10_000,
      timeoutMs: 10_000,
      connectTimeoutMs: 5_000,
      rateLimitPerHostPerSecond: 1,
      rateLimitBurst: 5,
    });
    const g = createEgressGateway(opts);
    const r = await g.request({
      systemContext: true,
      purposeRef: "vault-key-validation",
      transform: "vault.test@1",
      url: "https://ipinfo.io/8.8.8.8",
      method: "GET",
      headers: { accept: "application/json" },
      sends: ["ip"],
      sensitivity: "normal",
      secret: "vault-secret",
      pinnedHost: "ipinfo.io",
      secretProvider: "ipinfo",
      capability: cap,
    });
    expect(r.ok).toBe(true);
    expect(r.transportCalls).toBe(1);
    expect(r.response?.status).toBe(200);
    expect(r.response?.body).toBe('{"ok":true}');
    expect(r.response?.host).toBe("ipinfo.io");
    // the audit sink fired and never received a raw secret
    expect(events.length).toBeGreaterThan(0);
    const json = JSON.stringify(events);
    expect(json).not.toContain("vault-secret");
  });

  it("a forged capability object cannot bypass the caseId requirement", async () => {
    const resolver = fakeResolver({ "ipinfo.io": ["93.184.216.34"] });
    const t = fakeTransport();
    const g = createEgressGateway({ resolver, transport: t });
    const fake = { kind: "vault-key-validation", allowedHosts: ["ipinfo.io"], auditSink: { record: () => {} } };
    const r = await g.request({
      systemContext: true,
      purposeRef: "vault-key-validation",
      transform: "vault.test@1",
      url: "https://ipinfo.io/8.8.8.8",
      sends: ["ip"],
      capability: fake,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("no_case");
    expect(t.calls.length).toBe(0);
  });

  it("a vault capability request to a host outside its list is denied before transport", async () => {
    const cap = createVaultKeyValidationCapability({ ipinfo: { hosts: "ipinfo.io", paths: ["/8.8.8.8"] } }, { record: () => {} });
    const t = fakeTransport();
    const resolver = fakeResolver({ "evil.example": ["93.184.216.34"] });
    const opts = vaultGatewayOptions(cap, resolver, t);
    const g = createEgressGateway(opts);
    const r = await g.request({
      systemContext: true,
      purposeRef: "vault-key-validation",
      transform: "vault.test@1",
      url: "https://evil.example/8.8.8.8",
      sends: ["ip"],
      sensitivity: "normal",
      pinnedHost: "evil.example",
      capability: cap,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("host_not_allowed");
    expect(r.transportCalls).toBe(0);
  });

  it("createVaultKeyValidationCapability rejects an empty allowedHosts list", () => {
    expect(() => createVaultKeyValidationCapability({}, { record: () => {} })).toThrow(RangeError);
  });
});
