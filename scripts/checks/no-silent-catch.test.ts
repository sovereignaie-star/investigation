import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzeSource, scanRepo } from "./no-silent-catch.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("no silent catch {} in executable code (P2-006 / D-017)", () => {
  it("the repository has zero silent catch blocks in executable code", () => {
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
