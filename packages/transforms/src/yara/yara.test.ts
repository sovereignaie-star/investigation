import { describe, expect, it } from "vitest";

import { parseYaraRule, scanYara, YaraSubsetError } from "./yara.ts";
import { YARA_FORGE_RULES } from "./rules.generated.ts";

/**
 * P4-021 — the YARA subset engine. Rules are frozen RAW from the official YARA
 * Forge core pack (release 20261018); the parser must parse every one (below) —
 * a rule using syntax outside the documented subset fails LOUDLY (a typed
 * refusal), never silently mis-evaluates. Scanning is STATIC byte matching:
 * nothing is ever executed (PB-07's rule, extended to whole files).
 */

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

describe("P4-021 — YARA subset parser", () => {
  it("parses a text-string rule with modifiers and a simple condition", () => {
    const rule = parseYaraRule(
      'rule Test_Rule {\n\tmeta:\n\t\tdescription = "test"\n\tstrings:\n\t\t$s1 = "hello" ascii nocase\n\tcondition:\n\t\t$s1\n}',
    );
    expect(rule.name).toBe("Test_Rule");
    expect(rule.meta.description).toBe("test");
    expect(rule.strings).toHaveLength(1);
    expect(rule.strings[0]).toMatchObject({ id: "s1", kind: "text", value: "hello", modifiers: ["ascii", "nocase"] });
  });

  it("parses hex strings with ?? wildcards, multi-line", () => {
    const rule = parseYaraRule(
      "rule Hex_Rule {\n\tstrings:\n\t\t$h = {\n            48 8d 0d ?? ?? ?? ??\n            51 5a\n        }\n\tcondition:\n\t\t$h\n}",
    );
    expect(rule.strings[0]).toMatchObject({ kind: "hex", bytes: [0x48, 0x8d, 0x0d, null, null, null, null, 0x51, 0x5a] });
  });

  it("parses the documented condition grammar: and/or/not, filesize, uint, of them, at", () => {
    const base = (cond: string) => `rule C {\n\tstrings:\n\t\t$a = "x"\n\t\t$b = "y"\n\tcondition:\n\t\t${cond}\n}`;
    expect(() => parseYaraRule(base("filesize < 100KB and any of them"))).not.toThrow();
    expect(() => parseYaraRule(base("uint16(0) == 0x5A4D or uint32be(0) == 0x464c457f"))).not.toThrow();
    expect(() => parseYaraRule(base("all of them and not $b"))).not.toThrow();
    expect(() => parseYaraRule(base("2 of them and $a at 4"))).not.toThrow();
    expect(() => parseYaraRule(base("$a and filesize > 2MB"))).not.toThrow();
  });

  it("refuses syntax outside the documented subset — fail-closed, never guessed", () => {
    expect(() => parseYaraRule('rule X {\n\tstrings:\n\t\t$a = "x"\n\tcondition:\n\t\tpe.is_pe()\n}')).toThrow(YaraSubsetError);
    expect(() => parseYaraRule("rule X {\n\tstrings:\n\t\t$a = /regex/\n\tcondition:\n\t\t$a\n}")).toThrow(YaraSubsetError);
    expect(() => parseYaraRule("rule X {\n\tstrings:\n\t\t$a = { 01 [5] 02 }\n\tcondition:\n\t\t$a\n}")).toThrow(YaraSubsetError);
    expect(() => parseYaraRule('rule X {\n\tstrings:\n\t\t$a = "x" xor\n\tcondition:\n\t\t$a\n}')).toThrow(YaraSubsetError);
    expect(() => parseYaraRule("rule X {\n\tcondition:\n\t\ttrue\n}")).toThrow(YaraSubsetError); // لا strings إطلاقاً — قاعدة بلا دلالة
  });

  it("every frozen YARA Forge rule parses — the frozen set never outlives the engine", () => {
    expect(YARA_FORGE_RULES.length).toBeGreaterThanOrEqual(20);
    for (const r of YARA_FORGE_RULES) {
      const rule = parseYaraRule(r.text);
      expect(rule.name).toBe(r.name);
    }
  });
});

