import type { InvestigationNode, FetchResult } from "../types";
import { detectBest } from "@ir/core/identifiers";

/** Best-ranked type from the multi-candidate engine (P1-006), or "text"; one detector for the whole app (D-027). */
function detectType(value: string): string {
  return detectBest(value)?.type ?? "text";
}

function buildNode(
  id: string,
  value: string,
  identifierType: string,
  result: FetchResult,
  depth: number,
  parentId?: string,
): InvestigationNode {
  return {
    id,
    type: result.nodeType,
    identifier: value,
    identifierType,
    value,
    label: result.label || value,
    data: result.data,
    metadata: result.metadata,
    status: result.error ? "error" : "done",
    error: result.error,
    position: { x: Math.random() * 800, y: Math.random() * 600 },
    depth,
    parentId,
    timestamp: Date.now(),
  };
}

// P1-015: keyed providers are called by the server, which holds the keys; the browser never sees them.
async function fetchIP(value: string): Promise<FetchResult> {
  try {
    const res = await fetch(`/api/lookup/ip/${encodeURIComponent(value)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const children: Array<{ value: string; type: string }> = [];
    if (data.org) children.push({ value: data.org, type: "text" });
    if (data.hostname) children.push({ value: data.hostname, type: "hostname" });
    return {
      nodeType: data.loc ? "location" : "default",
      label: `${data.city || ""} ${data.country || ""}`.trim() || value,
      data: {
        ip: data.ip,
        city: data.city,
        region: data.region,
        country: data.country,
        org: data.org,
        hostname: data.hostname,
        postal: data.postal,
        timezone: data.timezone,
        loc: data.loc,
      },
      metadata: { source: "ipinfo.io", timestamp: Date.now() },
      childIdentifiers: children,
    };
  } catch (e) {
    return { nodeType: "default", data: { ip: value }, metadata: {}, error: String(e) };
  }
}

async function fetchDomain(value: string): Promise<FetchResult> {
  try {
    // D-013: the unused whoisfreaks call (which leaked the target to a third party) was removed in P0-022.
    const [dnsRes] = await Promise.allSettled([fetch(`https://dns.google/resolve?name=${value}&type=A`).then((r) => r.json())]);
    const dns = dnsRes.status === "fulfilled" ? dnsRes.value : null;
    const aRecords = dns?.Answer?.filter((r: { type: number }) => r.type === 1).map((r: { data: string }) => r.data) || [];
    const children = aRecords.map((ip: string) => ({ value: ip, type: "ipv4" }));
    return {
      nodeType: "default",
      label: value,
      data: {
        domain: value,
        aRecords,
        dns: dns?.Answer || [],
      },
      metadata: { source: "dns.google", timestamp: Date.now() },
      childIdentifiers: children,
    };
  } catch (e) {
    return { nodeType: "default", data: { domain: value }, metadata: {}, error: String(e) };
  }
}

async function fetchEmail(value: string): Promise<FetchResult> {
  const results: Record<string, unknown> = { email: value };
  const children: Array<{ value: string; type: string }> = [];

  const domain = value.split("@")[1];
  if (domain) children.push({ value: domain, type: "domain" });

  try {
    const res = await fetch(`/api/lookup/breaches/${encodeURIComponent(value)}`);
    if (res.ok) {
      const { breaches } = (await res.json()) as { breaches: unknown[] };
      results.breaches = breaches;
      results.breachCount = breaches.length;
    }
  } catch {
    // Legacy behaviour kept until P2 adapters replace this file: a failed breach lookup leaves results unchanged.
  }

  return {
    nodeType: "default",
    label: value,
    data: results,
    metadata: { source: "haveibeenpwned", timestamp: Date.now() },
    childIdentifiers: children,
  };
}

async function fetchGitHub(username: string): Promise<FetchResult> {
  try {
    const clean = username.replace(/^https?:\/\/(www\.)?github\.com\//, "").replace(/\/$/, "");
    const [userRes, reposRes] = await Promise.all([
      fetch(`https://api.github.com/users/${clean}`),
      fetch(`https://api.github.com/users/${clean}/repos?per_page=10&sort=stars`),
    ]);
    const user = userRes.ok ? await userRes.json() : null;
    const repos = reposRes.ok ? await reposRes.json() : [];
    const children: Array<{ value: string; type: string }> = [];
    if (user?.email) children.push({ value: user.email, type: "email" });
    if (user?.blog) children.push({ value: user.blog, type: "url" });
    return {
      nodeType: "default",
      label: user?.name || clean,
      data: {
        username: clean,
        name: user?.name,
        bio: user?.bio,
        location: user?.location,
        email: user?.email,
        company: user?.company,
        followers: user?.followers,
        following: user?.following,
        publicRepos: user?.public_repos,
        avatar: user?.avatar_url,
        blog: user?.blog,
        repos: Array.isArray(repos)
          ? repos.map((r: { name: string; description: string; stargazers_count: number; html_url: string }) => ({
              name: r.name,
              description: r.description,
              stars: r.stargazers_count,
              url: r.html_url,
            }))
          : [],
      },
      metadata: { source: "github.com", timestamp: Date.now() },
      childIdentifiers: children,
    };
  } catch (e) {
    return { nodeType: "default", data: { username }, metadata: {}, error: String(e) };
  }
}

async function fetchBitcoin(address: string): Promise<FetchResult> {
  try {
    const res = await fetch(`https://blockchain.info/rawaddr/${address}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return {
      nodeType: "default",
      label: `BTC: ${address.slice(0, 8)}...`,
      data: {
        address,
        balance: data.final_balance / 1e8,
        totalReceived: data.total_received / 1e8,
        totalSent: data.total_sent / 1e8,
        txCount: data.n_tx,
        transactions: (data.txs || []).slice(0, 5).map((tx: { hash: string; time: number; result: number }) => ({
          hash: tx.hash,
          time: tx.time,
          amount: tx.result / 1e8,
        })),
      },
      metadata: { source: "blockchain.info", timestamp: Date.now() },
    };
  } catch (e) {
    return { nodeType: "default", data: { address }, metadata: {}, error: String(e) };
  }
}

async function fetchEthereum(address: string): Promise<FetchResult> {
  try {
    const [balRes, txRes] = await Promise.allSettled([
      fetch(`https://api.etherscan.io/api?module=account&action=balance&address=${address}&tag=latest&apikey=YourApiKeyToken`).then((r) =>
        r.json(),
      ),
      fetch(
        `https://api.etherscan.io/api?module=account&action=txlist&address=${address}&page=1&offset=5&sort=desc&apikey=YourApiKeyToken`,
      ).then((r) => r.json()),
    ]);
    const balance = balRes.status === "fulfilled" ? balRes.value : null;
    const txs = txRes.status === "fulfilled" ? txRes.value : null;
    return {
      nodeType: "default",
      label: `ETH: ${address.slice(0, 8)}...`,
      data: {
        address,
        balanceETH: balance?.result ? (parseInt(balance.result) / 1e18).toFixed(6) : "N/A",
        transactions: (txs?.result || [])
          .slice(0, 5)
          .map((tx: { hash: string; from: string; to: string; value: string; timeStamp: string }) => ({
            hash: tx.hash,
            from: tx.from,
            to: tx.to,
            value: (parseInt(tx.value) / 1e18).toFixed(6),
            time: new Date(parseInt(tx.timeStamp) * 1000).toISOString(),
          })),
      },
      metadata: { source: "etherscan.io", timestamp: Date.now() },
    };
  } catch (e) {
    return { nodeType: "default", data: { address }, metadata: {}, error: String(e) };
  }
}

