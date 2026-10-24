/**
 * P5-026 — TR-095 contract test (RED FIRST, J-1). Local image-manipulation
 * forensics: ELA + compression analysis + perceptual-hash matching against
 * case images. LOCAL ONLY (no network — zero requests, findings cite
 * `derivedFrom: "input"`).
 *
 * The acceptance criterion is the roadmap's: «كل نتيجة إشارة بدرجة ثقة لا
 * حكم؛ تُختبر على مجموعة صور معدّلة معروفة» — every result is a SIGNAL with a
 * confidence score, never a verdict, and the suite runs on a KNOWN set of
 * modified images (deterministic fixtures crafted with jimp below — no binary
 * fixtures in the repo):
 *
 * - `cleanJpeg` — a smooth gradient saved ONCE at q85 (the control: no region
 *   may be flagged as an ELA anomaly);
 * - `splicedJpeg` — the same gradient with a 32x32 noise patch (donor saved at
 *   q40 — a different compression history) composited at (64,64) and re-saved at
 *   q85 (the splice MUST be flagged: the patch's error levels deviate from the
 *   image-wide distribution);
 * - `nearDuplicateJpeg` — the same gradient re-encoded at q70 (pHash must stay
 *   close: a near-duplicate of the case image);
 * - `unrelatedJpeg` — a checkerboard (pHash must NOT match).
 *
 * Fail-closed: non-image bytes, empty input, an invalid reference hash and an
 * oversized reference list all throw before any work.
 */
import { describe, expect, it } from "vitest";
import { createSimServer } from "@ir/sim/server";
import { Jimp } from "jimp";
import { runTransform } from "../runner.ts";
import { imageForensics, MAX_REFERENCE_HASHES } from "./tr-095-image-forensics.ts";

/** The sim server's transport shape — the counting wrapper keeps it. */
type SimTransport = ReturnType<typeof createSimServer>["transport"];

/** A transport that counts every fetch: the local analysis must issue none. */
function counting(t: SimTransport): { transport: SimTransport; calls: () => number } {
  let n = 0;
  return {
    calls: () => n,
    transport: {
      ...t,
      fetch: (...args: Parameters<SimTransport["fetch"]>) => {
        n++;
        return t.fetch(...args);
      },
    },
  };
}

/** Deterministic PRNG (linear congruential) — the fixtures must be reproducible. */
function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

/** A smooth 128x128 gradient — the innocent base image. */
function gradientImage() {
  const w = 128;
  const h = 128;
  const image = new Jimp({ width: w, height: h, color: 0x000000ff });
  const d = image.bitmap.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      d[i] = (x * 2) % 256;
      d[i + 1] = (y * 2) % 256;
      d[i + 2] = (x + y) % 256;
      d[i + 3] = 255;
    }
  }
  return image;
}

/** A 32x32 noise patch — the donor region with a different compression history. */
function noiseImage(seed = 7) {
  const w = 32;
  const h = 32;
  const image = new Jimp({ width: w, height: h, color: 0x000000ff });
  const d = image.bitmap.data;
  const rnd = prng(seed);
  for (let i = 0; i < w * h; i++) {
    d[i * 4] = Math.floor(rnd() * 256);
    d[i * 4 + 1] = Math.floor(rnd() * 256);
    d[i * 4 + 2] = Math.floor(rnd() * 256);
    d[i * 4 + 3] = 255;
  }
  return image;
}

/** A checkerboard — an unrelated image for the hash-matching negative. */
function checkerImage() {
  const w = 128;
  const h = 128;
  const image = new Jimp({ width: w, height: h, color: 0x000000ff });
  const d = image.bitmap.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const v = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0 ? 230 : 20;
      d[i] = v;
      d[i + 1] = v;
      d[i + 2] = v;
      d[i + 3] = 255;
    }
  }
  return image;
}

type JimpInstance = ReturnType<typeof gradientImage>;

async function jpeg(image: JimpInstance, quality: number): Promise<Buffer> {
  return image.getBuffer("image/jpeg", { quality });
}

/** The known set — clean control. */
async function cleanJpeg(): Promise<Buffer> {
  return jpeg(gradientImage(), 85);
}

/** The known set — spliced image: noise patch (q40 donor) pasted at (64,64), re-saved q85. */
async function splicedJpeg(): Promise<Buffer> {
  const donorBytes = await jpeg(noiseImage(), 40);
  const donor = await Jimp.fromBuffer(donorBytes);
  const base = gradientImage();
  const bd = base.bitmap.data;
  const dd = donor.bitmap.data;
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const si = (y * 32 + x) * 4;
      const di = ((64 + y) * 128 + (64 + x)) * 4;
      bd[di] = dd[si];
      bd[di + 1] = dd[si + 1];
      bd[di + 2] = dd[si + 2];
      bd[di + 3] = 255;
    }
  }
  return jpeg(base, 85);
}

/** The known set — near duplicate: same gradient, re-encoded at q70. */
async function nearDuplicateJpeg(): Promise<Buffer> {
  return jpeg(gradientImage(), 70);
}

/** The known set — unrelated content. */
async function unrelatedJpeg(): Promise<Buffer> {
  return jpeg(checkerImage(), 85);
}

/** pHash of a JPEG buffer via TR-032's own algorithm (the case-image side of the match). */
async function phashOf(bytes: Buffer): Promise<string> {
  const { perceptualHash } = await import("./tr-032-perceptual-hash.ts");
  const result = await runTransform(perceptualHash, {
    transport: createSimServer([]).transport,
    input: { content: bytes.toString("base64") },
  });
  const f = result.output.findings.find((x) => x.predicate === "has_phash");
  if (f === undefined) throw new Error("no pHash");
  return f.objectValue;
}

