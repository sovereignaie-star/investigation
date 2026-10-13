/**
 * Pure reference model of the ADR-08 section 4 address policy, built directly on the dated IANA special-purpose
 * registry snapshot in this directory (T-SEC-SSRF-045, P2-003).
 *
 * This is NOT the gateway classifier and shares no code with it (`packages/egress/src/address-policy.ts`): it parses
 * the CSV files itself, does prefix arithmetic on BigInt, and applies the section 4 rules as written in ADR-08:
 *
 *   1. the longest matching prefix decides, among the registry rows and the ADR-08 policy rows below
 *      (on an equal prefix the policy row wins, because it is the documented decision about that very block);
 *   2. a registry row decides by "Globally Reachable": "True" (footnotes ignored) accepts, anything else refuses;
 *   3. no matching row: IPv4 accepts except 224.0.0.0/4; IPv6 accepts only inside 2000::/3.
 *
 * Policy rows are the ADR-08 section 4 table, each with its reason. Nothing else is hand-written.
 * PURE: no network, no DNS, no environment; the only input is the two CSV files.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type Family = 4 | 6;

export interface Block {
  readonly family: Family;
  readonly network: bigint;
  readonly prefix: number;
  readonly cidr: string;
}

export type Treatment =
  | { readonly kind: "registry"; readonly globallyReachable: string; readonly name: string }
  | { readonly kind: "policy_deny"; readonly why: string }
  | { readonly kind: "policy_allow"; readonly why: string }
  | { readonly kind: "embedded_v4"; readonly why: string };

export interface Row {
  readonly block: Block;
  readonly treatment: Treatment;
}

export interface ReferenceVerdict {
  readonly allow: boolean;
  /** Which row (or default) decided, for diagnostics. */
  readonly by: string;
}

const BITS: Record<Family, number> = { 4: 32, 6: 128 };

// ---------- parsing (independent of the gateway's parser) ----------

export function parseV4(s: string): bigint | null {
  const parts = s.split(".");
  if (parts.length !== 4) return null;
  let v = 0n;
  for (const p of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    v = (v << 8n) | BigInt(n);
  }
  return v;
}

