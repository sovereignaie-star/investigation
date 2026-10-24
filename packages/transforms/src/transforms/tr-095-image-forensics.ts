/**
 * P5-026 — TR-095: local image-manipulation forensics (LC-A).
 *
 * ROADMAP P5-026: «كشف التلاعب في الصور محلياً: ELA، تحليل الضغط، تطابق
 * التجزئة الإدراكية مع صور القضية، ومزوّد اختياري لكشف التزييف العميق».
 * Every result is a SIGNAL with a confidence score — never a verdict: the
 * analyst decides. The optional deepfake provider is NOT implemented here
 * (it needs a remote AI model; documented in DECLARED_LIMITS — local-first).
 *
 * Three local capabilities, zero network:
 *
 * 1. ELA (Error Level Analysis): the image is re-encoded as JPEG q95 and the
 *    per-pixel difference is gridded (16x16 cells); cells whose mean error
 *    deviates from the image-wide distribution (robust z-score over the
 *    median/MAD of the cells) are reported as anomaly regions. Different
 *    compression histories in one file (a splice) show up here — as a signal.
 * 2. Compression analysis: the JPEG DQT segments are parsed and the quality
 *    scale is estimated against the standard IJG luminance table (the table is
 *    stored zigzagged per the JPEG spec — the standard table is zigzagged the
 *    same way in code). PNG input has no JPEG compression history: the signal
 *    says so instead of inventing an estimate.
 * 3. Perceptual-hash matching: the subject's pHash (the SAME algorithm as
 *    TR-032 — shared module, one hash space) is compared by Hamming distance
 *    against case-image hashes passed as `referenceHashes`; near duplicates
 *    (≤ 10 bits) are reported with a confidence derived from the distance.
 *
 * Fail-closed: non-PNG/JPEG bytes, empty input, an invalid reference hash, an
 * oversized reference list and an oversized image all throw before any work.
 * Findings cite `derivedFrom: "input"` — the run makes ZERO requests.
 */
import { defineTransform } from "../manifest.ts";
import type { TransformFinding } from "../output.ts";
import type { TransformContext } from "../transform.ts";
import { Jimp } from "jimp";
import { imageHashes, hamming } from "../img/phash.ts";

/** Decoded-input ceiling: 10 MB (a photo), enforced before parsing. */
const MAX_DECODED_BYTES = 10_000_000;

/** Maximum case-image reference hashes compared per run (bounded work). */
export const MAX_REFERENCE_HASHES = 256;

/** Hamming distance at which two perceptual hashes are near duplicates. */
export const NEAR_DUPLICATE_BITS = 10;

/** ELA grid: the image is divided into GRID x GRID cells. */
const GRID = 16;

/** A cell is anomalous when its robust z-score crosses this threshold. */
const Z_THRESHOLD = 4;

/** …and its mean ELA clears this absolute floor over the image median. */
const ELA_FLOOR = 1.0;

/** The input contract. */
export interface ForensicsInput {
  /** Base64 image bytes (PNG or JPEG). */
  readonly content: string;
  /** Optional case-image pHash values (64-bit binary strings, TR-032 space). */
  readonly referenceHashes?: readonly string[];
}

/** The standard IJG (Annex K) luminance quantization table, natural order. */
const IJG_LUMA = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22,
  37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
];

/** The JPEG zigzag scan order (row-major index of each zigzag position). */
const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57,
  50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
];

/** The standard table zigzagged — comparable to DQT bytes (spec order). */
const IJG_LUMA_ZZ = ZIGZAG.map((i) => IJG_LUMA[i]);

/** A parsed DQT segment: its tables as zigzagged 64-entry byte arrays. */
interface DqtInfo {
  readonly tables: number[][];
  readonly allEightBit: boolean;
}

