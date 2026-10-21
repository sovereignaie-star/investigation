import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzeDiscovery, analyzeSkips, BASELINE_PATH, scanRepo, walkTestFiles } from "./no-silent-skips";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * P4-007 — the owner's ruling (2026-10-21 18:55 +03): a CI guard that prevents any
 * test.skip / silently-skipped test in NEW files. The trigger: TimelineView.test.tsx
 * sat outside vitest's include pattern and NEVER ran (its green was assumed, not
 * executed) — a silent skip of the whole file. Two failure classes are guarded:
 *  (A) skip tokens growing beyond the committed baseline (scripts/checks/skip-baseline.json):
 *      a new .skip/.todo/.skipIf/.only/ctx.skip in a new or existing file fails the build.
 *      Shrinking is allowed (the baseline can be regenerated deliberately).
 *  (B) test files no runner would ever execute: a *.test.* file that matches neither
 *      vitest's include patterns, nor the node --test sets in CI, nor the explicit
 *      script-run allowlist — the exact .test.tsx defect class of this task.
 *
 * Red-first: this file was written before the implementation (the module did not
 * exist — structural red, the negative controls below are the behavioral demand).
 * The fixtures build skip tokens by CONCATENATION (".ski" + "p(") so this test file's
 * own source contains no literal token the self-scan would count.
 */

// The four skip-token families, built by concatenation so this file's own source
// carries no literal token for the self-scan to count.
const TOK_SKIP = ".ski" + "p(";
const TOK_SKIP_IF = ".ski" + "pIf(";
const TOK_TODO = ".to" + "do(";
const TOK_ONLY = ".onl" + "y(";

