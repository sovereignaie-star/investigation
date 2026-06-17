import type { FetchResult, InvestigationConfig } from '../types';
import { investigationDB } from './investigationDatabase';

const CACHE_TTL = 300; // seconds

// Simple in-memory LRU cache
const memCache = new Map<string, { result: FetchResult; expires: number }>();

function getCached(key: string): FetchResult | null {
  const entry = memCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) { memCache.delete(key); return null; }
  return { ...entry.result, cached: true };
}

function setCached(key: string, result: FetchResult, ttl = CACHE_TTL) {
  if (memCache.size > 1000) {
    const firstKey = memCache.keys().next().value;
    if (firstKey) memCache.delete(firstKey);
  }
  memCache.set(key, { result, expires: Date.now() + ttl * 1000 });
}

async function safeFetch(url: string, timeoutMs = 8000): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ---- Decoder functions ----

function decodeJWT(value: string): Record<string, unknown> {
  try {
    const parts = value.split('.');
    if (parts.length !== 3) throw new Error('invalid');
    const header = JSON.parse(atob(parts[0].replace(/-/g, '+').replace(/_/g, '/')));
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return {
      header,
      payload,
      issuedAt: payload.iat ? new Date(payload.iat * 1000).toISOString() : null,
      expiresAt: payload.exp ? new Date(payload.exp * 1000).toISOString() : null,
      issuer: payload.iss || null,
      subject: payload.sub || null,
      isExpired: payload.exp ? Date.now() > payload.exp * 1000 : null,
    };
  } catch {
    return { error: 'Could not decode JWT' };
  }
}

function decodeSnowflake(value: string): Record<string, unknown> {
  try {
    const sf = BigInt(value);
    const DISCORD_EPOCH = 1420070400000n;
    const timestamp = Number((sf >> 22n) + DISCORD_EPOCH);
    return {
      createdAt: new Date(timestamp).toISOString(),
      workerId: Number((sf >> 17n) & 0x1Fn),
      processId: Number((sf >> 12n) & 0x1Fn),
      increment: Number(sf & 0xFFFn),
    };
  } catch {
    return { error: 'Could not decode Snowflake' };
  }
}

function parseCoordinates(value: string): Record<string, unknown> {
  const match = value.match(/^(-?[0-9.]+),\s*(-?[0-9.]+)$/);
  if (!match) return { error: 'Invalid coordinates' };
  const lat = parseFloat(match[1]);
  const lng = parseFloat(match[2]);
  return {
    latitude: lat,
    longitude: lng,
    googleMapsUrl: `https://maps.google.com/?q=${lat},${lng}`,
    osmUrl: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}`,
  };
}

// ---- Fetcher strategies ----

async function fetchIP(ip: string): Promise<Record<string, unknown>> {
  try {
    const data = await safeFetch(`https://ipapi.co/${ip}/json/`) as Record<string, unknown>;
    return data;
  } catch {
    try {
      const data = await safeFetch(`https://ipinfo.io/${ip}/json`) as Record<string, unknown>;
      return data;
    } catch {
      return { ip, error: 'IP lookup failed — try with an API key' };
    }
  }
}

async function fetchDomain(domain: string): Promise<Record<string, unknown>> {
  const clean = domain.replace(/https?:\/\//, '').replace(/\/.*/, '').trim();
  const results: Record<string, unknown> = { domain: clean };
  try {
    const dnsA = await safeFetch(`https://dns.google/resolve?name=${clean}&type=A`) as Record<string, unknown>;
    results.aRecords = (dnsA as { Answer?: unknown[] }).Answer || [];
  } catch { results.aRecords = []; }
  try {
    const dnsMX = await safeFetch(`https://dns.google/resolve?name=${clean}&type=MX`) as Record<string, unknown>;
    results.mxRecords = (dnsMX as { Answer?: unknown[] }).Answer || [];
  } catch { results.mxRecords = []; }
  try {
    const dnsNS = await safeFetch(`https://dns.google/resolve?name=${clean}&type=NS`) as Record<string, unknown>;
    results.nsRecords = (dnsNS as { Answer?: unknown[] }).Answer || [];
  } catch { results.nsRecords = []; }
  try {
    const certs = await safeFetch(`https://crt.sh/?q=%.${clean}&output=json`) as unknown[];
    results.sslCerts = Array.isArray(certs) ? certs.slice(0, 10) : [];
  } catch { results.sslCerts = []; }
  results.queriedAt = new Date().toISOString();
  return results;
}

async function fetchMACVendor(mac: string): Promise<Record<string, unknown>> {
  try {
    const vendor = await fetch(`https://api.macvendors.com/${encodeURIComponent(mac)}`).then(r => r.text());
    return { mac, vendor };
  } catch {
    const oui = mac.replace(/[:-]/g, '').substring(0, 6).toUpperCase();
    return { mac, oui, vendor: 'Lookup failed' };
  }
}

async function fetchBitcoin(address: string): Promise<Record<string, unknown>> {
  try {
    const data = await safeFetch(`https://blockchain.info/rawaddr/${address}`) as Record<string, unknown>;
    return {
      address,
      totalReceived: Number(data.total_received ?? 0) / 1e8,
      totalSent: Number(data.total_sent ?? 0) / 1e8,
      balance: Number(data.final_balance ?? 0) / 1e8,
      txCount: data.n_tx,
    };
  } catch {
    return { address, error: 'Bitcoin lookup failed' };
  }
}

async function fetchEthereum(address: string): Promise<Record<string, unknown>> {
  try {
    const data = await safeFetch(`https://api.etherscan.io/api?module=account&action=balance&address=${address}&tag=latest`) as Record<string, unknown>;
    const balWei = String(data.result ?? '0');
    return { address, balanceWei: balWei, balanceEth: Number(balWei) / 1e18 };
  } catch {
    return { address, error: 'Ethereum lookup failed' };
  }
}

async function fetchEmail(email: string, apiKeys: Record<string, string>): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = { email };
  const domain = email.split('@')[1];
  if (domain) {
    try {
      result.domain = await fetchDomain(domain);
    } catch { /* ignore */ }
  }
  const hibpKey = apiKeys['hibp'];
  if (hibpKey) {
    try {
      const res = await fetch(`https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}`, {
        headers: { 'hibp-api-key': hibpKey, 'user-agent': 'InvestigationRoom/1.0' },
      });
      if (res.status === 404) { result.breaches = []; result.isPwned = false; }
      else if (res.ok) {
        const data = await res.json() as Array<Record<string, unknown>>;
        result.isPwned = true;
        result.breachCount = data.length;
        result.breaches = data.slice(0, 10);
      }
    } catch { result.hibpError = 'Breach check failed'; }
  }
  return result;
}

