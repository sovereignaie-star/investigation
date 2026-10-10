import type { Vault } from "@ir/store";

/**
 * Provider calls that need an API key run on the server only (P1-015): the browser asks for a lookup, the server
 * reads the key from the vault and returns the result. The key never reaches the client, a URL it can see, or a log.
 * These mirror the two legacy browser lookups until the Phase 2 connectors replace them.
 */
export const KNOWN_PROVIDERS = [
  "shodan",
  "virustotal",
  "ipinfo",
  "abuseipdb",
  "hunter",
  "haveibeenpwned",
  "numverify",
  "ipgeolocation",
  "clearbit",
  "fullcontact",
  "censys",
  "binaryedge",
  "greynoise",
  "securitytrails",
  "whoisxml",
] as const;

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
const TIMEOUT_MS = 10_000;
const UA = "InvestigationRoom/1.0";

export async function testProviderKey(
  name: string,
  vault: Vault,
  f: FetchLike,
): Promise<{ ok: boolean; tested: boolean; status?: number }> {
  const key = vault.reveal(name);
  if (!key) return { ok: false, tested: false };
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let res: Response;
  switch (name) {
    case "ipinfo":
      res = await f("https://ipinfo.io/8.8.8.8", { headers: { authorization: `Bearer ${key}`, accept: "application/json" }, signal });
      break;
    case "virustotal":
      res = await f("https://www.virustotal.com/api/v3/ip_addresses/8.8.8.8", { headers: { "x-apikey": key }, signal });
      break;
    default:
      return { ok: true, tested: false };
  }
  return { ok: res.ok, tested: true, status: res.status };
}

export async function lookupIp(ip: string, vault: Vault, f: FetchLike): Promise<{ status: number; body: unknown }> {
  const key = vault.reveal("ipinfo");
  const headers: Record<string, string> = { accept: "application/json", "user-agent": UA };
  if (key) headers["authorization"] = `Bearer ${key}`;
  const res = await f(`https://ipinfo.io/${encodeURIComponent(ip)}/json`, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  return { status: res.ok ? 200 : 502, body: res.ok ? await res.json() : { error: `upstream ${res.status}` } };
}

export async function lookupBreaches(email: string, vault: Vault, f: FetchLike): Promise<{ status: number; body: unknown }> {
  const key = vault.reveal("haveibeenpwned");
  if (!key) return { status: 409, body: { error: "haveibeenpwned key not configured" } };
  const res = await f(`https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}`, {
    headers: { "hibp-api-key": key, "user-agent": UA },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 404) return { status: 200, body: { breaches: [] } };
  return { status: res.ok ? 200 : 502, body: res.ok ? { breaches: (await res.json()) as unknown } : { error: `upstream ${res.status}` } };
}
