/**
 * T-SEC-SSRF-045 (P2-003): differential test between the gateway classifier (`@ir/egress` address-policy.ts) and
 * the pure reference model built on the dated IANA snapshot (`iana-reference-model.ts`).
 *
 * The comparison is over ADDRESSES, not file hashes: for every registry and policy block, its first and last address,
 * the addresses just outside it and its midpoint; the IPv4 probes again in their IPv4-mapped, IPv4-compatible and
 * NAT64 forms; and a fixed-seed random sample of the whole IPv4 space, the whole IPv6 space, 2000::/3 and the inside
 * of every block. Every probe must get the same accept/refuse verdict from both. Reproducible: no clock, no network,
 * the seed is a constant.
 *
 * Negative controls: copies of address-policy.ts with one rule weakened must disagree with the reference on at least
 * one probe, so the comparison is shown to be able to fail.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { classifyAddress } from "../../../../packages/egress/src/address-policy";
import { createReferenceModel, formatV4, formatV6, lastOf, type ReferenceModel } from "./iana-reference-model";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const POLICY_SRC = path.resolve(HERE, "../../../../packages/egress/src/address-policy.ts");

const ref: ReferenceModel = createReferenceModel();
const V4_MAX = (1n << 32n) - 1n;
const V6_MAX = (1n << 128n) - 1n;

/** mulberry32, fixed seed: the sample is the same on every run and every host. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const SEED = 0x045;

function randBits(rnd: () => number, bits: number): bigint {
  let v = 0n;
  for (let i = 0; i < bits; i += 16) v = (v << 16n) | BigInt(Math.floor(rnd() * 65536));
  return v & ((1n << BigInt(bits)) - 1n);
}

function buildProbes(): string[] {
  const set = new Set<string>();
  const v4 = (v: bigint) => {
    if (v < 0n || v > V4_MAX) return;
    const s = formatV4(v);
    set.add(s);
    set.add(`::ffff:${s}`);
    set.add(`64:ff9b::${s}`);
    set.add(`::${s}`);
  };
  const v6 = (v: bigint) => {
    if (v >= 0n && v <= V6_MAX) set.add(formatV6(v));
  };
  const rnd = prng(SEED);
  for (const r of ref.rows) {
    const first = r.block.network;
    const last = lastOf(r.block);
    const add = r.block.family === 4 ? v4 : v6;
    for (const v of [first, last, first - 1n, last + 1n, (first + last) / 2n]) add(v);
    // random addresses inside the block
    const hostBits = (r.block.family === 4 ? 32 : 128) - r.block.prefix;
    for (let i = 0; i < 8 && hostBits > 0; i++) add(first | randBits(rnd, hostBits));
  }
  // default space boundaries
  for (const v of [0xe0000000n - 1n, 0xe0000000n, 0xefffffffn, 0xf0000000n]) v4(v);
  for (const v of [0x2000n << 112n, (0x2000n << 112n) - 1n, (0x4000n << 112n) - 1n, 0x4000n << 112n]) v6(v);
  // whole-space and 2000::/3 samples
  for (let i = 0; i < 4000; i++) v4(randBits(rnd, 32));
  for (let i = 0; i < 4000; i++) v6(randBits(rnd, 128));
  for (let i = 0; i < 4000; i++) v6((0x2000n << 112n) | randBits(rnd, 125));
  return [...set];
}

const PROBES = buildProbes();

function disagreements(classify: (ip: string) => { ok: boolean }): string[] {
  const out: string[] = [];
  for (const ip of PROBES) {
    const r = ref.classify(ip);
    const c = classify(ip).ok;
    if (c !== r.allow) out.push(`${ip}: classifier ${c ? "accepts" : "refuses"}, reference ${r.allow ? "accepts" : "refuses"} by ${r.by}`);
  }
  return out;
}

describe("T-SEC-SSRF-045: @ir/egress classifier vs the IANA reference model (address differential)", () => {
  it("the probe set is large and covers every registry and policy block", () => {
    expect(PROBES.length).toBeGreaterThan(20_000);
    for (const r of ref.rows) {
      const first = r.block.family === 4 ? formatV4(r.block.network) : formatV6(r.block.network);
      expect(PROBES, r.block.cidr).toContain(first);
    }
  });

  it("the reference model reads the snapshot rows it is built on (sanity)", () => {
    expect(ref.classify("10.1.2.3").allow).toBe(false);
    expect(ref.classify("8.8.8.8").allow).toBe(true);
    expect(ref.classify("192.0.0.9").allow).toBe(true); // nested GR=True inside a GR=False block
    expect(ref.classify("ff02::1").allow).toBe(false);
    expect(ref.classify("2606:4700::1111").allow).toBe(true);
    expect(ref.classify("::ffff:127.0.0.1").allow).toBe(false);
    expect(ref.classify("64:ff9b::8.8.8.8").allow).toBe(true);
  });

  it("every probe gets the same verdict from the classifier and the reference model", () => {
    const d = disagreements(classifyAddress);
    expect(d.slice(0, 20), `${d.length} disagreement(s)`).toEqual([]);
  });
});

// ---------- negative controls: the comparison can fail ----------

const MUTANT_DIRS: string[] = [];
afterAll(() => {
  for (const d of MUTANT_DIRS) fs.rmSync(d, { recursive: true, force: true });
});

async function mutantClassifier(from: string, to: string): Promise<(ip: string) => { ok: boolean }> {
  const src = fs.readFileSync(POLICY_SRC, "utf8");
  expect(src.includes(from), `anchor not found: ${from}`).toBe(true);
  const dir = fs.mkdtempSync(path.join(HERE, ".m-"));
  MUTANT_DIRS.push(dir);
  fs.writeFileSync(path.join(dir, "address-policy.ts"), src.split(from).join(to));
  const mod = (await import(/* @vite-ignore */ path.join(dir, "address-policy.ts"))) as { classifyAddress: (ip: string) => { ok: boolean } };
  return mod.classifyAddress;
}

const CONTROLS: ReadonlyArray<{ name: string; from: string; to: string }> = [
  // removing the ULA row would NOT be a weakening (fc00::/7 is outside 2000::/3 and still refused); marking it public is
  { name: "ULA row marked public", from: '["fc00::/7", "private"]', to: '["fc00::/7", "public"]' },
  { name: "CGNAT row removed", from: '  ["100.64.0.0/10", "private"], // CGNAT: Forwardable=True, Globally Reachable=False\n', to: "" },
  { name: "nested GR=True row removed (192.0.0.9/32)", from: '  ["192.0.0.9/32", "public"], // Port Control Protocol Anycast\n', to: "" },
  { name: "2000::/3 default widened", from: "if ((b[0] & 0xe0) === 0x20) return", to: "if (true) return" },
  { name: "IPv4 default no longer refuses 240.0.0.0/4", from: '  ["240.0.0.0/4", "reserved"], // Reserved incl. 255.255.255.255\n', to: "" },
];

describe("T-SEC-SSRF-045 negative controls: a weakened classifier disagrees with the reference", () => {
  it("sanity: an unmodified copy agrees on every probe", async () => {
    const c = await mutantClassifier("export function classifyAddress", "export function classifyAddress");
    expect(disagreements(c)).toEqual([]);
  });
  for (const m of CONTROLS) {
    it(`"${m.name}" is detected`, async () => {
      const c = await mutantClassifier(m.from, m.to);
      expect(disagreements(c).length).toBeGreaterThan(0);
    });
  }
});