async function fetchURL(url: string): Promise<Record<string, unknown>> {
  try {
    const parsed = new URL(url);
    const domain = await fetchDomain(parsed.hostname);
    return { url, domain: parsed.hostname, path: parsed.pathname, protocol: parsed.protocol, domainInfo: domain };
  } catch {
    return { url, error: 'Could not analyze URL' };
  }
}

async function fetchGitHub(username: string, apiKeys: Record<string, string>): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { 'Accept': 'application/vnd.github.v3+json' };
  if (apiKeys['github']) headers['Authorization'] = `token ${apiKeys['github']}`;
  try {
    const [user, repos] = await Promise.all([
      fetch(`https://api.github.com/users/${username}`, { headers }).then(r => r.json()),
      fetch(`https://api.github.com/users/${username}/repos?per_page=10&sort=updated`, { headers }).then(r => r.json()),
    ]);
    return { username, profile: user, recentRepos: Array.isArray(repos) ? repos.slice(0, 5) : [] };
  } catch {
    return { username, error: 'GitHub lookup failed' };
  }
}

// ---- Main dispatcher ----

export async function fetchIdentifierData(
  identifierId: string,
  value: string,
  config: Partial<InvestigationConfig> = {}
): Promise<FetchResult> {
  const apiKeys = config.apiKeys || {};
  const cacheKey = `${identifierId}:${value}`;

  // Check memory cache
  const cached = getCached(cacheKey);
  if (cached) return cached;

  // Check DB cache
  const dbCached = await investigationDB.getCachedNode(identifierId, value).catch(() => undefined);
  if (dbCached && Date.now() - dbCached.timestamp < CACHE_TTL * 1000) {
    return { ...dbCached.data, cached: true };
  }

  const now = Date.now();
  let data: Record<string, unknown> = {};
  let source = 'local-decode';

  try {
    switch (identifierId) {
      case 'jwt': data = decodeJWT(value); source = 'local-decode'; break;
      case 'discord-snowflake': data = decodeSnowflake(value); source = 'local-decode'; break;
      case 'coordinates': data = parseCoordinates(value); source = 'local-decode'; break;
      case 'ipv4':
      case 'ipv6': data = await fetchIP(value); source = 'ipapi.co'; break;
      case 'domain': data = await fetchDomain(value); source = 'dns.google'; break;
      case 'url': data = await fetchURL(value); source = 'local+dns'; break;
      case 'mac-address': data = await fetchMACVendor(value); source = 'macvendors.com'; break;
      case 'bitcoin-address': data = await fetchBitcoin(value); source = 'blockchain.info'; break;
      case 'ethereum-address': data = await fetchEthereum(value); source = 'etherscan.io'; break;
      case 'email': data = await fetchEmail(value, apiKeys); source = 'multi'; break;
      case 'github-user-id': data = await fetchGitHub(value.replace('@', ''), apiKeys); source = 'api.github.com'; break;
      case 'sha256-hash':
      case 'sha1-hash':
      case 'md5-hash': data = { hash: value, type: identifierId.toUpperCase(), note: 'Hash lookup requires VirusTotal API key' }; source = 'local-decode'; break;
      default: data = { value, identifierType: identifierId, note: 'No automated lookup available for this type' }; source = 'local'; break;
    }
  } catch (err) {
    data = { error: String(err), value };
  }

  const result: FetchResult = { success: true, data, source, cached: false, timestamp: now };

  // Cache
  setCached(cacheKey, result);
  investigationDB.cacheNode({ id: cacheKey, identifierType: identifierId, identifierValue: value, data: result, timestamp: now }).catch(() => {});

  return result;
}
