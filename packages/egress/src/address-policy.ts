/**
 * Address classification policy (ADR-08 section 4).
 *
 * Accept globally-reachable public addresses; reject everything else.
 * The classifier uses a rule table derived from the IANA special-purpose
 * registries (docs/adr/reference/iana/) — NOT a hand-written private blocklist.
 *
 * Design notes (in response to review):
 * - Parsing is STRICT: hex groups that parse as a number followed by garbage
 *   are rejected (Number.parseInt accepts prefixes, so we validate the full group).
 * - Embedded IPv4 is extracted from the dotted form AND the equivalent hex form
 *   (a URL parser may produce ::ffff:a.b.c.d or 0::ffff:7f00:1).
 * - 6to4 / Teredo / NAT64-local rejections are done by PREFIX MATCH on the
 *   parsed bytes, not string prefixes.
 * - Missing classification NEVER becomes an implicit allow (deny-by-default).
 *
 * This module is PURE: no DNS, no network, no environment reads.
 */

export type AddressClass =
  | "public"
  | "private"
  | "loopback"
  | "link_local"
  | "multicast"
  | "unspecified"
  | "reserved"
  | "tunnel"
  | "nat_local"
  | "not_globally_reachable";

export interface AddressVerdict {
  readonly ok: boolean;
  readonly kind: AddressClass;
  /** Human-readable reason; never contains the address itself. */
  readonly reason: string;
}

interface Rule {
  readonly network: Uint8Array; // 4 bytes (v4) or 16 bytes (v6)
  readonly prefixLen: number;
  readonly kind: AddressClass;
  readonly label: string;
}

const V4: Array<[string, AddressClass]> = [
  ["0.0.0.0/8", "unspecified"],
  ["10.0.0.0/8", "private"],
  ["100.64.0.0/10", "private"], // CGNAT: Forwardable=True, Globally Reachable=False
  ["127.0.0.0/8", "loopback"],
  ["169.254.0.0/16", "link_local"],
  ["172.16.0.0/12", "private"],
  ["192.0.0.0/24", "reserved"], // IETF Protocol Assignments
  ["192.0.0.0/29", "reserved"], // IPv4 Service Continuity
  // GR=True per IANA snapshot; longest-prefix wins over the /24 above.
  ["192.0.0.9/32", "public"], // Port Control Protocol Anycast
  ["192.0.0.10/32", "public"], // Traversal Using Relays around NAT Anycast
  ["192.0.2.0/24", "reserved"], // TEST-NET-1
  ["192.31.196.0/24", "public"], // AS112 — GR=True
  ["192.52.193.0/24", "public"], // AMT — GR=True
  ["192.88.99.0/24", "reserved"], // 6to4 Relay Anycast (deprecated)
  ["192.175.48.0/24", "reserved"], // AS112 v4 anycast — v6 counterpart is a policy refusal (see V6)
  ["192.168.0.0/16", "private"],
  ["198.18.0.0/15", "reserved"], // Benchmarking
  ["198.51.100.0/24", "reserved"], // TEST-NET-2
  ["203.0.113.0/24", "reserved"], // TEST-NET-3
  ["224.0.0.0/4", "multicast"],
  ["240.0.0.0/4", "reserved"], // Reserved incl. 255.255.255.255
];

const V6: Array<[string, AddressClass]> = [
  ["::/128", "unspecified"],
  ["::1/128", "loopback"],
  ["::ffff:0:0/96", "tunnel"], // IPv4-mapped → extracted
  ["64:ff9b::/96", "tunnel"], // NAT64 public → extracted
  ["64:ff9b:1::/48", "nat_local"], // NAT64 local → always rejected
  ["::/96", "tunnel"], // IPv4-compatible (deprecated) → extracted
  ["100::/64", "reserved"], // Discard-only
  ["2001::/32", "tunnel"], // Teredo → always rejected
  ["2001:1::1/128", "public"], // Port Control Protocol Anycast
  ["2001:1::2/128", "public"], // Traversal Using Relays around NAT Anycast
  ["2001:1::3/128", "public"], // NAT64 DNS64 Discovery Anycast
  ["2001:2::/48", "reserved"], // Benchmarking
  ["2001:3::/32", "public"], // AMT
  ["2001:4:112::/48", "public"], // AS112
  ["2001:10::/28", "reserved"], // ORCHID (deprecated)
  ["2001:20::/28", "reserved"], // ORCHIDv2 — ADR-08 policy reject
  ["2001:30::/28", "public"], // DETs
  ["2001:db8::/32", "reserved"], // Documentation
  ["2002::/16", "tunnel"], // 6to4 → always rejected
  ["3fff::/20", "reserved"], // Documentation (RFC 9637)
  ["5f00::/16", "reserved"], // SRv6
  ["fc00::/7", "private"], // ULA
  ["fe80::/10", "link_local"],
  ["ff00::/8", "multicast"],
  ["2001::/23", "reserved"], // IETF Protocol Assignments fallback
];

