/**
 * P2-012 — TR-031: image metadata (EXIF/XMP/GPS), LOCAL ONLY (no network).
 *
 * ROADMAP: «صورة ← EXIF/XMP/GPS». The input is a base64-encoded image; the
 * transform extracts, using ExifReader (owner decision 2026-10-16 — MPL-2.0,
 * see DECLARED_LIMITS L-16; replaces the ROADMAP's exifr/ExifTool note):
 *
 * - the capture camera (Make + Model, joined);
 * - the capture time (DateTimeOriginal, normalized to "YYYY-MM-DD HH:mm:ss" —
 *   EXIF timestamps carry no timezone, so no zone is ever invented);
 * - the GPS coordinates (DMS rationals converted to decimal degrees, signed
 *   by GPSLatitudeRef/GPSLongitudeRef — S/W are negative). The hemisphere
 *   refs are REQUIRED: absent refs mean the hemisphere is unknown, and no
 *   geo finding is emitted at all (nothing is guessed — measured 2026-10-16:
 *   ExifReader returns the refs as `value: ["S"]` with a prose description
 *   like "South latitude", so the sign is read from the value array, the
 *   library's own convention);
 * - the XMP creation tool (CreatorTool), the software that created the file.
 *
 * Every finding cites `derivedFrom: "input"`: the analysis is computed from the
 * input alone, and a run that made no request must not cite request evidence
 * (P2-036 evidence contract). The run makes ZERO requests. Fail-closed: bytes
 * that are not an image throw (measured: ExifReader throws "Invalid image
 * format"); a VALID image without EXIF is a legitimate empty result (measured:
 * a bare JPEG returns only FileType) — an absence of metadata is not an error.
 * Nothing is guessed: each fact is emitted only when its tag is present.
 *
 * Sensitivity `normal` (ROADMAP), license LC-A (local only, no network).
 */
import { defineTransform } from "../manifest.ts";
import type { TransformFinding } from "../output.ts";
import ExifReader from "exifreader";

/** Decoded-input ceiling: 10 MB (a photo), enforced before parsing. */
const MAX_DECODED_BYTES = 10_000_000;

/** One DMS rational pair as ExifReader returns it: [numerator, denominator]. */
type Rational = [number, number];

/** The tag shape the transform reads from ExifReader's flat tag map. */
interface ExifTag {
  readonly description?: string | null;
  readonly value?: unknown;
}

function dmsToDecimal(ratios: readonly Rational[]): number | undefined {
  if (!Array.isArray(ratios) || ratios.length < 3) return undefined;
  const parts = ratios.slice(0, 3).map(([n, d]) => (Number.isFinite(n) && Number.isFinite(d) && d !== 0 ? n / d : Number.NaN));
  if (parts.some((p) => !Number.isFinite(p))) return undefined;
  const value = parts[0] + parts[1] / 60 + parts[2] / 3600;
  return Number.isFinite(value) ? value : undefined;
}

/** Camera finding: Make + Model joined, only when at least one is present. */
function cameraFinding(tags: Record<string, ExifTag>): TransformFinding | undefined {
  const make = typeof tags.Make?.description === "string" ? tags.Make.description.trim() : "";
  const model = typeof tags.Model?.description === "string" ? tags.Model.description.trim() : "";
  const camera = [make, model].filter((p) => p.length > 0).join(" ");
  if (camera.length === 0) return undefined;
  return {
    predicate: "captured_with",
    derivedFrom: "input",
    objectType: "camera",
    objectValue: camera,
    confidence: 1,
    explanation: "capture device from EXIF (local parse, no network)",
  };
}

/** Capture-time finding: DateTimeOriginal normalized; EXIF has no timezone — none invented. */
function dateFinding(tags: Record<string, ExifTag>): TransformFinding | undefined {
  const raw = typeof tags.DateTimeOriginal?.description === "string" ? tags.DateTimeOriginal.description : "";
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(raw);
  if (m === null) return undefined;
  return {
    predicate: "captured_at_time",
    derivedFrom: "input",
    objectType: "date",
    objectValue: `${m[1]}-${m[2]}-${m[3]} ${m[4]}`,
    confidence: 1,
    explanation: "capture time from EXIF DateTimeOriginal (EXIF carries no timezone — none invented)",
  };
}

