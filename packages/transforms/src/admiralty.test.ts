import { describe, expect, it } from "vitest";
import * as Exports from "./index.ts";
import { defineTransform } from "./manifest.ts";

/**
 * P4-002 (ROADMAP 6.4 / D2): every transform carries a DOCUMENTED Admiralty
 * grade — the source-reliability grade of its provider and the default
 * information-credibility grade of its findings, with a written rationale.
 * This is the data the P4-001 confidence model (5.13) consumes.
 */

/** Every TransformDefinition exported by the package. */
interface TransformDefLike {
  manifest: { id: string; admiralty?: { reliability?: unknown; credibility?: unknown; rationale?: unknown } };
  run: unknown;
}
const definitions = Object.values(Exports as Record<string, unknown>).filter(
  (v): v is TransformDefLike => typeof v === "object" && v !== null && "manifest" in v && "run" in v,
);

const RELIABILITY = ["A", "B", "C", "D", "E", "F"];
const CREDIBILITY = [1, 2, 3, 4, 5, 6];

describe("P4-002: Admiralty grades for every transform", () => {
  it("the transforms package exports transform definitions at all", () => {
    expect(definitions.length).toBeGreaterThan(20);
  });

  it("every exported transform manifest carries an admiralty grade (reliability + credibility + rationale)", () => {
    expect(definitions.length).toBeGreaterThan(0);
    const missing: string[] = [];
    for (const def of definitions) {
      const a = def.manifest.admiralty;
      if (
        typeof a !== "object" ||
        a === null ||
        !RELIABILITY.includes(a.reliability as string) ||
        !CREDIBILITY.includes(a.credibility as number) ||
        typeof a.rationale !== "string" ||
        a.rationale.trim().length < 10
      ) {
        missing.push(def.manifest.id);
      }
    }
    expect(missing).toEqual([]);
  });

  it("a manifest without admiralty is rejected (fail-closed, like every other manifest rule)", () => {
    expect(() =>
      defineTransform(
        {
          id: "TR-010",
          version: "1.0.0",
          inputs: ["url"],
          outputs: ["http_response"],
          network: { mode: "public", allow: [] },
          secrets: [],
          limits: { rps: 2, timeoutMs: 10_000, maxBytes: 1_000_000 },
          sensitivity: "normal",
          license: "LC-B",
        },
        async () => ({ findings: [] }),
      ),
    ).toThrow();
  });

  it("an invalid admiralty grade is rejected", () => {
    expect(() =>
      defineTransform(
        {
          id: "TR-010",
          version: "1.0.0",
          inputs: ["url"],
          outputs: ["http_response"],
          network: { mode: "public", allow: [] },
          secrets: [],
          limits: { rps: 2, timeoutMs: 10_000, maxBytes: 1_000_000 },
          sensitivity: "normal",
          license: "LC-B",
          admiralty: { reliability: "X", credibility: 9, rationale: "invalid grades" },
        },
        async () => ({ findings: [] }),
      ),
    ).toThrow();
  });
});
