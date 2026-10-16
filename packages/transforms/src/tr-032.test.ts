/**
 * P2-012 — TR-032 contract test (T-RULE-06). Perceptual image hash, LOCAL
 * ONLY (owner decision 2026-10-16: sharp — Apache-2.0 — with sharp-phash —
 * MIT; support and licenses verified by measurement before implementation:
 * sharp-phash's module IS the phash function and returns a 64-bit binary
 * string; `sharp-phash/distance` computes the Hamming distance; dHash is
 * computed from sharp's raw grayscale pixels with no extra dependency).
 *
 * The transform takes a base64-encoded image and emits pHash + dHash
 * findings — 64-character binary strings typed `perceptual_hash` (catalog
 * type added with context.required: a 64-bit 0/1 run in prose must not be
 * read as an identifier without context — the TR-036 lesson). ZERO network
 * requests (findings cite `derivedFrom: "input"`).
 *
 * Library behavior MEASURED 2026-10-16 before the transform existed:
 *   - sharp throws on non-image bytes (fail-closed material);
 *   - a lightly perturbed image has Hamming distance 0 from the original
 *     (perceptual stability — the point of the hash).
 *
 * Red first: this test was written before the transform existed and fails on
 * the missing module (the failing test for the right reason).
 */
import { describe, expect, it } from "vitest";
import { createSimServer } from "@ir/sim/server";
import { perceptualHash } from "./transforms/tr-032-perceptual-hash.ts";
import { runTransform } from "./runner.ts";

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

/** A deterministic 64x64 PNG: gradient + block (no fixtures file needed). */
async function craftPng(perturb = false): Promise<Buffer> {
  const sharp = await import("sharp");
  const w = 64;
  const h = 64;
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      raw[i] = (x * 4) % 256;
      raw[i + 1] = (y * 4) % 256;
      raw[i + 2] = x < 32 ? 200 : 20;
    }
  }
  if (perturb) {
    for (let i = 0; i < 200; i++) raw[(i * 97) % raw.length] ^= 0x18;
  }
  return sharp
    .default(raw, { raw: { width: w, height: h, channels: 3 } })
    .png()
    .toBuffer();
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

  it("is perceptually stable: a lightly perturbed image has Hamming distance 0 (pHash)", async () => {
    const phash = (await import("sharp-phash")).default;
    const distance = (await import("sharp-phash/distance")).default;
    const original = await craftPng();
    const perturbed = await craftPng(true);
    const d = distance(await phash(original), await phash(perturbed));
    expect(d).toBe(0);
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
