/**
 * P2-012 — TR-032: perceptual image hash (pHash/dHash), LOCAL ONLY (no network).
 *
 * ROADMAP: «صورة ← pHash/dHash». The input is a base64-encoded image; the
 * transform emits two findings, both typed `perceptual_hash` (a 64-char
 * binary string — catalog type added with context.required: a 0/1 run in
 * prose is not an identifier without context, the TR-036 lesson):
 *
 * - the pHash: classic DCT perceptual hash — the image is downsampled to a
 *   32x32 grayscale grid, the 8x8 lowest-frequency DCT-II coefficients are
 *   computed, and each bit is `coefficient > median`;
 * - the dHash (difference hash): a 9x8 grayscale grid, one bit per
 *   horizontally adjacent pair (left pixel brighter than right).
 *
 * Owner decision 2026-10-16 (second round): **jimp** (MIT, pure JavaScript)
 * replaces the first sharp-based implementation — sharp's native `.node`
 * binary cannot be bundled into the sandbox runner's eval source (measured:
 * both the CLI build gate and `bundleTransform` fail on it), and jimp
 * bundles cleanly, keeping TR-032 compatible with the mandatory isolation
 * path (P2-005: refused, never a silent in-process fallback). The lower
 * performance is accepted — the hash runs once per image with no latency
 * requirement (DECLARED_LIMITS L-18). pHash/dHash are computed manually
 * from jimp's pixel access — no hash library dependency.
 *
 * Perceptual hashes support NEAR-DUPLICATE detection by Hamming distance,
 * not equality: two photos of the same scene land close together. The
 * contract test proves the stability property (a lightly perturbed image
 * stays within a few bits of the original).
 *
 * Every finding cites `derivedFrom: "input"` and the run makes ZERO
 * requests (P2-036 evidence contract). Fail-closed: bytes that are not an
 * image throw (measured: jimp throws on unsupported input). Nothing is
 * guessed — the hashes are deterministic functions of the input.
 *
 * Sensitivity `normal` (ROADMAP), license LC-A (local only, no network).
 */
import { defineTransform } from "../manifest.ts";
import type { TransformFinding } from "../output.ts";
import { Jimp } from "jimp";

/** Decoded-input ceiling: 10 MB (a photo), enforced before parsing. */
const MAX_DECODED_BYTES = 10_000_000;

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

/**
 * The 8x8 lowest-frequency DCT-II coefficients of a 32x32 grayscale grid
 * (u,v in 0..7). 64 * 1024 multiply-accumulate operations — no latency
 * requirement (L-18), computed once per image.
 */
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

/** pHash: each of the 64 DCT coefficients as a bit against the mean of the
 * 63 AC coefficients (DC excluded). Measured 2026-10-16: median-thresholding
 * is fragile on smooth synthetic images (a light perturbation flipped 30/64
 * bits — the coefficient mass clusters near the median), while the AC-mean
 * rule keeps the same perturbation at distance 0 — the large low-frequency
 * coefficients dominate the mean, so the near-zero coefficients stay
 * stably below it. */
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

export const perceptualHash = defineTransform<{ content: string }>(
  {
    id: "TR-032",
    version: "1.0.0",
    inputs: ["image_content"],
    outputs: ["perceptual_hash"],
    // Local transform: no network. `public` with an empty allow list is the
    // only valid declaration for a transform that never calls ctx.http.
    network: { mode: "public", allow: [] },
    secrets: [],
    limits: { rps: 1, timeoutMs: 10_000, maxBytes: 14_000_000 },
    sensitivity: "normal",
    license: "LC-A",
    // P4-002: the documented Admiralty source grade (D2/5.13) — the basis the confidence model consumes.
    admiralty: {
      reliability: "F",
      credibility: 5,
      rationale: "بصمة إدراكية محلية مشتقة حسابياً من الصورة — ليست ادعاءً واقعياً بل قيمة مقارنة؛ مصدر الملف غير معروف",
    },
  },
  async (input) => {
    const content = input?.content;
    if (typeof content !== "string" || content.length === 0) {
      throw new Error("TR-032: input.content (base64 image) is required");
    }
    const bytes = Buffer.from(content, "base64");
    if (bytes.length === 0 || bytes.length > MAX_DECODED_BYTES) {
      throw new Error(`TR-032: decoded input must be 1..${MAX_DECODED_BYTES} bytes, got ${bytes.length}`);
    }

    // Fail-closed on non-image bytes: jimp throws on unsupported input.
    let image: Awaited<ReturnType<typeof Jimp.fromBuffer>>;
    try {
      image = await Jimp.fromBuffer(bytes);
    } catch {
      throw new Error("TR-032: the input is not a valid image (jimp could not parse it)");
    }

    // pHash: 32x32 grayscale grid -> 8x8 lowest-frequency DCT -> median bits.
    const small32 = image.clone().resize({ w: 32, h: 32 });
    const phash = phashBits(dct8x8(luminance(small32.bitmap.data)));

    // dHash: 9x8 grayscale grid -> 8 adjacent pairs per row.
    const small98 = image.clone().resize({ w: 9, h: 8 });
    const dhash = dhashBits(luminance(small98.bitmap.data), 9);

    const findings: TransformFinding[] = [
      {
        predicate: "has_phash",
        derivedFrom: "input",
        objectType: "perceptual_hash",
        objectValue: phash,
        confidence: 1,
        explanation: "DCT perceptual hash (pHash) computed locally from the image — near-duplicate detection by Hamming distance",
      },
      {
        predicate: "has_dhash",
        derivedFrom: "input",
        objectType: "perceptual_hash",
        objectValue: dhash,
        confidence: 1,
        explanation:
          "difference hash (dHash) computed locally from the image's grayscale gradients — near-duplicate detection by Hamming distance",
      },
    ];
    return { findings };
  },
);