/** Parse every DQT segment of a JPEG buffer (fail-soft: malformed = no tables). */
function parseDqt(bytes: Buffer): DqtInfo {
  const tables: number[][] = [];
  let allEightBit = true;
  let pos = 2; // skip SOI
  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 0xff) break;
    const marker = bytes[pos + 1];
    if (marker === 0xda) break; // SOS — entropy data follows, stop
    const len = bytes.readUInt16BE(pos + 2);
    if (len < 2 || pos + 2 + len > bytes.length) break;
    if (marker === 0xdb) {
      let seg = pos + 4;
      const end = pos + 2 + len;
      while (seg < end) {
        const pq = bytes[seg] >> 4;
        const table: number[] = [];
        const entryWidth = pq === 1 ? 2 : 1;
        if (seg + 1 + 64 * entryWidth > end) break;
        if (pq !== 0) allEightBit = false;
        for (let i = 0; i < 64; i++) table.push(entryWidth === 1 ? bytes[seg + 1 + i] : bytes.readUInt16BE(seg + 1 + i * 2));
        tables.push(table);
        seg += 1 + 64 * entryWidth;
      }
    }
    pos += 2 + len;
  }
  return { tables, allEightBit };
}

/** Estimate the JPEG quality scale from a zigzagged table (IJG inverse). */
function estimateQuality(table: readonly number[]): number | undefined {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < 64; i++) {
    const std = IJG_LUMA_ZZ[i];
    if (std <= 0 || table[i] <= 0) continue;
    sum += (table[i] * 100 - 50) / std;
    n++;
  }
  if (n === 0) return undefined;
  const scale = sum / n;
  const q = scale >= 100 ? 5000 / scale : (200 - scale) / 2;
  if (!Number.isFinite(q)) return undefined;
  return Math.min(100, Math.max(1, Math.round(q)));
}

/** Mean absolute RGB difference of two equal-size RGBA bitmaps. */
function elaMap(a: Uint8Array, b: Uint8Array, n: number): Float64Array {
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const pa = i * 4;
    out[i] = (Math.abs(a[pa] - b[pa]) + Math.abs(a[pa + 1] - b[pa + 1]) + Math.abs(a[pa + 2] - b[pa + 2])) / 3;
  }
  return out;
}

/** Median of a numeric array. */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** One grid cell of the ELA analysis. */
interface Cell {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly mean: number;
  readonly z: number;
}

/** Grid the ELA map into GRID x GRID cells with robust z-scores. */
function elaCells(map: Float64Array, width: number, height: number): Cell[] {
  const cw = Math.max(1, Math.ceil(width / GRID));
  const ch = Math.max(1, Math.ceil(height / GRID));
  const cells: Array<{ x: number; y: number; w: number; h: number; sum: number; n: number }> = [];
  for (let gy = 0; gy < height; gy += ch) {
    for (let gx = 0; gx < width; gx += cw) {
      const w = Math.min(cw, width - gx);
      const h = Math.min(ch, height - gy);
      let sum = 0;
      for (let y = gy; y < gy + h; y++) for (let x = gx; x < gx + w; x++) sum += map[y * width + x];
      cells.push({ x: gx, y: gy, w, h, sum, n: w * h });
    }
  }
  const means = cells.map((c) => c.sum / c.n);
  const med = median(means);
  const mad = median(means.map((m) => Math.abs(m - med)));
  const spread = 1.4826 * mad + 0.01; // guard: a perfectly uniform image
  return cells.map((c, i) => ({ x: c.x, y: c.y, w: c.w, h: c.h, mean: means[i], z: (means[i] - med) / spread }));
}

/** Validated, normalized input. */
interface ValidatedInput {
  readonly bytes: Buffer;
  readonly isJpeg: boolean;
  readonly references: string[];
}

