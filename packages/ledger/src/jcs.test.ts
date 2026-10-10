import { describe, expect, it } from "vitest";
import { canonicalize, JcsError } from "./jcs.ts";

describe("T-LED-009 JCS conformance (RFC 8785)", () => {
  it("3.2.2 sample: numbers, string escapes, literals", () => {
    const input = JSON.parse(
      '{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],"string":"\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/","literals":[null,true,false]}',
    );
    expect(canonicalize(input)).toBe(
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
    );
  });

  it("3.2.3 sorting by UTF-16 code units", () => {
    const input = {
      "\u20ac": "Euro Sign",
      "\r": "Carriage Return",
      "\ufb33": "Hebrew Letter Dalet With Dagesh",
      "1": "One",
      "\ud83d\ude00": "Emoji: Grinning Face",
      "\u0080": "Control",
      "\u00f6": "Latin Small Letter O With Diaeresis",
    };
    // re-parsing would reorder the integer-like key "1", so compare the serialized text itself
    const order = ["\r", "1", "\u0080", "\u00f6", "\u20ac", "\ud83d\ude00", "\ufb33"];
    const rec = input as Record<string, string>;
    expect(canonicalize(input)).toBe(`{${order.map((k) => `${JSON.stringify(k)}:${JSON.stringify(rec[k])}`).join(",")}}`);
  });

  it("Appendix B number serialization", () => {
    const cases: Array<[number, string]> = [
      [0, "0"],
      [-0, "0"],
      [5e-324, "5e-324"],
      [-5e-324, "-5e-324"],
      [1.7976931348623157e308, "1.7976931348623157e+308"],
      [9007199254740992, "9007199254740992"],
      [295147905179352830000, "295147905179352830000"],
      [9.999999999999997e22, "9.999999999999997e+22"],
      [1e23, "1e+23"],
      [0.000001, "0.000001"],
      [9.999999999999997e-7, "9.999999999999997e-7"],
      [333333333.3333333, "333333333.3333333"],
    ];
    for (const [n, s] of cases) expect(canonicalize(n)).toBe(s);
  });

  it("is independent of key order and whitespace, and keeps Arabic text as UTF-8", () => {
    const a = JSON.parse('{ "b": [1, {"y": 2, "x": 1}], "a": "مرحبا" }');
    const b = { a: "مرحبا", b: [1, { x: 1, y: 2 }] };
    expect(canonicalize(a)).toBe(canonicalize(b));
    expect(canonicalize(b)).toBe('{"a":"مرحبا","b":[1,{"x":1,"y":2}]}');
  });
});

describe("T-LED-010 (part 1) non-JSON values are rejected, not coerced", () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  const bad: Array<[string, unknown]> = [
    ["undefined member", { a: undefined }],
    ["undefined in array", [1, undefined]],
    ["NaN", Number.NaN],
    ["Infinity", { x: Infinity }],
    ["bigint", 1n],
    ["function", { f: () => 1 }],
    ["symbol", Symbol("s")],
    ["Date", new Date(0)],
    ["Map", new Map()],
    ["circular", circular],
    ["lone surrogate", "\ud800"],
    ["lone surrogate key", { "\udc00": 1 }],
  ];
  for (const [name, v] of bad) it(name, () => expect(() => canonicalize(v)).toThrow(JcsError));
});
