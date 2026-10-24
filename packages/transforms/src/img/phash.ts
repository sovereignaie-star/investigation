/**
 * Shared perceptual image hashing (extracted from TR-032 so TR-095's
 * case-image matching uses the SAME algorithm — one hash space, not two).
 *
 * pHash: 32x32 grayscale grid -> 8x8 lowest-frequency DCT-II -> bits against
 * the mean of the 63 AC coefficients (measured 2026-10-16: median-thresholding
 * is fragile on smooth synthetic images, the AC-mean rule is stable — see
 * TR-032). dHash: 9x8 grayscale grid, one bit per horizontally adjacent pair.
 */
import { Jimp } from "jimp";

/** The decoded-image shape jimp hands back (value import — Jimp is not a type). */
export type JimpImage = Awaited<ReturnType<typeof Jimp.fromBuffer>>;

/** Reciprocal-DCT cos((2x+1)u*pi/64) table shared by u in 0..7, x in 0..31. */
const DCT_COS = (() => {
  const table = new Float64Array(32 * 8);
  for (let x = 0; x < 32; x++) {
    for (let u = 0; u < 8; u++) table[x * 8 + u] = Math.cos(((2 * x + 1) * u * Math.PI) / 64);
  }
  return table;
})();

/** Luminance (Rec. 601) of an RGBA bitmap as a Float64Array of w*h samples. */
function luminance(rgba: Uint8Array): Float64Array {
  const n = rgba.length >> 2;
  const gray = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    gray[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  }
  return gray;
}

/** The 8x8 lowest-frequency DCT-II coefficients of a 32x32 grayscale grid. */
function dct8x8(gray: Float64Array): Float64Array {
  const out = new Float64Array(64);
  for (let v = 0; v < 8; v++) {
    for (let u = 0; u < 8; u++) {
      let sum = 0;
      for (let y = 0; y < 32; y++) {
        const cosY = DCT_COS[y * 8 + v];
        const row = y * 32;
        for (let x = 0; x < 32; x++) {
          sum += gray[row + x] * DCT_COS[x * 8 + u] * cosY;
        }
      }
      out[v * 8 + u] = sum;
    }
  }
  return out;
}

/** pHash bits against the mean of the 63 AC coefficients. */
function phashBits(dct: Float64Array): string {
  let sum = 0;
  for (let i = 1; i < 64; i++) sum += dct[i];
  const meanAc = sum / 63;
  let bits = "";
  for (let i = 0; i < 64; i++) bits += dct[i] > meanAc ? "1" : "0";
  return bits;
}

/** dHash from a 9-column grayscale grid: 8 rows x 8 adjacent pairs. */
function dhashBits(gray: Float64Array, width: number): string {
  let bits = "";
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      bits += gray[y * width + x] > gray[y * width + x + 1] ? "1" : "0";
    }
  }
  return bits;
}

/** The pHash + dHash of a decoded image (64-character binary strings). */
export function imageHashes(image: JimpImage): { phash: string; dhash: string } {
  const small32 = image.clone().resize({ w: 32, h: 32 });
  const phash = phashBits(dct8x8(luminance(small32.bitmap.data)));
  const small98 = image.clone().resize({ w: 9, h: 8 });
  const dhash = dhashBits(luminance(small98.bitmap.data), 9);
  return { phash, dhash };
}

/** Hamming distance between two equal-length binary strings. */
export function hamming(a: string, b: string): number {
  if (a.length !== b.length) throw new Error("hamming: length mismatch");
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}