/** Fail-closed input validation — throws before any work on bad input. */
function validateInput(input: ForensicsInput): ValidatedInput {
  const content = input?.content;
  if (typeof content !== "string" || content.length === 0) {
    throw new Error("TR-095: input.content (base64 image) is required");
  }
  const bytes = Buffer.from(content, "base64");
  if (bytes.length === 0 || bytes.length > MAX_DECODED_BYTES) {
    throw new Error(`TR-095: decoded input must be 1..${MAX_DECODED_BYTES} bytes, got ${bytes.length}`);
  }
  const isPng = bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";
  const isJpeg = bytes.subarray(0, 3).toString("hex") === "ffd8ff";
  if (!isPng && !isJpeg) {
    throw new Error("TR-095: the input is not a valid image (PNG or JPEG required)");
  }
  let references: string[] = [];
  if (input.referenceHashes !== undefined) {
    if (!Array.isArray(input.referenceHashes)) {
      throw new Error("TR-095: referenceHashes must be an array of 64-bit binary strings");
    }
    if (input.referenceHashes.length > MAX_REFERENCE_HASHES) {
      throw new Error(`TR-095: referenceHashes exceeds ${MAX_REFERENCE_HASHES} entries`);
    }
    for (const h of input.referenceHashes) {
      if (typeof h !== "string" || !/^[01]{64}$/.test(h)) {
        throw new Error("TR-095: referenceHashes entries must be 64-character binary strings (TR-032 pHash space)");
      }
    }
    references = [...new Set(input.referenceHashes)];
  }
  return { bytes, isJpeg, references };
}

/** Compression-analysis findings (JPEG DQT / PNG: no JPEG history). */
function compressionFindings(bytes: Buffer, isJpeg: boolean, findings: TransformFinding[]): void {
  if (!isJpeg) {
    findings.push({
      predicate: "compression_signal",
      derivedFrom: "input",
      objectType: "compression_signal",
      objectValue: JSON.stringify({ format: "png" }),
      confidence: 0.6,
      explanation: "تحليل ضغط محلي: PNG بلا تاريخ ضغط JPEG قابل للتحليل من الجداول — لا يُخترع تقدير جودة (الغياب ليس صفراً)",
    });
    return;
  }
  const dqt = parseDqt(bytes);
  let qualityEstimate: number | undefined;
  if (dqt.allEightBit) {
    const estimates = dqt.tables.map(estimateQuality).filter((q): q is number => q !== undefined);
    if (estimates.length > 0) qualityEstimate = Math.round(median(estimates));
  }
  findings.push({
    predicate: "compression_signal",
    derivedFrom: "input",
    objectType: "compression_signal",
    objectValue: JSON.stringify({
      format: "jpeg",
      dqtTables: dqt.tables.length,
      ...(qualityEstimate !== undefined ? { qualityEstimate } : {}),
    }),
    confidence: 0.6,
    explanation:
      "تحليل ضغط محلي: جداول التكميم (DQT) من ملف JPEG نفسه وتقدير مقياس الجودة مقابل الجدول القياسي — إشارة لقراءة المحقق لا حكماً",
  });
}

