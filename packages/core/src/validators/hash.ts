/**
 * Pure SHA-256 (FIPS 180-4) and Keccak-256 (the pre-FIPS-202 padding used by Ethereum), synchronous and dependency-free
 * so the validators run identically in the browser, the server and tests. Not for bulk hashing; the ledger uses
 * node:crypto.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be,
  0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa,
  0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85,
  0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f,
  0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

/** One SHA-256 compression round over the 64-byte block at `off`. Typed-array reads are in range by construction. */
function compress(h: Uint32Array, w: Uint32Array, view: DataView, off: number): void {
  for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
  for (let i = 16; i < 64; i++) {
    const a = w[i - 15] as number;
    const b = w[i - 2] as number;
    const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
    const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
    w[i] = ((w[i - 16] as number) + s0 + (w[i - 7] as number) + s1) >>> 0;
  }
  const v = Array.from(h);
  for (let i = 0; i < 64; i++) {
    const [a, b, c, d, e, f, g, hh] = v as [number, number, number, number, number, number, number, number];
    const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + (K[i] as number) + (w[i] as number)) >>> 0;
    const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
    v.splice(0, 8, (t1 + t2) >>> 0, a, b, c, (d + t1) >>> 0, e, f, g);
  }
  for (let i = 0; i < 8; i++) h[i] = ((h[i] as number) + (v[i] as number)) >>> 0;
}

export function sha256(data: Uint8Array): Uint8Array {
  const bitLen = data.length * 8;
  const padded = new Uint8Array(((data.length + 9 + 63) >> 6) << 6);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  view.setUint32(padded.length - 4, bitLen >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  for (let off = 0; off < padded.length; off += 64) compress(h, w, view, off);
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  h.forEach((x, i) => ov.setUint32(i * 4, x));
  return out;
}

const RC = [
  0x0000000000000001n,
  0x0000000000008082n,
  0x800000000000808an,
  0x8000000080008000n,
  0x000000000000808bn,
  0x0000000080000001n,
  0x8000000080008081n,
  0x8000000000008009n,
  0x000000000000008an,
  0x0000000000000088n,
  0x0000000080008009n,
  0x000000008000000an,
  0x000000008000808bn,
  0x800000000000008bn,
  0x8000000000008089n,
  0x8000000000008003n,
  0x8000000000008002n,
  0x8000000000000080n,
  0x000000000000800an,
  0x800000008000000an,
  0x8000000080008081n,
  0x8000000000008080n,
  0x0000000080000001n,
  0x8000000080008008n,
];
const ROT = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];
const M64 = (1n << 64n) - 1n;
const rotl = (x: bigint, n: number) => (n === 0 ? x : ((x << BigInt(n)) | (x >> BigInt(64 - n))) & M64);

function keccakF(s: bigint[]): void {
  const lane = (i: number) => s[i] ?? 0n;
  for (const rc of RC) {
    const c = [0, 1, 2, 3, 4].map((x) => lane(x) ^ lane(x + 5) ^ lane(x + 10) ^ lane(x + 15) ^ lane(x + 20));
    for (let x = 0; x < 5; x++) {
      const d = (c[(x + 4) % 5] ?? 0n) ^ rotl(c[(x + 1) % 5] ?? 0n, 1);
      for (let y = 0; y < 25; y += 5) s[x + y] = lane(x + y) ^ d;
    }
    const b: bigint[] = new Array<bigint>(25).fill(0n);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) b[y + ((2 * x + 3 * y) % 5) * 5] = rotl(lane(x + 5 * y), ROT[x + 5 * y] ?? 0);
    for (let x = 0; x < 5; x++)
      for (let y = 0; y < 25; y += 5) s[x + y] = (b[x + y] ?? 0n) ^ (~(b[((x + 1) % 5) + y] ?? 0n) & M64 & (b[((x + 2) % 5) + y] ?? 0n));
    s[0] = lane(0) ^ rc;
  }
}

function sponge(data: Uint8Array, pad: number): Uint8Array {
  const rate = 136;
  const padded = new Uint8Array(Math.floor(data.length / rate) * rate + rate);
  padded.set(data);
  padded[data.length] = (padded[data.length] ?? 0) ^ pad;
  padded[padded.length - 1] = (padded[padded.length - 1] ?? 0) ^ 0x80;
  const s: bigint[] = new Array<bigint>(25).fill(0n);
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) {
      let v = 0n;
      for (let j = 7; j >= 0; j--) v = (v << 8n) | BigInt(padded[off + i * 8 + j] ?? 0);
      s[i] = (s[i] ?? 0n) ^ v;
    }
    keccakF(s);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i++) {
    let v = s[i] ?? 0n;
    for (let j = 0; j < 8; j++) {
      out[i * 8 + j] = Number(v & 0xffn);
      v >>= 8n;
    }
  }
  return out;
}

/** Keccak-256 as used by Ethereum (padding byte 0x01). */
export const keccak256 = (data: Uint8Array): Uint8Array => sponge(data, 0x01);
/** SHA3-256 (FIPS 202, padding byte 0x06); shares the permutation, so it cross-checks Keccak against node:crypto. */
export const sha3_256 = (data: Uint8Array): Uint8Array => sponge(data, 0x06);

export const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
export const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
