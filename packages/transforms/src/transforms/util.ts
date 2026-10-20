/**
 * P2-009 — shared helpers for the first transform batch (TR-001..TR-010).
 *
 * Input validation is strict and fail-closed: a transform never sends a
 * malformed or unvalidated value to a provider (D-013, D-015). These helpers
 * are pure string checks — no network, no I/O.
 */

/** Normalize a domain: trim, lowercase, strip a trailing dot. */
export function normalizeDomain(raw: string): string {
  const d = raw.trim().toLowerCase().replace(/\.$/, "");
  if (d.length === 0 || d.length > 253) throw new Error(`invalid domain: "${raw}"`);
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/.test(d)) {
    throw new Error(`invalid domain: "${raw}"`);
  }
  return d;
}

/** Validate an IPv4 address (dotted quad). */
export function isIpv4(raw: string): boolean {
  const parts = raw.trim().split(".");
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

/** Validate an IPv6 address (loose structural check). */
export function isIpv6(raw: string): boolean {
  const s = raw.trim();
  return s.includes(":") && /^[0-9a-fA-F:.]+$/.test(s);
}

/** Validate an ASN (AS followed by 1-10 digits). */
export function isAsn(raw: string): boolean {
  return /^AS\d{1,10}$/i.test(raw.trim());
}

/** Validate a CIDR prefix (IPv4 form). */
export function isPrefix(raw: string): boolean {
  const m = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/.exec(raw.trim());
  if (!m) return false;
  const [ip, bits] = raw.trim().split("/");
  return isIpv4(ip) && Number(bits) <= 32;
}

/** Parse a JSON body defensively; throws a clear error on malformed data. */
export function parseJson(body: string, what: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`TR: malformed JSON from ${what}`);
  }
}

/** Validate an email address (loose structural check, matches email.yaml). */
export function isEmail(raw: string): boolean {
  return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(raw.trim());
}

/** Validate a GitHub username (matches social.yaml github_username). */
export function isGithubUsername(raw: string): boolean {
  return /^[a-zA-Z0-9-]{1,39}$/.test(raw.trim());
}

/** Validate a GitLab username (matches social.yaml gitlab_username). */
export function isGitlabUsername(raw: string): boolean {
  return /^[a-zA-Z0-9_.-]{1,255}$/.test(raw.trim());
}

/** Validate a PGP fingerprint (matches hash.yaml pgp_fingerprint). */
export function isPgpFingerprint(raw: string): boolean {
  return /^[A-F0-9]{4}(\s?[A-F0-9]{4}){9}$/.test(raw.trim());
}

/** Validate a Bitcoin address (matches crypto.yaml bitcoin_address). */
export function isBitcoinAddress(raw: string): boolean {
  return /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(raw.trim());
}

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/**
 * P3-020 / UC-05: verify the Base58Check checksum of a Bitcoin address — the last four bytes
 * must equal the first four bytes of SHA-256(SHA-256(version ‖ payload)). Shape alone is not
 * a valid address (a one-character typo produces a well-shaped but wrong address), so the
 * checksum is verified BEFORE any request. Uses Web Crypto (the same API the sandbox exposes
 * to transforms — node:crypto is not available there), hence async.
 */
export async function verifyBase58Check(raw: string): Promise<boolean> {
  const address = raw.trim();
  if (!isBitcoinAddress(address)) return false;
  let num = 0n;
  for (const ch of address) {
    const digit = BASE58_ALPHABET.indexOf(ch);
    if (digit < 0) return false;
    num = num * 58n + BigInt(digit);
  }
  // minimal big-endian bytes of the decoded number; leading '1' characters are base58 zero
  // bytes (the P2PKH version byte 0x00) and must be restored before hashing
  const minimal: number[] = [];
  for (let rest = num; rest > 0n; rest /= 256n) minimal.unshift(Number(rest % 256n));
  const leadingZeros = /^1+/.exec(address)?.[0].length ?? 0;
  const bytes = [...new Array(leadingZeros).fill(0), ...minimal];
  if (bytes.length < 5) return false;
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return false;
  const first = await subtle.digest("SHA-256", new Uint8Array(bytes.slice(0, bytes.length - 4)));
  const second = await subtle.digest("SHA-256", first);
  const expected = new Uint8Array(second).subarray(0, 4);
  const provided = bytes.slice(bytes.length - 4);
  return expected.every((b, i) => b === provided[i]);
}

/** Validate an Ethereum address (matches crypto.yaml ethereum_address). */
export function isEthereumAddress(raw: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(raw.trim());
}

/** Validate an Ethereum transaction hash (matches crypto.yaml eth_tx_hash). */
export function isEthTxHash(raw: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(raw.trim());
}

/** Validate a SHA-256 hash (matches hash.yaml sha256_hash). */
export function isSha256(raw: string): boolean {
  return /^[a-fA-F0-9]{64}$/.test(raw.trim());
}

