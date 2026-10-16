/**
 * P2-012 — TR-032: perceptual image hash (pHash/dHash), LOCAL ONLY (no network).
 *
 * ROADMAP: «صورة ← pHash/dHash». The input is a base64-encoded image; the
 * transform emits two findings, both typed `perceptual_hash` (a 64-char
 * binary string — catalog type added with context.required: a 0/1 run in
 * prose is not an identifier without context, the TR-036 lesson):
 *
 * - the pHash (sharp-phash: DCT-based perceptual hash over sharp's resized
 *   grayscale — the library's module IS the phash function, measured
 *   2026-10-16);
 * - the dHash (difference hash: 8x8 grid of horizontal grayscale gradients
 *   computed from sharp's raw pixels — no extra dependency).
 *
 * Perceptual hashes support NEAR-DUPLICATE detection by Hamming distance,
 * not equality: two photos of the same scene land close together. The
 * contract test proves the stability property (a lightly perturbed image
 * has distance 0) with `sharp-phash/distance`.
 *
 * Every finding cites `derivedFrom: "input"` and the run makes ZERO
 * requests (P2-036 evidence contract). Fail-closed: bytes that are not an
 * image throw (measured: sharp throws "unsupported image format"). Nothing
 * is guessed — the hashes are deterministic functions of the input.
 *
 * Sensitivity `normal` (ROADMAP), license LC-A (local only, no network).
 * Owner decision 2026-10-16: sharp (Apache-2.0) + sharp-phash (MIT) —
 * support and licenses verified by measurement BEFORE implementation.
 */
import { defineTransform } from "../manifest.ts";
import type { TransformFinding } from "../output.ts";
import sharp from "sharp";
import type { OutputInfo } from "sharp";
import phash from "sharp-phash";

/** Decoded-input ceiling: 10 MB (a photo), enforced before parsing. */
const MAX_DECODED_BYTES = 10_000_000;

/** dHash from a raw grayscale buffer: 8 rows x 8 (adjacent-pair) columns. */
function dhashFromGray(data: Buffer, width: number): string {
  const bits: string[] = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left = data[y * width + x];
      const right = data[y * width + x + 1];
      bits.push(left > right ? "1" : "0");
    }
  }
  return bits.join("");
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

    // Fail-closed on non-image bytes: sharp throws on unsupported input.
    let resized: { data: Buffer; info: OutputInfo };
    try {
      // dHash grid: 9 columns x 8 rows of grayscale pixels (8 adjacent pairs per row).
      resized = await sharp(bytes).greyscale().resize(9, 8, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
    } catch {
      throw new Error("TR-032: the input is not a valid image (sharp could not parse it)");
    }
    const dhash = dhashFromGray(resized.data, resized.info.width);

    const findings: TransformFinding[] = [
      {
        predicate: "has_phash",
        derivedFrom: "input",
        objectType: "perceptual_hash",
        objectValue: await phash(bytes),
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