function parseCidr(cidr: string, bytes: 4 | 16): { network: Uint8Array; prefixLen: number } | null {
  const idx = cidr.indexOf("/");
  const netStr = idx < 0 ? cidr : cidr.slice(0, idx);
  const lenStr = idx < 0 ? String(bytes * 8) : cidr.slice(idx + 1);
  const prefixLen = Number(lenStr);
  if (!Number.isInteger(prefixLen) || prefixLen < 0 || prefixLen > bytes * 8) return null;
  const network = bytes === 4 ? parseIpv4(netStr) : parseIpv6Network(netStr);
  if (network === null) return null;
  // Zero out host bits.
  const out = new Uint8Array(network);
  const fullBytes = Math.floor(prefixLen / 8);
  const remBits = prefixLen % 8;
  if (remBits > 0) out[fullBytes] &= (0xff << (8 - remBits)) & 0xff;
  for (let i = fullBytes + (remBits > 0 ? 1 : 0); i < bytes; i++) out[i] = 0;
  return { network: out, prefixLen };
}

/** Parse an IPv6 NETWORK string (no zone IDs, allows all-zero and full forms). */
function parseIpv6Network(s: string): Uint8Array | null {
  if (s === "::") return new Uint8Array(16); // special case: all-zero network
  return parseIpv6(s);
}

const V4_RULES: readonly Rule[] = V4.map(([cidr, kind]) => {
  const r = parseCidr(cidr, 4);
  if (!r) throw new Error(`bad v4 rule ${cidr}`);
  return { network: r.network, prefixLen: r.prefixLen, kind, label: cidr };
});

const V6_RULES: readonly Rule[] = V6.map(([cidr, kind]) => {
  const r = parseCidr(cidr, 16);
  if (!r) throw new Error(`bad v6 rule ${cidr}`);
  return { network: r.network, prefixLen: r.prefixLen, kind, label: cidr };
});

function matchRule(addr: Uint8Array, rules: readonly Rule[], _byteLen: 4 | 16): Rule | null {
  let best: Rule | null = null;
  for (const r of rules) {
    const fullBytes = Math.floor(r.prefixLen / 8);
    const remBits = r.prefixLen % 8;
    let ok = true;
    for (let i = 0; i < fullBytes && ok; i++) if (addr[i] !== r.network[i]) ok = false;
    if (ok && remBits > 0) {
      const mask = (0xff << (8 - remBits)) & 0xff;
      if ((addr[fullBytes] & mask) !== (r.network[fullBytes] & mask)) ok = false;
    }
    if (ok && (!best || r.prefixLen > best.prefixLen)) best = r;
  }
  return best;
}

// ---------- strict parsers ----------

export function isIpv4(s: string): boolean {
  return parseIpv4(s) !== null;
}
export function isIpv6(s: string): boolean {
  return parseIpv6(s) !== null;
}

function parseIpv4(s: string): Uint8Array | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const out = new Uint8Array(4);
  for (let i = 1; i <= 4; i++) {
    const t = m[i];
    if (t.length > 1 && t[0] === "0") return null; // no leading zeros
    const n = Number(t);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    out[i - 1] = n;
  }
  return out;
}

function parseIpv6(s: string): Uint8Array | null {
  if (s.includes("%")) return null; // reject zone IDs
  // "::" (all-zero) and "::1" (loopback) are special forms; handle first.
  if (s === "::") return new Uint8Array(16);
  if (s === "::1") {
    const b = new Uint8Array(16);
    b[15] = 1;
    return b;
  }
  let ip = s;
  // Convert an embedded dotted IPv4 tail to hex groups.
  const lastColon = ip.lastIndexOf(":");
  if (lastColon >= 0 && ip.includes(".")) {
    const tail = ip.slice(lastColon + 1);
    const v4 = parseIpv4(tail);
    if (v4 === null) return null;
    ip = ip.slice(0, lastColon + 1) + hex16((v4[0] << 8) | v4[1]) + ":" + hex16((v4[2] << 8) | v4[3]);
  }
  // Reject anything with characters outside hex digits, ':' or '.'.
  if (!/^[0-9a-fA-F:]*$/.test(ip.replace(/\./g, ""))) return null;
  let parts = ip.split(":");
  const empties = parts.filter((p) => p === "").length;
  if (empties > 2) return null;
  const dbl = parts.indexOf("");
  if (dbl >= 0) {
    // '::' expansion — must keep a placeholder so split works.
    const before = parts.slice(0, dbl).filter((p) => p !== "");
    const after = parts.slice(dbl + 1).filter((p) => p !== "");
    // Count groups: for '::' at start/end the empty string adds a phantom group.
    const fill = 8 - before.length - after.length;
    if (fill < 0) return null;
    parts = [...before, ...Array<string>(fill).fill("0"), ...after];
  }
  if (parts.length !== 8) return null;
  const out = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    const g = parts[i];
    // STRICT hex group: must be 1..4 hex digits and nothing else.
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    const v = Number.parseInt(g, 16);
    out[i * 2] = v >>> 8;
    out[i * 2 + 1] = v & 0xff;
  }
  return out;
}

