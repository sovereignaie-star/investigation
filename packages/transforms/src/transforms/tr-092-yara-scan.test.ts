import { describe, expect, it } from "vitest";
import { yaraScan } from "./tr-092-yara-scan.ts";

/**
 * P4-021 — TR-092: YARA scan of an uploaded file (local LC-A; static byte
 * matching, NOTHING is ever executed; the frozen YARA Forge rules are bundled).
 * Every match is a finding whose evidence is the INPUT FILE itself
 * (derivedFrom "input") — "كل تطابق ملاحظة بدليل".
 */

const B64 = (s: string): string => Buffer.from(s, "utf8").toString("base64");

describe("TR-092 — YARA scan (فحص داخل العزل، لا تنفيذ لأي ملف)", () => {
  it("matches the frozen rules against crafted content and emits findings bound to the input", async () => {
    const out = await yaraScan.run({ content: B64('String cmd = Runtime.getRuntime().exec(request.getParameter("c"));') }, ctxOf());
    expect(out.findings).toHaveLength(1);
    const f = out.findings[0];
    expect(f).toMatchObject({
      predicate: "yara_match",
      objectType: "yara_rule",
      objectValue: "VOLEXITY_Susp_Jsp_General_Runtime_Exec_Req",
    });
    expect(f.derivedFrom).toBe("input");
    expect(f.explanation).toContain("Runtime.getRuntime");
    expect(f.confidence).toBeGreaterThan(0);
  });

  it("no match on innocent content — no invented findings", async () => {
    const out = await yaraScan.run({ content: B64("just a readme file, nothing suspicious") }, ctxOf());
    expect(out.findings).toEqual([]);
  });

  it("refuses empty or non-base64 input — fail-closed", async () => {
    await expect(yaraScan.run({ content: "" }, ctxOf())).rejects.toThrow();
    await expect(yaraScan.run({ content: "ليست base64!!" }, ctxOf())).rejects.toThrow();
  });

  it("the manifest is local (public, empty allow list) and LC-A", () => {
    expect(yaraScan.manifest.license).toBe("LC-A");
    expect(yaraScan.manifest.network).toMatchObject({ mode: "public", allow: [] });
    expect(yaraScan.manifest.inputs).toContain("file_content");
  });
});

function ctxOf(): never {
  return { manifest: yaraScan.manifest } as never;
}
