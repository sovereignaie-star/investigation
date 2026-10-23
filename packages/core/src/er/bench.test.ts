import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * P4-023 — معيار دمج الكيانات (bench/er): يثبّت في CI الحكم المجمد للتقرير —
 * core/er لا يقل عن أفضل الأدوات القابلة للتشغيل بأكثر من نقطتين (0.02).
 * التقرير المجمد هو الملف (bench/er/report.json)؛ الأدوات تعاد يدوياً
 * بالسكربتات الموثقة في bench/er (لا شبكة ولا تثبيت وقت CI).
 */

interface BenchResult {
  tool: string;
  f1: number;
  [k: string]: unknown;
}
interface BenchReport {
  results: BenchResult[];
  zingg: { status: string; reason: string };
}

const report = JSON.parse(
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "bench", "er", "report.json"), "utf8"),
) as BenchReport;

describe("P4-023: معيار دمج الكيانات (bench/er)", () => {
  it("the frozen report is well-formed: runnable tools measured, zingg's exclusion declared", () => {
    expect(report.results.length).toBeGreaterThanOrEqual(2);
    for (const r of report.results) {
      expect(r.f1).toBeGreaterThanOrEqual(0);
      expect(r.f1).toBeLessThanOrEqual(1);
    }
    expect(report.zingg.status).toBe("not-runnable");
    expect(report.zingg.reason.length).toBeGreaterThan(10);
  });

  it("core/er is within 2 points (0.02) of the best runnable tool — the acceptance", () => {
    const core = report.results.find((r) => r.tool === "core/er");
    expect(core).toBeDefined();
    const others = report.results.filter((r) => r.tool !== "core/er");
    expect(others.length).toBeGreaterThan(0);
    const best = Math.max(...others.map((r) => r.f1));
    expect(core?.f1 ?? 0).toBeGreaterThanOrEqual(best - 0.02);
  });
});