/** ELA findings: re-encode at q95, diff, grid with robust z-scores. */
function elaFindings(
  image: Awaited<ReturnType<typeof Jimp.fromBuffer>>,
  resaved: Awaited<ReturnType<typeof Jimp.fromBuffer>>,
  findings: TransformFinding[],
): void {
  const width = image.bitmap.width;
  const height = image.bitmap.height;
  const map = elaMap(image.bitmap.data, resaved.bitmap.data, width * height);
  const cells = elaCells(map, width, height);
  const med = median(cells.map((x) => x.mean));
  const anomalous = cells
    .filter((c) => c.z >= Z_THRESHOLD && c.mean >= med + ELA_FLOOR)
    .sort((a, b) => b.z - a.z)
    .slice(0, 16);
  findings.push({
    predicate: "ela_summary",
    derivedFrom: "input",
    objectType: "ela_summary",
    objectValue: JSON.stringify({
      grid: `${GRID}x${GRID}`,
      meanEla: Number((map.reduce((s, v) => s + v, 0) / (width * height)).toFixed(3)),
      anomalousCells: anomalous.length,
    }),
    confidence: 0.5,
    explanation:
      "خلاصة تحليل مستويات الخطأ (ELA) محلياً: إعادة ترميز عند جودة 95 وفرق البكسلات — إشارة إحصائية، ليست دليلاً قاطعاً على تلاعب",
  });
  for (const c of anomalous) {
    findings.push({
      predicate: "ela_anomaly_region",
      derivedFrom: "input",
      objectType: "ela_region",
      objectValue: JSON.stringify({ x: c.x, y: c.y, w: c.w, h: c.h, cellEla: Number(c.mean.toFixed(3)), z: Number(c.z.toFixed(2)) }),
      confidence: Math.min(0.9, 0.5 + (c.z - Z_THRESHOLD) / 20),
      explanation:
        "منطقة بمستويات خطأ تنحرف عن توزيع الصورة ككل (z فوق العتبة) — قد تدل على تاريخ ضغط مختلف (لصق/تعديل)؛ إشارة بدرجة ثقة يقرأها المحقق، ليست حكماً",
    });
  }
}

/** Near-duplicate findings against case-image reference hashes. */
function referenceMatches(
  image: Awaited<ReturnType<typeof Jimp.fromBuffer>>,
  references: readonly string[],
  findings: TransformFinding[],
): void {
  const { phash } = imageHashes(image);
  for (const ref of references) {
    const distance = hamming(phash, ref);
    if (distance <= NEAR_DUPLICATE_BITS) {
      findings.push({
        predicate: "near_duplicate_of",
        derivedFrom: "input",
        objectType: "perceptual_hash",
        objectValue: ref,
        confidence: Math.max(0.3, Math.min(0.95, 1 - distance / 16)),
        explanation: `مسافة هامينغ ${distance} بت بين hHash الموضوع والهاش المرجعي لصورة في القضية — تشابه إدراكي (صورة شبه مطابقة)، ليس تطابق هوية`,
      });
    }
  }
}

/** The transform. */
export const imageForensics = defineTransform<ForensicsInput>(
  {
    id: "TR-095",
    version: "1.0.0",
    inputs: ["image_content"],
    outputs: ["ela_region", "ela_summary", "compression_signal", "perceptual_hash"],
    // Local transform: no network. `public` with an empty allow list is the
    // only valid declaration for a transform that never calls ctx.http.
    network: { mode: "public", allow: [] },
    secrets: [],
    limits: { rps: 1, timeoutMs: 60_000, maxBytes: 14_000_000 },
    sensitivity: "normal",
    license: "LC-A",
    admiralty: {
      reliability: "F",
      credibility: 3,
      rationale:
        "تحليل محلي لملف الصورة كما هو — إشارة كمية (مستويات خطأ، جداول تكميم، مسافة هامينغ) لا حكماً على التلاعب؛ المصدر الأصلي للملف غير معروف",
    },
  },
  async (input: ForensicsInput, _ctx: TransformContext) => {
    const { bytes, isJpeg, references } = validateInput(input);
    let image: Awaited<ReturnType<typeof Jimp.fromBuffer>>;
    try {
      image = await Jimp.fromBuffer(bytes);
    } catch {
      throw new Error("TR-095: the input is not a valid image (jimp could not parse it)");
    }
    const findings: TransformFinding[] = [];
    compressionFindings(bytes, isJpeg, findings);
    const resaved = await Jimp.fromBuffer(await image.getBuffer("image/jpeg", { quality: 95 }));
    if (resaved.bitmap.width !== image.bitmap.width || resaved.bitmap.height !== image.bitmap.height) {
      throw new Error("TR-095: ELA re-encode changed the image dimensions");
    }
    elaFindings(image, resaved, findings);
    if (references.length > 0) referenceMatches(image, references, findings);
    return { findings };
  },
);
