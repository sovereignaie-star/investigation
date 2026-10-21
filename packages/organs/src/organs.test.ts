/**
 * P4-024 red-first: the three organs (الأجهزة الثلاثة) as a verifiable registry.
 * Written before packages/organs existed: every test below fails on the pre-feature tree.
 *
 * Honesty rules under test:
 * - an organ is linked to the project only through packages that REALLY exist on disk;
 * - every organ is bound by the ethics rules E-01, E-02, E-04, E-10 and is non-offensive;
 * - the countermeasures organ (جهاز المكافحة) is lawful response only — it names the
 *   capabilities it forbids, and none of its declared actions is offensive;
 * - the organs declare their maturity (charter), never pretend to be operational.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { ORGANS, getOrgan, type OrganId } from "./index";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), "utf8");

describe("the three organs registry (P4-024)", () => {
  it("has exactly the three organs, in order, with their Arabic names", () => {
    expect(ORGANS.map((o) => o.id)).toEqual(["prevention", "investigation", "countermeasures"]);
    expect(getOrgan("prevention").nameAr).toBe("جهاز الوقاية الجنائية");
    expect(getOrgan("investigation").nameAr).toBe("جهاز التحري");
    expect(getOrgan("countermeasures").nameAr).toBe("جهاز المكافحة");
  });

  it("every organ states a mission and at least three responsibilities in Arabic", () => {
    for (const o of ORGANS) {
      expect(o.mission).toMatch(/[\u0600-\u06FF]/);
      expect(o.responsibilities.length).toBeGreaterThanOrEqual(3);
      for (const r of o.responsibilities) expect(r).toMatch(/[\u0600-\u06FF]/);
    }
  });

  it("is linked to the project: every linked package exists in the workspace with that exact name", () => {
    for (const o of ORGANS) {
      expect(o.linkedPackages.length).toBeGreaterThan(0);
      for (const pkg of o.linkedPackages) {
        const DIR_OVERRIDES: Record<string, string> = { "@ir/transform-sandbox": "sandbox" };
        const dir = DIR_OVERRIDES[pkg] ?? pkg.replace("@ir/", "");
        const manifest = path.join(ROOT, "packages", dir, "package.json");
        expect(existsSync(manifest), `${pkg} (${o.id})`).toBe(true);
        expect(JSON.parse(readFileSync(manifest, "utf8")).name).toBe(pkg);
      }
    }
  });

  it("every planned task id exists in the ROADMAP", () => {
    const roadmap = read("docs/ROADMAP.md");
    for (const o of ORGANS) {
      for (const id of o.plannedTasks) expect(roadmap, `${id} (${o.id})`).toMatch(new RegExp(`^\\| ${id} \\|`, "m"));
    }
  });

  it("every organ is bound by E-01, E-02, E-04 and E-10 and is not offensive", () => {
    for (const o of ORGANS) {
      for (const e of ["E-01", "E-02", "E-04", "E-10"]) expect(o.ethics, `${e} (${o.id})`).toContain(e);
      expect(o.offensive).toBe(false);
    }
  });

  it("the countermeasures organ forbids offensive action, unauthorized access and surveillance by name", () => {
    const c = getOrgan("countermeasures");
    for (const f of ["offensive-action", "unauthorized-access", "surveillance-of-natural-persons"]) {
      expect(c.forbidden).toContain(f);
    }
    // no declared responsibility advertises a forbidden capability
    const banned = /(اختراق|هجوم|تجسس|تعقب شخص|تعطيل خدمة)/;
    for (const o of ORGANS) for (const r of o.responsibilities) expect(r).not.toMatch(banned);
  });

  it("declares its maturity honestly: charter only until a task implements it", () => {
    for (const o of ORGANS) expect(o.maturity).toBe("charter");
  });

  it("each organ has a folder README (its charter) naming the organ", () => {
    for (const o of ORGANS) {
      const readme = read(`packages/organs/src/${o.id}/README.md`);
      expect(readme).toContain(o.nameAr);
      expect(readme).toContain("E-04");
    }
  });

  it("getOrgan throws on an unknown id instead of returning undefined", () => {
    expect(() => getOrgan("nope" as OrganId)).toThrow(/nope/);
  });

  it("is registered in governance: ADR-32 exists, ROADMAP lists P4-024, DECLARED_LIMITS records the charter-only limit", () => {
    const adr = read("docs/adr/ADR-32-three-organs.md");
    for (const o of ORGANS) expect(adr).toContain(o.nameAr);
    expect(read("docs/ROADMAP.md")).toMatch(/^\| P4-024 \|/m);
    expect(read("docs/DECLARED_LIMITS.md")).toContain("ADR-32");
  });
});