async function fetchMAC(mac: string): Promise<FetchResult> {
  try {
    const clean = mac.replace(/[:\-]/g, "").slice(0, 6).toUpperCase();
    const res = await fetch(`https://api.macvendors.com/${clean}`);
    const vendor = res.ok ? await res.text() : "Unknown";
    return {
      nodeType: "default",
      label: `MAC: ${vendor}`,
      data: { mac, vendor, oui: clean },
      metadata: { source: "macvendors.com", timestamp: Date.now() },
    };
  } catch (e) {
    return { nodeType: "default", data: { mac }, metadata: {}, error: String(e) };
  }
}

async function fetchURL(url: string): Promise<FetchResult> {
  const domain = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return null;
    }
  })();
  const children = domain ? [{ value: domain, type: "domain" }] : [];
  return {
    nodeType: "link",
    label: url,
    data: { url, domain },
    metadata: { source: "local", timestamp: Date.now() },
    childIdentifiers: children,
  };
}

async function fetchGeneric(value: string, identifierType: string): Promise<FetchResult> {
  return {
    nodeType: "text",
    label: value,
    data: { value, type: identifierType },
    metadata: { source: "local", timestamp: Date.now() },
  };
}

export async function fetchIdentifier(value: string, identifierTypeId: string): Promise<FetchResult> {
  const trimmed = value.trim();

  if (identifierTypeId === "ipv4" || identifierTypeId === "ipv6") {
    return fetchIP(trimmed);
  }
  if (["domain", "subdomain", "hostname", "smtp_server"].includes(identifierTypeId)) {
    return fetchDomain(trimmed);
  }
  if (
    [
      "email",
      "gmail",
      "protonmail",
      "tutanota",
      "outlook",
      "yahoo_mail",
      "icloud_mail",
      "yandex_mail",
      "email_corporate",
      "email_disposable",
    ].includes(identifierTypeId)
  ) {
    return fetchEmail(trimmed);
  }
  if (["github_username", "github_token_classic", "github_token_fine"].includes(identifierTypeId)) {
    return fetchGitHub(trimmed);
  }
  if (["bitcoin_address", "bitcoin_address_p2sh", "bitcoin_address_bech32"].includes(identifierTypeId)) {
    return fetchBitcoin(trimmed);
  }
  if (["ethereum_address", "eth_tx_hash"].includes(identifierTypeId)) {
    return fetchEthereum(trimmed);
  }
  if (["mac_address", "bluetooth_mac", "wifi_bssid"].includes(identifierTypeId)) {
    return fetchMAC(trimmed);
  }
  if (["url", "url_http", "url_https", "url_shortener"].includes(identifierTypeId)) {
    return fetchURL(trimmed);
  }

  return fetchGeneric(trimmed, identifierTypeId);
}

export { buildNode, detectType };
