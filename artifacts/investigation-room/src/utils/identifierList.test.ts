// T-IDL-001..006 — integrity of the identifier type list (ROADMAP 8.3). Guards against a repeat of D-001.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { IDENTIFIER_LIST } from "./identifierList";

const source = readFileSync(fileURLToPath(new URL("./identifierList.ts", import.meta.url)), "utf8");

describe("identifierList", () => {
  it("T-IDL-001 contains exactly 371 types (370 + repaired onion_v3)", () => {
    expect(IDENTIFIER_LIST).toHaveLength(371);
  });

  it("T-IDL-002 every id is unique", () => {
    const ids = IDENTIFIER_LIST.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("T-IDL-003 every regex is a RegExp and every required field is non-empty", () => {
    for (const t of IDENTIFIER_LIST) {
      expect(t.regex, t.id).toBeInstanceOf(RegExp);
      for (const k of ["id", "name", "nameAr", "category", "categoryAr", "description"] as const) {
        expect(t[k], `${t.id}.${k}`).toMatch(/\S/);
      }
    }
  });

  it("T-IDL-004 no source line longer than 2,000 characters (D-001 regression guard)", () => {
    const longest = Math.max(...source.split("\n").map((l) => l.length));
    expect(longest).toBeLessThan(2000);
  });

  it("T-IDL-005 onion_v3 example is a valid v3 address", () => {
    const onion = IDENTIFIER_LIST.find((t) => t.id === "onion_v3");
    expect(onion?.examples?.[0]).toMatch(/^[a-z2-7]{56}\.onion$/);
    expect(onion?.regex.test(onion.examples![0])).toBe(true);
  });

  it("T-IDL-006 baseline: share of examples matching their own regex does not regress (D-006, fixed in P1-004)", () => {
    let total = 0;
    let matching = 0;
    for (const t of IDENTIFIER_LIST) {
      for (const ex of t.examples ?? []) {
        total++;
        t.regex.lastIndex = 0;
        if (t.regex.test(ex)) matching++;
      }
    }
    // Baseline measured 2026-10-10 after P0-004. P1-004 must raise this to 100%.
    expect(total).toBeGreaterThan(0);
    expect(matching / total).toBeGreaterThanOrEqual(0.8);
  });
});
