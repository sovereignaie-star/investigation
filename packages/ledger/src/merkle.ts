import { createHash } from "node:crypto";

/**
 * Merkle tree hash over entry hashes, RFC 9162 section 2.1 (Certificate Transparency v2): leaf = SHA-256(0x00 || h),
 * node = SHA-256(0x01 || left || right), split at the largest power of two below n. Checkpoints sign the root, and an
 * inclusion proof shows one entry belongs to a signed checkpoint without revealing the others (T-LED-014).
 */
const H = (...parts: Uint8Array[]) => {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return new Uint8Array(h.digest());
};
const LEAF = Uint8Array.of(0);
const NODE = Uint8Array.of(1);
const fromHex = (s: string) => Uint8Array.from(Buffer.from(s, "hex"));
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const split = (n: number) => 2 ** Math.floor(Math.log2(n - 1));

function mth(leaves: Uint8Array[]): Uint8Array {
  if (leaves.length === 0) return H();
  if (leaves.length === 1) return H(LEAF, leaves[0] as Uint8Array);
  const k = split(leaves.length);
  return H(NODE, mth(leaves.slice(0, k)), mth(leaves.slice(k)));
}

export function merkleRoot(entryHashes: readonly string[]): string {
  return hex(mth(entryHashes.map(fromHex)));
}

function path(m: number, leaves: Uint8Array[]): Uint8Array[] {
  if (leaves.length <= 1) return [];
  const k = split(leaves.length);
  return m < k ? [...path(m, leaves.slice(0, k)), mth(leaves.slice(k))] : [...path(m - k, leaves.slice(k)), mth(leaves.slice(0, k))];
}

/** Audit path for leaf `index` in the tree of the first `size` entry hashes. */
export function inclusionProof(entryHashes: readonly string[], index: number, size = entryHashes.length): string[] {
  if (!Number.isInteger(index) || index < 0 || index >= size || size > entryHashes.length) throw new RangeError("index outside tree");
  return path(index, entryHashes.slice(0, size).map(fromHex)).map(hex);
}

/** RFC 9162 section 2.1.3.2 verification algorithm. */
export function verifyInclusion(entryHash: string, index: number, size: number, proof: readonly string[], root: string): boolean {
  if (index < 0 || index >= size) return false;
  let fn = index;
  let sn = size - 1;
  let r = H(LEAF, fromHex(entryHash));
  for (const p of proof) {
    if (sn === 0) return false;
    const pb = fromHex(p);
    if ((fn & 1) === 1 || fn === sn) {
      r = H(NODE, pb, r);
      if ((fn & 1) === 0)
        while ((fn & 1) === 0 && fn !== 0) {
          fn >>= 1;
          sn >>= 1;
        }
    } else {
      r = H(NODE, r, pb);
    }
    fn >>= 1;
    sn >>= 1;
  }
  return sn === 0 && hex(r) === root;
}