function hex16(n: number): string {
  return n.toString(16).padStart(4, "0");
}

// ---------- embedded-IPv4 extraction ----------

function extractEmbeddedV4(bytes: Uint8Array): Uint8Array | null {
  // ::ffff:0:0/96 → bytes 0..11 are 0,0,0,0,0,0,0,0,0,0,0xff,0xff
  if (bytes[10] === 0xff && bytes[11] === 0xff && bytes.slice(0, 10).every((b) => b === 0)) {
    return bytes.slice(12, 16);
  }
  // ::/96 (IPv4-compatible, deprecated) → all-zero except last 4 bytes.
  // EXCLUDE :: and ::1 (handled by ::/128 and ::1/128 rules).
  const last4 = bytes.slice(12, 16);
  const isLoopback = last4[0] === 0 && last4[1] === 0 && last4[2] === 0 && last4[3] === 1;
  const isAllZero = last4.every((b) => b === 0);
  if (bytes.slice(0, 12).every((b) => b === 0) && !isLoopback && !isAllZero) {
    return last4;
  }
  return null;
}

function extractNat64(bytes: Uint8Array): Uint8Array | null {
  // 64:ff9b::/96 → bytes 0064:ff9b:0000:0000:0000:0000, last 32 bits = IPv4
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b && bytes.slice(4, 12).every((b) => b === 0)) {
    return bytes.slice(12, 16);
  }
  return null;
}

// ---------- public API ----------

/** Classify a single IPv4 dotted-quad. */
export function classifyV4(ip: string): AddressVerdict {
  const b = parseIpv4(ip);
  if (b === null) return { ok: false, kind: "not_globally_reachable", reason: "not a strict IPv4 address" };
  const r = matchRule(b, V4_RULES, 4);
  if (r) return { ok: r.kind === "public", kind: r.kind, reason: `matched ${r.label}` };
  // IPv4 default: globally reachable unless a rule matched (multicast already in table).
  return { ok: true, kind: "public", reason: "no special-purpose rule matched" };
}

/** Classify a single IPv6 address. */
export function classifyV6(ip: string): AddressVerdict {
  const b = parseIpv6(ip);
  if (b === null) return { ok: false, kind: "not_globally_reachable", reason: "not a strict IPv6 address" };
  // NAT64 local: 64:ff9b:1::/48 → always reject.
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && b[4] === 0x00 && b[5] === 0x01) {
    return { ok: false, kind: "nat_local", reason: "NAT64 local (RFC 8215) — unverifiable destination" };
  }
  // NAT64 public: extract IPv4 and classify it.
  const nat = extractNat64(b);
  if (nat !== null) {
    const v4 = classifyV4Bytes(nat);
    return { ok: v4.ok, kind: v4.kind, reason: `NAT64 embedded IPv4: ${v4.reason}` };
  }
  // IPv4-mapped / compatible: extract and classify.
  const emb = extractEmbeddedV4(b);
  if (emb !== null) {
    const v4 = classifyV4Bytes(emb);
    return { ok: v4.ok, kind: v4.kind, reason: `embedded IPv4: ${v4.reason}` };
  }
  // General rules.
  const r = matchRule(b, V6_RULES, 16);
  if (r) return { ok: r.kind === "public", kind: r.kind, reason: `matched ${r.label}` };
  // IPv6 default: only 2000::/3 is globally reachable.
  if ((b[0] & 0xe0) === 0x20) return { ok: true, kind: "public", reason: "inside 2000::/3" };
  return { ok: false, kind: "not_globally_reachable", reason: "outside 2000::/3" };
}

function classifyV4Bytes(b: Uint8Array): AddressVerdict {
  const r = matchRule(b, V4_RULES, 4);
  if (r) return { ok: r.kind === "public", kind: r.kind, reason: `matched ${r.label}` };
  return { ok: true, kind: "public", reason: "no special-purpose rule matched" };
}

/** Classify any address string. */
export function classifyAddress(ip: string): AddressVerdict {
  const clean = ip.trim().replace(/^\[|\]$/g, "");
  if (isIpv4(clean)) return classifyV4(clean);
  if (isIpv6(clean)) return classifyV6(clean);
  return { ok: false, kind: "not_globally_reachable", reason: "not an IP address" };
}

// Exposed for differential testing against the reference CSV.
export const RULES = { v4: V4_RULES, v6: V6_RULES };
export { parseIpv4, parseIpv6 };