export function parseV6(s: string): bigint | null {
  let text = s;
  // a trailing dotted IPv4 becomes two groups
  const lastColon = text.lastIndexOf(":");
  if (text.includes(".")) {
    const v4 = parseV4(text.slice(lastColon + 1));
    if (v4 === null) return null;
    text = `${text.slice(0, lastColon + 1)}${(v4 >> 16n).toString(16)}:${(v4 & 0xffffn).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] === "" ? [] : halves[0].split(":");
  const tail = halves.length === 2 ? (halves[1] === "" ? [] : halves[1].split(":")) : [];
  const groups = halves.length === 2 ? [...head, ...Array<string>(8 - head.length - tail.length).fill("0"), ...tail] : head;
  if (groups.length !== 8) return null;
  let v = 0n;
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    v = (v << 16n) | BigInt(Number.parseInt(g, 16));
  }
  return v;
}

export function parseBlock(cidr: string): Block {
  const [addr, len] = cidr.trim().split("/");
  const family: Family = addr.includes(":") ? 6 : 4;
  const value = family === 4 ? parseV4(addr) : parseV6(addr);
  const prefix = len === undefined ? BITS[family] : Number(len);
  if (value === null || !Number.isInteger(prefix) || prefix < 0 || prefix > BITS[family]) throw new Error(`bad block ${cidr}`);
  const host = BigInt(BITS[family] - prefix);
  return { family, network: (value >> host) << host, prefix, cidr: cidr.trim() };
}

export function contains(b: Block, family: Family, v: bigint): boolean {
  if (b.family !== family) return false;
  const host = BigInt(BITS[family] - b.prefix);
  return v >> host === b.network >> host;
}

export function lastOf(b: Block): bigint {
  return b.network | ((1n << BigInt(BITS[b.family] - b.prefix)) - 1n);
}

export function formatV4(v: bigint): string {
  return [24n, 16n, 8n, 0n].map((s) => String((v >> s) & 255n)).join(".");
}

/** Full, uncompressed form (8 groups). */
export function formatV6(v: bigint): string {
  const g: string[] = [];
  for (let i = 7; i >= 0; i--) g.push(((v >> BigInt(i * 16)) & 0xffffn).toString(16));
  return g.join(":");
}

// ---------- the registry snapshot ----------

/** RFC 4180 CSV (quoted fields may contain commas, quotes and newlines). */
export function parseCsv(text: string): Record<string, string>[] {
  const records: string[][] = [];
  let field = "";
  let rec: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      rec.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      rec.push(field);
      field = "";
      if (rec.some((f) => f !== "")) records.push(rec);
      rec = [];
    } else field += ch;
  }
  if (field !== "" || rec.length > 0) {
    rec.push(field);
    records.push(rec);
  }
  const [header, ...body] = records;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

const stripNotes = (s: string): string => s.replace(/\s*\[\d+\]/g, "").trim();

export const SNAPSHOT_DIR = dirname(fileURLToPath(import.meta.url));

export function registryRows(dir = SNAPSHOT_DIR): Row[] {
  const out: Row[] = [];
  for (const file of ["iana-ipv4-special-purpose-registry.csv", "iana-ipv6-special-purpose-registry.csv"]) {
    for (const r of parseCsv(readFileSync(resolve(dir, file), "utf8"))) {
      for (const cidr of stripNotes(r["Address Block"]).split(",")) {
        out.push({
          block: parseBlock(cidr),
          treatment: { kind: "registry", globallyReachable: stripNotes(r["Globally Reachable"] ?? ""), name: r.Name },
        });
      }
    }
  }
  return out;
}

// ---------- ADR-08 section 4 policy rows ----------

export const POLICY_ROWS: readonly Row[] = (
  [
    ["::ffff:0:0/96", { kind: "embedded_v4", why: "IPv4-mapped: the embedded IPv4 is classified by the IPv4 rule" }],
    ["::/96", { kind: "embedded_v4", why: "IPv4-compatible (deprecated): the embedded IPv4 is classified by the IPv4 rule" }],
    ["64:ff9b::/96", { kind: "embedded_v4", why: "NAT64 public (RFC 6052): the embedded IPv4 decides (owner decision 1)" }],
    ["64:ff9b:1::/48", { kind: "policy_deny", why: "NAT64 local (RFC 8215): destination not verifiable from the address" }],
    ["2002::/16", { kind: "policy_deny", why: "6to4: refused as a whole (approved decision, item a)" }],
    ["2001::/32", { kind: "policy_deny", why: "Teredo: the real destination is behind a relay" }],
    ["2001:20::/28", { kind: "policy_deny", why: "ORCHIDv2: identifiers, not IP destinations (approved decision, item b)" }],
  ] as const
).map(([cidr, treatment]) => ({ block: parseBlock(cidr), treatment }));

// ---------- the reference decision ----------

export interface ReferenceModel {
  readonly rows: readonly Row[];
  classify(ip: string): ReferenceVerdict;
}

export function createReferenceModel(rows: readonly Row[] = [...registryRows(), ...POLICY_ROWS]): ReferenceModel {
  const MULTICAST_V4 = parseBlock("224.0.0.0/4");
  const GLOBAL_UNICAST_V6 = parseBlock("2000::/3");

  function decide(family: Family, v: bigint): ReferenceVerdict {
    let best: Row | null = null;
    for (const r of rows) {
      if (!contains(r.block, family, v)) continue;
      if (
        best === null ||
        r.block.prefix > best.block.prefix ||
        (r.block.prefix === best.block.prefix && best.treatment.kind === "registry" && r.treatment.kind !== "registry")
      ) {
        best = r;
      }
    }
    if (best !== null) {
      const t = best.treatment;
      if (t.kind === "registry") return { allow: t.globallyReachable === "True", by: `${best.block.cidr} (registry: ${t.globallyReachable || "empty"})` };
      if (t.kind === "policy_deny") return { allow: false, by: `${best.block.cidr} (policy)` };
      if (t.kind === "policy_allow") return { allow: true, by: `${best.block.cidr} (policy)` };
      const inner = decide(4, v & 0xffffffffn);
      return { allow: inner.allow, by: `${best.block.cidr} (embedded) -> ${inner.by}` };
    }
    if (family === 4) {
      return contains(MULTICAST_V4, 4, v) ? { allow: false, by: "default: 224.0.0.0/4" } : { allow: true, by: "default: IPv4" };
    }
    return contains(GLOBAL_UNICAST_V6, 6, v) ? { allow: true, by: "default: inside 2000::/3" } : { allow: false, by: "default: outside 2000::/3" };
  }

  return {
    rows,
    classify(ip: string): ReferenceVerdict {
      const v4 = parseV4(ip);
      if (v4 !== null) return decide(4, v4);
      const v6 = parseV6(ip);
      if (v6 !== null) return decide(6, v6);
      return { allow: false, by: "not an IP address" };
    },
  };
}
