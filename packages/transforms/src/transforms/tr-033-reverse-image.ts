/**
 * P2-012 — TR-033: reverse image search links (manual open, LC-A).
 *
 * The transform CONSTRUCTS links for the investigator to open by hand; it never
 * fetches and never uploads the image automatically (ROADMAP P2-012: «لا رفع
 * آلي»). Each engine's documented URL scheme takes the image URL as a query
 * parameter: Google Lens (`uploadbyurl`), Yandex Images (`url`), TinEye (`url`).
 * Findings are derived from the input alone (`derivedFrom: "input"`, P2-036).
 */
import { defineTransform } from "../manifest.ts";
import type { TransformFinding } from "../output.ts";

interface Engine {
  name: string;
  host: string;
  build: (encoded: string) => string;
}

const ENGINES: readonly Engine[] = [
  { name: "Google Lens", host: "lens.google.com", build: (e) => `https://lens.google.com/uploadbyurl?url=${e}` },
  { name: "Yandex Images", host: "yandex.com", build: (e) => `https://yandex.com/images/search?rpt=imageview&url=${e}` },
  { name: "TinEye", host: "tineye.com", build: (e) => `https://tineye.com/search?url=${e}` },
];

function requireImageUrl(raw: string | undefined): URL {
  if (!raw || raw.trim().length === 0) throw new Error("TR-033: an image URL is required");
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new Error(`TR-033: "${raw}" is not a valid http(s) image URL`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`TR-033: "${raw}" is not a valid http(s) image URL`);
  }
  return parsed;
}

export const reverseImageLinks = defineTransform<{ url: string }>(
  {
    id: "TR-033",
    version: "1.0.0",
    inputs: ["url"],
    outputs: ["url"],
    // Local transform: no network. `public` with an empty allow list is the
    // only valid declaration for a transform that never calls ctx.http.
    network: { mode: "public", allow: [] },
    secrets: [],
    limits: { rps: 100, timeoutMs: 10_000, maxBytes: 1_000_000 },
    sensitivity: "normal",
    license: "LC-A",
  },
  (input, _ctx) => {
    const parsed = requireImageUrl(input?.url);
    const encoded = encodeURIComponent(parsed.toString());
    const findings: TransformFinding[] = ENGINES.map((engine) => ({
      predicate: "has_reverse_image_search",
      objectType: "url",
      objectValue: engine.build(encoded),
      confidence: 0.9,
      explanation: `${engine.name} reverse image search for ${parsed.toString()} (manual open — the image is never uploaded automatically)`,
      derivedFrom: "input" as const,
    }));
    return Promise.resolve({ findings });
  },
);
