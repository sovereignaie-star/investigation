/**
 * P2-012 — TR-032 contract test (T-RULE-06). Perceptual image hash, LOCAL
 * ONLY (owner decision 2026-10-16, second round: jimp — MIT, pure JavaScript;
 * the first sharp-based implementation was stopped because sharp's native
 * .node binary cannot be bundled into the sandbox runner's eval source —
 * measured on both the CLI build gate and `bundleTransform`; see
 * DECLARED_LIMITS L-18).
 *
 * The transform takes a base64-encoded image and emits pHash + dHash
 * findings — 64-character binary strings typed `perceptual_hash` (catalog
 * type added with context.required: a 64-bit 0/1 run in prose must not be
 * read as an identifier without context — the TR-036 lesson). ZERO network
 * requests (findings cite `derivedFrom: "input"`).
 *
 * Library behavior MEASURED 2026-10-16 before the rewrite: jimp decodes a
 * crafted PNG, exposes `bitmap.data` (RGBA), resizes, and throws on
 * non-image bytes (fail-closed material).
 *
 * Red first: the original test (sharp round) was written before the
 * transform existed and failed on the missing module. The jimp rewrite's
 * failing gate was the build (sharp unbundleable) — it went red for the
 * right reason and this suite turns green with jimp.
 */
import { describe, expect, it } from "vitest";
import { createSimServer } from "@ir/sim/server";
import { perceptualHash } from "./transforms/tr-032-perceptual-hash.ts";
import { runTransform } from "./runner.ts";
import { Jimp } from "jimp";

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

/** A deterministic 64x64 PNG: gradient + block (crafted with jimp, no fixtures). */
async function craftPng(perturb = false): Promise<Buffer> {
  const w = 64;
  const h = 64;
  const image = new Jimp({ width: w, height: h, color: 0x000000ff });
  const data = image.bitmap.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      data[i] = (x * 4) % 256;
      data[i + 1] = (y * 4) % 256;
      data[i + 2] = x < 32 ? 200 : 20;
      data[i + 3] = 255;
    }
  }
  if (perturb) {
    for (let i = 0; i < 200; i++) data[(i * 97) % data.length] ^= 0x18;
  }
  return image.getBuffer("image/png");
}

/** Hamming distance between two equal-length binary strings. */
function hamming(a: string, b: string): number {
  if (a.length !== b.length) throw new Error("length mismatch");
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

describe("TR-032 perceptual image hash (local, no network)", () => {
  it("emits pHash and dHash for an image — zero requests, findings cite the input", async () => {
    const sim = createSimServer([]);
    const counted = counting(sim.transport);
    const input = { content: (await craftPng()).toString("base64") };
    const result = await runTransform(perceptualHash, { transport: counted.transport, input });
    expect(result.requestCount).toBe(0);
    expect(counted.calls()).toBe(0);
    const findings = result.output.findings;
    const phash = findings.find((f) => f.predicate === "has_phash");
    const dhash = findings.find((f) => f.predicate === "has_dhash");
    expect(phash).toBeDefined();
    expect(dhash).toBeDefined();
    for (const f of [phash, dhash]) {
      expect(f).toMatchObject({ objectType: "perceptual_hash", derivedFrom: "input", confidence: 1 });
      if (f === undefined) throw new Error("missing hash finding");
      expect(f.objectValue).toMatch(/^[01]{64}$/);
    }
    for (const f of findings) expect(f.evidence).toBeUndefined();
  });

  it("is perceptually stable: a lightly perturbed image stays within a few bits", async () => {
    const run = async (perturb: boolean) => {
      const content = (await craftPng(perturb)).toString("base64");
      const result = await runTransform(perceptualHash, {
        transport: counting(createSimServer([]).transport).transport,
        input: { content },
      });
      const by = new Map(result.output.findings.map((f) => [f.predicate, f.objectValue]));
      return { phash: by.get("has_phash"), dhash: by.get("has_dhash") };
    };
    const original = await run(false);
    const perturbed = await run(true);
    if (typeof original.phash !== "string" || typeof perturbed.phash !== "string") throw new Error("missing pHash");
    if (typeof original.dhash !== "string" || typeof perturbed.dhash !== "string") throw new Error("missing dHash");
    // A light perturbation must stay close (a random unrelated image would
    // sit near 32 — half the bits). Bound measured empirically, kept loose.
    expect(hamming(original.phash, perturbed.phash)).toBeLessThanOrEqual(8);
    expect(hamming(original.dhash, perturbed.dhash)).toBeLessThanOrEqual(8);
  });

  it("rejects non-image bytes and empty input before anything runs (fail-closed, zero transport calls)", async () => {
    const sim = createSimServer([]);
    const counted = counting(sim.transport);
    for (const bad of ["aGVsbG8gd29ybGQgbm90IGFuIGltYWdl", ""]) {
      await expect(runTransform(perceptualHash, { transport: counted.transport, input: { content: bad } })).rejects.toThrow(
        /not a valid image|is required/,
      );
    }
    expect(counted.calls()).toBe(0);
  });
});
