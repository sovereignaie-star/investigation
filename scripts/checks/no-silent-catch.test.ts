import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { slowIt } from "@ir/test-utils";
import { analyzeSource, scanRepo } from "./no-silent-catch.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("no silent catch {} in executable code (P2-006 / D-017)", () => {
  // P6-016 / J-11: @slow — this guard scans the whole repository; the repo walk grew with
  // the generated client and it timed out at 5,000 ms on CI under the full coverage run
  // (run 39198518973 on main 4bd05b8, 2026-10-19) while passing in 2.5 s locally unloaded.
  slowIt("the repository has zero silent catch blocks in executable code", () => {
    const { executable } = scanRepo(REPO);
    expect(executable, JSON.stringify(executable, null, 2)).toEqual([]);
  });

  describe("analyzer (negative controls: it must actually detect violations)", () => {
    const f = (code: string, rel = "apps/server/src/x.ts") => analyzeSource(rel, code);
    it("detects an empty catch block", () => {
      expect(f(`try { f(); } catch {}`)).toHaveLength(1);
      expect(f(`try { f(); } catch (e) {}`)).toHaveLength(1);
    });
    it("detects a comment-only catch block (the D-017 pattern)", () => {
      expect(f(`try { f(); } catch { // silently ignore\n }`)).toHaveLength(1);
      expect(f(`try { f(); } catch (e) { /* legacy */ }`)).toHaveLength(1);
    });
    it("ignores a catch that records, rethrows, or returns a typed failure", () => {
      expect(f(`try { f(); } catch (e) { throw e; }`)).toEqual([]);
      expect(f(`try { f(); } catch (e) { log(e); }`)).toEqual([]);
      expect(f(`try { f(); } catch (e) { return { error: String(e) }; }`)).toEqual([]);
      expect(f(`try { f(); } catch (e) { record(e); }`)).toEqual([]);
    });
    it("ignores comments, strings and non-catch blocks", () => {
      expect(f(`// catch {} in a comment\nconst s = "catch {}";`)).toEqual([]);
      expect(f(`if (x) {}`)).toEqual([]);
      expect(f(`function g() { return 1; }`)).toEqual([]);
    });
  });
});