/** Parses a JSON objectValue of a finding. */
function jsonOf(f: { objectValue: string } | undefined): Record<string, unknown> {
  if (f === undefined) throw new Error("finding missing");
  return JSON.parse(f.objectValue) as Record<string, unknown>;
}

describe("TR-095 local image forensics (P5-026 — signal with confidence, never a verdict)", () => {
  it("flags the spliced region of the known modified image and stays silent on the clean control", async () => {
    const sim = createSimServer([]);
    const counted = counting(sim.transport);

    const cleanRun = await runTransform(imageForensics, {
      transport: counted.transport,
      input: { content: (await cleanJpeg()).toString("base64") },
    });
    const cleanRegions = cleanRun.output.findings.filter((f) => f.predicate === "ela_anomaly_region");
    expect(cleanRegions).toHaveLength(0);

    const spliceRun = await runTransform(imageForensics, {
      transport: counted.transport,
      input: { content: (await splicedJpeg()).toString("base64") },
    });
    const regions = spliceRun.output.findings.filter((f) => f.predicate === "ela_anomaly_region");
    expect(regions.length).toBeGreaterThanOrEqual(1);
    // The flagged region must intersect the pasted patch (64..96 x 64..96).
    let hit = false;
    for (const f of regions) {
      const r = jsonOf(f);
      const x = r.x as number;
      const y = r.y as number;
      const w = r.w as number;
      const h = r.h as number;
      if (x < 96 && x + w > 64 && y < 96 && y + h > 64) hit = true;
      // A signal, not a verdict: bounded confidence + an explanation.
      expect(f.confidence).toBeGreaterThan(0);
      expect(f.confidence).toBeLessThanOrEqual(0.95);
      expect(f.explanation.length).toBeGreaterThan(10);
      expect(f.derivedFrom).toBe("input");
    }
    expect(hit).toBe(true);
    // Zero network requests across both runs.
    expect(counted.calls()).toBe(0);
    expect(cleanRun.requestCount + spliceRun.requestCount).toBe(0);
  });

  it("reports the compression signal: JPEG quality estimate from the quantization tables", async () => {
    const run = await runTransform(imageForensics, {
      transport: createSimServer([]).transport,
      input: { content: (await cleanJpeg()).toString("base64") },
    });
    const signal = run.output.findings.find((f) => f.predicate === "compression_signal");
    const parsed = jsonOf(signal);
    expect(parsed.format).toBe("jpeg");
    // The fixture was saved at q85 — the estimate must land in a measured band.
    expect(parsed.qualityEstimate).toBeGreaterThanOrEqual(75);
    expect(parsed.qualityEstimate).toBeLessThanOrEqual(95);
    expect(signal).toMatchObject({ objectType: "compression_signal", derivedFrom: "input" });

    const pngRun = await runTransform(imageForensics, {
      transport: createSimServer([]).transport,
      input: { content: (await gradientImage().getBuffer("image/png")).toString("base64") },
    });
    const pngSignal = pngRun.output.findings.find((f) => f.predicate === "compression_signal");
    const pngParsed = jsonOf(pngSignal);
    expect(pngParsed.format).toBe("png");
    expect(pngParsed.qualityEstimate).toBeUndefined();
  });

  it("matches the subject against case-image hashes: near duplicate found, unrelated image not", async () => {
    const subject = (await splicedJpeg()).toString("base64");
    const nearDup = await phashOf(await nearDuplicateJpeg());
    const unrelated = await phashOf(await unrelatedJpeg());

    const matched = await runTransform(imageForensics, {
      transport: createSimServer([]).transport,
      input: { content: subject, referenceHashes: [nearDup, unrelated] },
    });
    const matches = matched.output.findings.filter((f) => f.predicate === "near_duplicate_of");
    expect(matches).toHaveLength(1);
    expect(matches[0]?.objectValue).toBe(nearDup);
    expect(matches[0]?.objectType).toBe("perceptual_hash");
    expect(matches[0]?.confidence).toBeGreaterThan(0.5);
    expect(matches[0]?.confidence).toBeLessThan(1);
    expect(matches[0]?.derivedFrom).toBe("input");
    expect(matched.requestCount).toBe(0);
  });

  it("fails closed on bad input before any work (non-image, empty, bad hash, oversized list)", async () => {
    const sim = createSimServer([]);
    const counted = counting(sim.transport);
    const good = (await cleanJpeg()).toString("base64");
    await expect(
      runTransform(imageForensics, { transport: counted.transport, input: { content: "aGVsbG8gd29ybGQgbm90IGFuIGltYWdl" } }),
    ).rejects.toThrow(/not a valid image|is required|PNG|JPEG/i);
    await expect(runTransform(imageForensics, { transport: counted.transport, input: { content: "" } })).rejects.toThrow(/is required/i);
    await expect(
      runTransform(imageForensics, { transport: counted.transport, input: { content: good, referenceHashes: ["not-a-hash"] } }),
    ).rejects.toThrow(/referenceHashes/i);
    await expect(
      runTransform(imageForensics, {
        transport: counted.transport,
        input: { content: good, referenceHashes: Array.from({ length: MAX_REFERENCE_HASHES + 1 }, () => "0".repeat(64)) },
      }),
    ).rejects.toThrow(/referenceHashes/i);
    expect(counted.calls()).toBe(0);
  });

  it("declares the local-only manifest (LC-A, public with an empty allow list)", () => {
    expect(imageForensics.manifest).toMatchObject({
      id: "TR-095",
      license: "LC-A",
      network: { mode: "public", allow: [] },
      secrets: [],
    });
  });
});
