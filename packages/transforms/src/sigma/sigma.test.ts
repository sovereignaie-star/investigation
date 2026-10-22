import { describe, expect, it } from "vitest";

import { matchSigma, type NormalizedSigmaRule, type SigmaEvent, type SigmaMatcher, type SigmaSelection } from "./sigma.ts";
import { SIGMA_RULES } from "./rules.generated.ts";

/**
 * P4-021 — the Sigma matcher. The rules of record are the frozen official
 * SigmaHQ rules, converted to the documented normalized form by
 * tools/threat-rules/build_reference.py (the faithful conversion is the tool's;
 * the runtime evaluates the normalized form only — no YAML at runtime).
 * Matching is pure evaluation over structured events: nothing is fetched and
 * nothing is executed.
 */

describe("P4-021 — Sigma matching (normalized official rules)", () => {
  it("a frozen rule matches a crafted event exactly per its semantics", () => {
    const rule = SIGMA_RULES.find((r) => r.title.includes("7-ZIP")) as unknown as NormalizedSigmaRule;
    expect(rule).toBeTruthy();
    const hit: SigmaEvent = {
      Description: "7-Zip archiver",
      Image: "C:\\\\Program Files\\\\7z.exe",
      CommandLine: "7z.exe a -psecret archive.zip C:\\\\data",
    };
    expect(matchSigma(rule, hit)).toBe(true);
    // بلا كلمة مرور في سطر الأوامر: لا تطابق — لا اختراع
    const miss: SigmaEvent = {
      Description: "7-Zip archiver",
      Image: "C:\\\\Program Files\\\\7z.exe",
      CommandLine: "7z.exe a archive.zip C:\\\\data",
    };
    expect(matchSigma(rule, miss)).toBe(false);
    // أداة أخرى كلياً
    expect(matchSigma(rule, { Image: "C:\\\\windows\\\\system32\\\\cmd.exe", CommandLine: "dir" })).toBe(false);
  });

  it("field modifiers: is / contains / startswith / endswith — case-insensitive, missing field never matches", () => {
    const mk = (modifier: SigmaMatcher["modifier"], values: string[]): NormalizedSigmaRule => ({
      id: "test",
      title: "test",
      level: "medium",
      tags: [],
      logsource: {},
      selections: [{ name: "s", alternatives: [{ matchers: [{ field: "Field", modifier, values }] }] }],
      condition: { kind: "all-named", names: ["s"], excludes: [] },
    });
    const ev = (v: string): SigmaEvent => ({ Field: v });
    expect(matchSigma(mk("is", ["Value"]), ev("value"))).toBe(true); // المساواة غير حساسة لحالة الأحرف
    expect(matchSigma(mk("is", ["Value"]), ev("other"))).toBe(false);
    expect(matchSigma(mk("contains", ["secret"]), ev("a-SECRET-b"))).toBe(true);
    expect(matchSigma(mk("startswith", ["C:\\\\Users\\\\"]), ev("c:\\\\users\\\\bob\\\\file"))).toBe(true);
    expect(matchSigma(mk("endswith", [".exe"]), ev("payload.EXE"))).toBe(true);
    expect(matchSigma(mk("is", ["x"]), {})).toBe(false); // حقل غائب لا يطابق أبداً
  });

  it("alternatives are OR'd, matchers inside an alternative are AND'd", () => {
    const rule: NormalizedSigmaRule = {
      id: "t",
      title: "t",
      level: "medium",
      tags: [],
      logsource: {},
      selections: [
        {
          name: "s",
          alternatives: [
            {
              matchers: [
                { field: "A", modifier: "is", values: ["1"] },
                { field: "B", modifier: "contains", values: ["x"] },
              ],
            },
            { matchers: [{ field: "C", modifier: "is", values: ["yes"] }] },
          ],
        },
      ],
      condition: { kind: "all-named", names: ["s"], excludes: [] },
    };
    expect(matchSigma(rule, { A: "1", B: "xx" })).toBe(true); // البديل الأول: كلا الشرطين
    expect(matchSigma(rule, { A: "1", B: "no" })).toBe(false); // البديل الأول فشل، الثاني فشل
    expect(matchSigma(rule, { C: "yes" })).toBe(true); // البديل الثاني
  });

  it("conditions: all-of-prefix, any-of-prefix, and filters (excludes) subtract matches", () => {
    const base = {
      id: "t",
      title: "t",
      level: "medium",
      tags: [],
      logsource: {},
    };
    const sel = (name: string): SigmaSelection => ({
      name,
      alternatives: [{ matchers: [{ field: "Cmd", modifier: "is", values: ["run"] }] }],
    });
    const filter = (name: string): SigmaSelection => ({
      name,
      alternatives: [{ matchers: [{ field: "User", modifier: "is", values: ["admin"] }] }],
    });
    const ev = (cmd: string, user: string): SigmaEvent => ({ Cmd: cmd, User: user });
    expect(
      matchSigma(
        { ...base, selections: [sel("selection_a")], condition: { kind: "all-of-prefix", prefix: "selection", excludes: [] } },
        ev("run", "bob"),
      ),
    ).toBe(true);
    expect(
      matchSigma(
        {
          ...base,
          selections: [sel("selection_a"), sel("selection_b")],
          condition: { kind: "all-of-prefix", prefix: "selection", excludes: [] },
        },
        ev("run", "bob"),
      ),
    ).toBe(true);
    // الفلتر يطرح: نفس الحدث لكن مستخدم admin
    expect(
      matchSigma(
        {
          ...base,
          selections: [sel("selection_a"), filter("filter_main")],
          condition: {
            kind: "all-of-prefix",
            prefix: "selection",
            excludes: [{ kind: "any-of-prefix", prefix: "filter", minCount: null }],
          },
        },
        ev("run", "admin"),
      ),
    ).toBe(false);
    expect(
      matchSigma(
        {
          ...base,
          selections: [sel("selection_a"), filter("filter_main")],
          condition: {
            kind: "all-of-prefix",
            prefix: "selection",
            excludes: [{ kind: "any-of-prefix", prefix: "filter", minCount: null }],
          },
        },
        ev("run", "bob"),
      ),
    ).toBe(true);
  });

  it("every frozen Sigma rule is well-formed and never matches an empty event", () => {
    expect(SIGMA_RULES.length).toBeGreaterThanOrEqual(6);
    for (const r of SIGMA_RULES) {
      expect(r.id).toMatch(/^[\w-]+$/);
      expect(matchSigma(r as unknown as NormalizedSigmaRule, {})).toBe(false);
    }
  });
});
