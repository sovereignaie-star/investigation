import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isRegistrableHost, publicSuffix, registrableDomain } from "./index.ts";

/** The official PSL test file (tests/test_psl.txt in publicsuffix/list), parsed line by line. */
const cases = readFileSync(path.join(import.meta.dirname, "test_psl.txt"), "utf8")
  .split("\n")
  .map((l) => /^checkPublicSuffix\((null|'[^']*'), (null|'[^']*')\);/.exec(l.trim()))
  .filter((m): m is RegExpExecArray => m !== null)
  .map((m) => [m[1] === "null" ? null : (m[1] ?? "").slice(1, -1), m[2] === "null" ? null : (m[2] ?? "").slice(1, -1)] as const);

describe("Public Suffix List", () => {
  it("passes every case of the official test_psl.txt", () => {
    expect(cases.length).toBeGreaterThan(70);
    for (const [input, expected] of cases) expect(registrableDomain(input), String(input)).toBe(expected);
  });
  it("public suffix and host validity", () => {
    expect(publicSuffix("a.b.example.co.uk")).toBe("co.uk");
    expect(publicSuffix("user.github.io")).toBe("github.io");
    expect(registrableDomain("user.github.io")).toBe("user.github.io");
    expect(isRegistrableHost("www.example.com")).toBe(true);
    expect(isRegistrableHost("-bad.example.com")).toBe(false);
    expect(isRegistrableHost("com")).toBe(false);
    expect(isRegistrableHost(`${"a".repeat(64)}.com`)).toBe(false);
  });
});