describe("no silent skips — tests that never run (P4-007 owner ruling 2026-10-21)", () => {
  it("self-scan: the repository has ZERO findings (no undiscovered test files, no skips beyond the baseline)", () => {
    const findings = scanRepo(REPO);
    expect(findings).toEqual([]);
  });

  it("detects a skip token in a file with NO baseline entry (the new-file case)", () => {
    const findings = analyzeSkips(
      [{ path: "packages/x/src/new.test.ts", content: `it("a", () => {});\nit${TOK_SKIP}"b", () => {});` }],
      {},
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: "new-skip", file: "packages/x/src/new.test.ts" });
  });

  it("detects skip-count GROWTH in a file the baseline already covers (1 allowed, 2 present)", () => {
    const findings = analyzeSkips(
      [{ path: "packages/x/src/growing.test.ts", content: `it${TOK_SKIP}"a", () => {});\nit${TOK_SKIP}"b", () => {});` }],
      { "packages/x/src/growing.test.ts": 1 },
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: "new-skip", file: "packages/x/src/growing.test.ts" });
  });

  it("allows a baseline SHRINK (fewer tokens than the baseline allows) — reduction is not a finding", () => {
    const findings = analyzeSkips([{ path: "packages/x/src/shrinking.test.ts", content: `it${TOK_SKIP_IF}cond)("a", () => {});` }], {
      "packages/x/src/shrinking.test.ts": 2,
    });
    expect(findings).toEqual([]);
  });

  it("counts every token family: .skip, .todo, .skipIf, .only, ctx.skip", () => {
    const content = [
      `it${TOK_SKIP}"a", () => {});`,
      `it${TOK_TODO}"b", () => {});`,
      `describe${TOK_SKIP_IF}c)("d", () => {});`,
      `it${TOK_ONLY}"e", () => {});`,
      `if (x) return ctx${".sk" + "ip("});`,
    ].join("\n");
    const findings = analyzeSkips([{ path: "packages/x/src/all.test.ts", content }], {});
    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toContain("5");
  });

  it("detects a skip token separated from its paren by a SPACE (round-4 gap): a member call with a space before the argument list is a real skip", () => {
    // Round-4 verification demand: the token regex must key on the CALL STRUCTURE
    // (member call, optional whitespace before the argument list), not a tight
    // textual sequence — `test.skip ("x")` is valid JavaScript and a real skip.
    // ".skip (" with a SPACE before the argument list — built by concatenation.
    const TOK_SKIP_SPACEY = ".ski" + "p (";
    const content = [`it("a", () => {});`, `test${TOK_SKIP_SPACEY}"b", () => {});`].join("\n");
    const findings = analyzeSkips([{ path: "packages/x/src/spacey.test.ts", content }], {});
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: "new-skip", file: "packages/x/src/spacey.test.ts" });
  });

  it("detects a Playwright spec that the real testMatch would NOT discover (round-4 gap): _tmp-shot.spec.ts under scripts/e2e", () => {
    // Round-4 verification demand: exemption must mirror the RUNNER'S ACTUAL config —
    // playwright.config.ts matches /uc\d{2}.*\.spec\.ts/ only. A spec file that does
    // not match it (like this session's temporary _tmp-shot.spec.ts) is silently
    // dead and MUST be flagged, not waved through by a directory-prefix exemption.
    const findings = analyzeDiscovery([{ path: "scripts/e2e/_tmp-shot.spec.ts", content: "" }]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: "undiscovered", file: "scripts/e2e/_tmp-shot.spec.ts" });
  });

  it("detects an undiscovered test file — the P4-007 defect class (.test.tsx under apps/web)", () => {
    const findings = analyzeDiscovery([{ path: "apps/web/src/pages/workbench/X.test.tsx", content: "" }]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: "undiscovered", file: "apps/web/src/pages/workbench/X.test.tsx" });
  });

  it("detects a .test.ts file outside every include root (no runner can load it)", () => {
    const findings = analyzeDiscovery([{ path: "scripts/other/thing.test.ts", content: "" }]);
    expect(findings[0]).toMatchObject({ kind: "undiscovered", file: "scripts/other/thing.test.ts" });
  });

  it("accepts every legitimate runner path: vitest roots, apps/sandbox exclusion, node --test sets, script allowlist", () => {
    const ok = [
      "packages/core/src/normalize.test.ts",
      "lib/db/src/index.test.ts",
      "apps/web/src/layout.test.ts",
      "scripts/checks/no-silent-skips.test.ts",
      "docs/adr/reference/iana/iana-registry.test.ts",
      "scripts/governance/check.test.mjs",
      "scripts/gates/security-review-gate.test.mjs",
      "scripts/reference/iana-drift.test.mjs",
    ].map((p) => ({ path: p, content: "" }));
    expect(analyzeDiscovery(ok)).toEqual([]);
    // apps/sandbox is excluded from vitest — its files must not claim vitest discovery
    const sandbox = analyzeDiscovery([{ path: "apps/sandbox/src/x.test.ts", content: "" }]);
    expect(sandbox[0]).toMatchObject({ kind: "undiscovered" });
  });

  it("detects a skip token after a string containing // (round-5 gap): comment stripping must be string-aware", () => {
    // Round-5 verification demand: the naive // regex ate everything after a URL
    // inside a string literal — hiding the very skip token the guard exists to
    // catch. The scan must treat "https://x" as TEXT, not as a comment opener.
    const findings = analyzeSkips(
      [
        {
          path: "packages/x/src/str.test.ts",
          content: `describe("https://x", () => { test${TOK_SKIP}"a", () => {}); });`,
        },
      ],
      {},
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: "new-skip", file: "packages/x/src/str.test.ts" });
  });

  it("still ignores a skip token that lives ONLY in a comment after string-aware stripping (no false positives)", () => {
    const findings = analyzeSkips(
      [
        {
          path: "packages/x/src/comment.test.ts",
          // a comment on a line that also has code; the token is inside the comment
          content: `it("a", () => {}); // see test${TOK_SKIP}docs for why
it("b", () => {});`,
        },
      ],
      {},
    );
    expect(findings).toHaveLength(0);
  });

  it("a .test.mts file is SEEN by the real file walk and reported undiscovered (round-5 gap)", () => {
    // Round-5 verification demand: the walk's file-name filter had dropped .mts —
    // such a file would vanish from the scan entirely instead of being reported
    // as outside every runner (vitest's include is **/*.test.ts only).
    const dir = mkdtempSync(path.join(tmpdir(), "nss-mts-"));
    try {
      writeFileSync(path.join(dir, "x.test.mts"), `test${TOK_SKIP}"a", () => {});`);
      const files = walkTestFiles(dir);
      expect(files.map((f) => f.path)).toContain("x.test.mts");
      const findings = analyzeDiscovery(files);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({ kind: "undiscovered", file: "x.test.mts" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("detects a CHAINED skip (round-6 gap): test.skip.each([1])(...) is a real silent skip", () => {
    // Round-6 verification demand: the call-structure regex required the paren
    // directly after the method name — a chained modifier (.each([1])) hid the
    // skip entirely. The guard must see the CALL STRUCTURE, not one spelling.
    // built by concatenation so the guard's own suite is not self-flagged
    const content = `test${".ski" + "p"}.each([1])("x", () => {});`;
    const findings = analyzeSkips([{ path: "packages/x/src/chained.test.ts", content }], {});
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: "new-skip", file: "packages/x/src/chained.test.ts" });
  });

  it("detects a skip after a NESTED template literal containing // (round-6 gap): the scanner must be token-aware, not quote-counting", () => {
    // Round-6 verification demand: a quote-counting scanner ends the template at
    // the INNER backtick, then reads `https://x`'s // as a comment opener and
    // eats the skip call that follows ON THE SAME LINE. Real parsing required.
    const content = "const label = `outer ${`https://x`}`; test" + TOK_SKIP + '"y", () => {});';
    const findings = analyzeSkips([{ path: "packages/x/src/tpl.test.ts", content }], {});
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: "new-skip", file: "packages/x/src/tpl.test.ts" });
  });

  it("the baseline file exists at the committed path (the guard is only as good as its baseline)", () => {
    expect(BASELINE_PATH.endsWith("skip-baseline.json")).toBe(true);
  });
});