/**
 * P2-037 — a source answered with a status the transform cannot read as data: fail the run (a server error or an
 * unexpected status is never "no findings"). `allowed` lists the statuses that carry a meaningful answer.
 */
export function expectStatus(res: { status: number }, allowed: readonly number[], what: string): void {
  if (!allowed.includes(res.status)) throw new Error(`${what} answered HTTP ${res.status}`);
}

/**
 * P2-037 — a DNS-over-HTTPS JSON answer (dns.google `/resolve`): `Status` is the DNS RCODE. NOERROR (0) carries the
 * answers, NXDOMAIN (3) is a genuine "no such name" (no findings). Any other RCODE (SERVFAIL, REFUSED, ...) means the
 * question was not answered: the run fails instead of reporting an empty result.
 */
export interface DohAnswer {
  readonly name?: string;
  readonly type?: number;
  readonly data?: string;
}
export function parseDoh(res: { status: number; body: string }, what: string): DohAnswer[] {
  expectStatus(res, [200], what);
  const data = parseJson(res.body, what) as { Status?: unknown; Answer?: unknown };
  if (typeof data !== "object" || data === null || typeof data.Status !== "number") throw new Error(`${what}: DoH answer has no Status`);
  if (data.Status === 3) return [];
  if (data.Status !== 0) throw new Error(`${what}: DNS RCODE ${data.Status} (question not answered)`);
  if (data.Answer === undefined) return [];
  if (!Array.isArray(data.Answer)) throw new Error(`${what}: DoH Answer is not a list`);
  return data.Answer as DohAnswer[];
}

/** IPv4 dotted quad -> 32-bit unsigned integer (caller validated with `isIpv4`). */
export function ipv4ToInt(ip: string): number {
  return ip
    .trim()
    .split(".")
    .reduce((acc, p) => acc * 256 + Number(p), 0);
}

/** 32-bit unsigned integer -> IPv4 dotted quad. */
export function intToIpv4(n: number): string {
  return [24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join(".");
}

/**
 * P2-037 — the exact list of aligned IPv4 CIDR blocks covering `start..end` inclusive (RFC 4632 aggregation of an
 * arbitrary range). Every block has its host bits zero, so it matches the catalog `cidr` pattern and denotes the
 * network itself, not an address inside it. Throws on a malformed or inverted range.
 */
export function ipv4RangeToCidrs(start: string, end: string): string[] {
  if (!isIpv4(start) || !isIpv4(end)) throw new Error(`invalid IPv4 range "${start}" - "${end}"`);
  let lo = ipv4ToInt(start);
  const hi = ipv4ToInt(end);
  if (lo > hi) throw new Error(`inverted IPv4 range "${start}" - "${end}"`);
  const out: string[] = [];
  while (lo <= hi) {
    // Largest block aligned at `lo` that does not run past `hi`.
    let size = 1;
    while (lo % (size * 2) === 0 && lo + size * 2 - 1 <= hi && size < 2 ** 32) size *= 2;
    out.push(`${intToIpv4(lo)}/${32 - Math.log2(size)}`);
    lo += size;
  }
  return out;
}

/** True when `prefix/len` is an IPv4 network address (host bits zero) with 0 <= len <= 32. */
export function isAlignedIpv4Cidr(cidr: string): boolean {
  if (!isPrefix(cidr)) return false;
  const [ip, bits] = cidr.trim().split("/");
  const len = Number(bits);
  const size = 2 ** (32 - len);
  return ipv4ToInt(ip) % size === 0;
}

/** Strict IPv6 text -> 128-bit BigInt (accepts `::` compression and an embedded IPv4 tail); throws when malformed. */
export function ipv6ToBigInt(raw: string): bigint {
  let s = raw.trim().toLowerCase();
  if (!isIpv6(s)) throw new Error(`invalid IPv6 "${raw}"`);
  const v4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (v4) {
    if (!isIpv4(v4[1])) throw new Error(`invalid IPv6 "${raw}"`);
    const n = ipv4ToInt(v4[1]);
    s = s.slice(0, -v4[1].length) + `${Math.floor(n / 65536).toString(16)}:${(n % 65536).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) throw new Error(`invalid IPv6 "${raw}"`);
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) throw new Error(`invalid IPv6 "${raw}"`);
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  let n = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) throw new Error(`invalid IPv6 "${raw}"`);
    n = (n << 16n) | BigInt(parseInt(g, 16));
  }
  return n;
}

/** True when `ip` (IPv6) lies inside `prefix/len` (IPv6 CIDR). Malformed prefixes are "not inside". */
export function ipv6InCidr(ip: string, cidr: string): boolean {
  const m = /^([0-9a-fA-F:.]+)\/(\d{1,3})$/.exec(cidr.trim());
  if (!m || Number(m[2]) > 128) return false;
  let net: bigint;
  try {
    net = ipv6ToBigInt(m[1]);
  } catch {
    return false;
  }
  const shift = BigInt(128 - Number(m[2]));
  return ipv6ToBigInt(ip) >> shift === net >> shift;
}