/** Hemisphere letter ("N"/"S"/"E"/"W") from a GPS ref tag, or undefined.
 * Measured: the ref's `value` is a char array (["S"]); the `description` is
 * prose ("South latitude") — only the value array is authoritative. */
function refHemisphere(tag: ExifTag | undefined): string | undefined {
  const v = tag?.value;
  if (Array.isArray(v) && v.length > 0) {
    const joined = v.join("");
    if (typeof joined === "string" && /^[NSEW]$/.test(joined)) return joined;
  }
  if (typeof v === "string" && /^[NSEW]$/.test(v)) return v;
  return undefined;
}

/** GPS finding: DMS rationals to decimal degrees, signed by the refs — which
 * are REQUIRED: without them the hemisphere is unknown and nothing is emitted. */
function geoFinding(tags: Record<string, ExifTag>): TransformFinding | undefined {
  const latRatios = tags.GPSLatitude?.value as readonly Rational[] | undefined;
  const lngRatios = tags.GPSLongitude?.value as readonly Rational[] | undefined;
  if (!Array.isArray(latRatios) || !Array.isArray(lngRatios)) return undefined;
  const latRef = refHemisphere(tags.GPSLatitudeRef);
  const lngRef = refHemisphere(tags.GPSLongitudeRef);
  if (latRef === undefined || lngRef === undefined) return undefined; // never guess the hemisphere
  const lat = dmsToDecimal(latRatios);
  const lng = dmsToDecimal(lngRatios);
  if (lat === undefined || lng === undefined) return undefined;
  const signedLat = latRef === "S" ? -lat : lat;
  const signedLng = lngRef === "W" ? -lng : lng;
  return {
    predicate: "captured_at",
    derivedFrom: "input",
    objectType: "geo_point",
    objectValue: `${signedLat.toFixed(6)},${signedLng.toFixed(6)}`,
    confidence: 1,
    explanation: `GPS coordinates from EXIF (DMS to decimal degrees; refs ${latRef}/${lngRef} applied)`,
  };
}

/** XMP tool finding: CreatorTool — the software that created the file. */
function xmpToolFinding(tags: Record<string, ExifTag>): TransformFinding | undefined {
  const tool = typeof tags.CreatorTool?.description === "string" ? tags.CreatorTool.description.trim() : "";
  if (tool.length === 0) return undefined;
  return {
    predicate: "created_with",
    derivedFrom: "input",
    objectType: "application",
    objectValue: tool,
    confidence: 1,
    explanation: "creation tool from XMP CreatorTool (local parse, no network)",
  };
}

export const exifMetadata = defineTransform<{ content: string }>(
  {
    id: "TR-031",
    version: "1.0.0",
    inputs: ["image_content"],
    outputs: ["camera", "date", "geo_point"],
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
      credibility: 3,
      rationale:
        "تحليل محلي لملف صورة كما هو — المصدر (المُنتج الأصلي للملف) غير قابل للحكم عليه مسبقاً؛ البيانات الوصفية مستخرجة بنيوياً من الملف نفسه",
    },
  },
  async (input) => {
    const content = input?.content;
    if (typeof content !== "string" || content.length === 0) {
      throw new Error("TR-031: input.content (base64 image) is required");
    }
    const bytes = Buffer.from(content, "base64");
    if (bytes.length === 0 || bytes.length > MAX_DECODED_BYTES) {
      throw new Error(`TR-031: decoded input must be 1..${MAX_DECODED_BYTES} bytes, got ${bytes.length}`);
    }

    let tags: Record<string, ExifTag>;
    try {
      tags = ExifReader.load(bytes) as Record<string, ExifTag>;
    } catch {
      throw new Error("TR-031: the input is not a valid image (ExifReader could not parse it)");
    }

    const findings: TransformFinding[] = [];
    for (const finding of [cameraFinding(tags), dateFinding(tags), geoFinding(tags), xmpToolFinding(tags)]) {
      if (finding !== undefined) findings.push(finding);
    }
    return { findings };
  },
);
