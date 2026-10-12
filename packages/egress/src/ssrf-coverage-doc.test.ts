/**
 * Keeps docs/adr/reference/T-SEC-SSRF-COVERAGE.md honest (P2-003): every test the matrix cites must exist in the
 * file it names, every canonical id 001..048 has exactly one row, and every row carries one of the three allowed
 * classifications. A citation of a renamed or deleted test fails here instead of silently overclaiming.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SSRF_CASES } from "./ssrf-cases";
import { TIMING_CASES } from "./ssrf-timing-cases";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DOC = fs.readFileSync(path.join(REPO, "docs/adr/reference/T-SEC-SSRF-COVERAGE.md"), "utf8");
const FILES: Record<string, string> = {
  "ssrf-matrix.test.ts": "packages/egress/src/ssrf-matrix.test.ts",
  "node-transport-ssrf.test.ts": "packages/egress/src/node-transport-ssrf.test.ts",
  "ssrf-mutation.test.ts": "packages/egress/src/ssrf-mutation.test.ts",
  "vault.test.ts": "apps/server/src/routes/vault.test.ts",
  "content-inventory.test.ts": "packages/egress/src/content-inventory.test.ts",
  "iana-reference-differential.test.ts": "docs/adr/reference/iana/iana-reference-differential.test.ts",
};
// the matrix runs the shared case tables (ssrf-cases.ts, ssrf-timing-cases.ts) as its own tests
const CASE_TITLES = new Set([...SSRF_CASES, ...TIMING_CASES].map((c) => c.title));
const CITATION = /`([\w.-]+\.test\.ts)` › `([^`]+)`/g;

export function citations(doc: string): Array<{ id: string; file: string; title: string }> {
  const out: Array<{ id: string; file: string; title: string }> = [];
  for (const line of doc.split("\n")) {
    const id = /^\| (T-SEC-SSRF-\d{3}) \|/.exec(line)?.[1];
    if (!id) continue;
    for (const [, file = "", title = ""] of line.matchAll(CITATION)) out.push({ id, file, title });
  }
  return out;
}

export function exists(file: string, title: string): boolean {
  const rel = FILES[file];
  if (!rel) return false;
  const src = fs.readFileSync(path.join(REPO, rel), "utf8");
  // a literal it("...") title, or a row title from the case table executed by ssrf-matrix.test.ts
  return (
    src.includes(JSON.stringify(title)) ||
    src.includes(`"${title}"`) ||
    src.includes(`\`${title}\``) ||
    (file === "ssrf-matrix.test.ts" && CASE_TITLES.has(title))
  );
}

describe("T-SEC-SSRF-COVERAGE.md stays consistent with the tests", () => {
  it("every canonical id 001..048 has exactly one row, with an allowed classification", () => {
    for (let n = 1; n <= 48; n++) {
      const id = `T-SEC-SSRF-${String(n).padStart(3, "0")}`;
      const rows = DOC.split("\n").filter((l) => l.startsWith(`| ${id} |`));
      expect(rows, id).toHaveLength(1);
      expect(rows[0], id).toMatch(/\| (مُثبت كاملاً|مُثبت جزئياً|غير مُثبت) — /);
    }
  });

  it("every cited test exists in the file it names", () => {
    const cited = citations(DOC);
    expect(cited.length).toBeGreaterThan(60);
    const missing = cited.filter((c) => !exists(c.file, c.title));
    expect(missing).toEqual([]);
  });

  it("negative control: a citation of a test that does not exist is reported", () => {
    const fake = "| T-SEC-SSRF-999 | x | x | x | x | مُثبت كاملاً — `ssrf-matrix.test.ts` › `a test nobody wrote` |";
    expect(citations(fake)).toEqual([{ id: "T-SEC-SSRF-999", file: "ssrf-matrix.test.ts", title: "a test nobody wrote" }]);
    expect(exists("ssrf-matrix.test.ts", "a test nobody wrote")).toBe(false);
    expect(exists("unknown.test.ts", "x")).toBe(false);
  });

  it("no overall coverage percentage is claimed", () => {
    expect(DOC).not.toMatch(/\d+\s*%/);
  });
});
