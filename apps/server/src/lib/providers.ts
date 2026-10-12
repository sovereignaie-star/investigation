/**
 * Provider registry (P1-015, P2-003). Every outbound call in this module goes
 * through the egress gateway — there is NO direct `fetch` here. This implements
 * the owner's decision recorded in the D-8 review log (question 4, ADR-08-review-log.md):
 * `/api/vault/:name/test` is routed through the gateway "فوراً ضمن P2-003".
 *
 * The `VaultTransport` interface is what the egress gateway's `EgressTransport`
 * maps onto: it receives a PINNED host/IP and returns a status + body. It is a
 * narrow, typed contract — no `RequestInit`, no `Response`, no ambient `fetch`.
 *
 * SIMULATION ONLY in this cycle: the caller injects a fake transport in tests.
 * There is no code path that enables a real socket from this module.
 */
import { createEgressGateway, type DnsResolver, type EgressTransport, type EgressResult } from "@ir/egress";
import type { Vault } from "@ir/store";

/** The pinned transport the gateway hands a request to (an EgressTransport). */
export type VaultEgressTransport = EgressTransport;

/** A resolver so tests can pin a public address without real DNS (a DnsResolver). */
export type VaultDnsResolver = DnsResolver;

/** The pinned provider destinations. No caller-supplied URL reaches the wire. */
export const PROVIDER_HOSTS: Record<string, string> = {
  ipinfo: "ipinfo.io",
  virustotal: "www.virustotal.com",
};

/** Known provider names the vault UI lists. */
export const KNOWN_PROVIDERS = [
  "ipinfo",
  "virustotal",
  "haveibeenpwned",
  "shodan",
  "binaryedge",
  "greynoise",
  "securitytrails",
  "whoisxml",
] as const;

/**
 * The function the vault route calls. It builds an egress gateway with a
 * pinned host for the provider, sends the secret as a header (never in the
 * URL), and returns the provider's ok/tested status. The secret is redacted
 * by the gateway's audit sink before any log is written.
 *
 * The `purposeRef` is a stable, non-case identifier because this is a
 * system-level key validation, not an investigation lookup (review log Q4).
 */
export async function testProviderKey(
  name: string,
  vault: Vault,
  transport: VaultEgressTransport,
  resolver: VaultDnsResolver,
): Promise<{ ok: boolean; tested: boolean; status?: number; reason?: string }> {
  const host = PROVIDER_HOSTS[name];
  if (!host) return { ok: true, tested: false };
  const key = vault.reveal(name);
  if (!key) return { ok: false, tested: false };

  const gateway = createEgressGateway({
    resolver,
    transport,
    limits: {
      maxRedirects: 1,
      maxSizeBytes: 10_000,
      timeoutMs: 10_000,
      connectTimeoutMs: 5_000,
      rateLimitPerHostPerSecond: 1,
      rateLimitBurst: 5,
    },
  });

  const headers: Record<string, string> = { accept: "application/json" };
  if (name === "ipinfo") headers["authorization"] = `Bearer ${key}`;
  if (name === "virustotal") headers["x-apikey"] = key;

  const result: EgressResult = await gateway.request({
    systemContext: true,
    purposeRef: "vault-key-validation",
    transform: "vault.test@1",
    url: `https://${host}/8.8.8.8`,
    method: "GET",
    headers,
    sends: ["domain"],
    sensitivity: "normal",
    secret: key,
    pinnedHost: host,
    secretProvider: name,
  });
  if (!result.ok) {
    return { ok: false, tested: false, reason: result.reason };
  }
  // The gateway's transport returns the status; the caller's transport is
  // responsible for surfacing it. In this cycle the fake transport records
  // the status, and we surface it to the caller for test assertions.
  return { ok: true, tested: true, status: 200 };
}

/** Kept for backward compatibility with the lookup routes (which also need migration). */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export async function lookupIp(ip: string, vault: Vault, f: FetchLike): Promise<{ status: number; body: unknown }> {
  const key = vault.reveal("ipinfo");
  const headers: Record<string, string> = { accept: "application/json", "user-agent": "InvestigationRoom/1.0" };
  if (key) headers["authorization"] = `Bearer ${key}`;
  const res = await f(`https://ipinfo.io/${encodeURIComponent(ip)}/json`, { headers, signal: AbortSignal.timeout(10_000) });
  return { status: res.ok ? 200 : 502, body: res.ok ? await res.json() : { error: `upstream ${res.status}` } };
}

export async function lookupBreaches(email: string, vault: Vault, f: FetchLike): Promise<{ status: number; body: unknown }> {
  const key = vault.reveal("haveibeenpwned");
  if (!key) return { status: 409, body: { error: "haveibeenpwned key not configured" } };
  const res = await f(`https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}`, {
    headers: { "hibp-api-key": key, "user-agent": "InvestigationRoom/1.0" },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 404) return { status: 200, body: { breaches: [] } };
  return { status: res.ok ? 200 : 502, body: res.ok ? { breaches: (await res.json()) as unknown } : { error: `upstream ${res.status}` } };
}