describe("P4-021 — YARA scanning (static byte matching, nothing executed)", () => {
  it("text strings match (ascii, nocase, wide, fullword)", () => {
    const mk = (value: string, mods: string) => `rule M {\n\tstrings:\n\t\t$a = "${value}" ${mods}\n\tcondition:\n\t\t$a\n}`;
    const scan = (rule: string, data: string) => scanYara([parseYaraRule(rule)], enc(data)).map((m) => m.ruleName);
    expect(scan(mk("Hello", "ascii"), "xx hello yy")).toEqual([]); // ascii بلا nocase: حالة الأحرف حرفية
    expect(scan(mk("Hello", "ascii nocase"), "xx hello yy")).toEqual(["M"]);
    expect(scan(mk("hello", "wide"), "xx\x00h\x00e\x00l\x00l\x00o\x00yy")).toEqual(["M"]); // UTF-16LE
    expect(scan(mk("hello", "ascii fullword"), "xx hello yy")).toEqual(["M"]);
    expect(scan(mk("hello", "ascii fullword"), "xxhello yy")).toEqual([]);
  });

  it("hex strings with ?? wildcards match and exact bytes reject mismatches", () => {
    const rule = parseYaraRule("rule H {\n\tstrings:\n\t\t$h = { 48 8D ?? ?? 51 }\n\tcondition:\n\t\t$h\n}");
    const matches = (data: number[]) => scanYara([rule], new Uint8Array(data)).map((m) => m.ruleName);
    expect(matches([0x48, 0x8d, 0x00, 0x11, 0x51])).toEqual(["H"]);
    expect(matches([0x48, 0x8d, 0x00, 0x11, 0x52])).toEqual([]);
  });

  it("conditions are evaluated: filesize, uint magic, of them, at, and/or/not", () => {
    const wrap = (cond: string, strings: string) => `rule W {\n\tstrings:\n${strings}\n\tcondition:\n\t\t${cond}\n}`;
    const mz = new Uint8Array([0x4d, 0x5b, 0x90, 0x00, 0x03, 0x00]); // ليست MZ (5B لا 5A)
    const mzX = new Uint8Array([0x4d, 0x5a, 0x78]); // MZ فعلية
    const size3 = new Uint8Array(3);
    // filesize: شرط حجم الملف يقيّم على حجم البيانات الفعلية
    const fs = parseYaraRule(wrap("filesize < 4", '\t\t$a = "x"'));
    expect(scanYara([fs], size3)).toHaveLength(1); // 3 بايتات < 4
    const fsBig = parseYaraRule(wrap("filesize < 2", '\t\t$a = "x"'));
    expect(scanYara([fsBig], size3)).toHaveLength(0); // 3 بايتات ليست < 2
    // uint16 MZ magic
    const uint = parseYaraRule(wrap("uint16(0) == 0x5A4D", '\t\t$a = "x"'));
    expect(scanYara([uint], mz)).toHaveLength(0);
    expect(scanYara([uint], mzX)).toHaveLength(1);
    // any/all of them
    const any = parseYaraRule(wrap("any of them", '\t\t$a = "x"\n\t\t$b = "y"'));
    expect(scanYara([any], enc("has x inside"))).toHaveLength(1);
    const all = parseYaraRule(wrap("all of them", '\t\t$a = "x"\n\t\t$b = "y"'));
    expect(scanYara([all], enc("has x inside"))).toHaveLength(0);
    expect(scanYara([all], enc("has x and y"))).toHaveLength(1);
    // N of them
    const two = parseYaraRule(wrap("2 of them", '\t\t$a = "x"\n\t\t$b = "y"\n\t\t$c = "z"'));
    expect(scanYara([two], enc("x y"))).toHaveLength(1);
    expect(scanYara([two], enc("x"))).toHaveLength(0);
    // at offset
    const at = parseYaraRule(wrap("$a at 2", '\t\t$a = "x"'));
    expect(scanYara([at], enc("abxcd"))).toHaveLength(1);
    expect(scanYara([at], enc("ax"))).toHaveLength(0);
    // not
    const not = parseYaraRule(wrap("not $a", '\t\t$a = "x"'));
    expect(scanYara([not], enc("plain"))).toHaveLength(1);
  });

  it("a frozen YARA Forge rule matches a file crafted from its own string (static match, evidence-bearing)", () => {
    const rule = parseYaraRule(YARA_FORGE_RULES[2]?.text ?? "");
    // VOLEXITY_Susp_Jsp_General_Runtime_Exec_Req: $s1 = "Runtime.getRuntime().exec(request." ascii
    const matches = scanYara([rule], enc('String cmd = Runtime.getRuntime().exec(request.getParameter("c"));'));
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ ruleName: "VOLEXITY_Susp_Jsp_General_Runtime_Exec_Req" });
    // والتطابق يحمل ما يلزم الملاحظة: اسم القاعدة وعدد الإصابات
    expect(matches[0]?.matches.length).toBe(1);
  });

  it("no match on unrelated data — no invention", () => {
    const rules = YARA_FORGE_RULES.slice(0, 5).map((r) => parseYaraRule(r.text));
    expect(scanYara(rules, enc("an innocent text file with no indicators at all"))).toEqual([]);
  });
});
