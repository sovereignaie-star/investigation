#!/usr/bin/env node
/**
 * P5-024 — توليد مجموعة OCR المرجعية (حتمية).
 *
 * يقرأ `packages/transforms/fixtures/ocr/ground-truth.json` ويصيّر كل نص
 * إلى صورة PNG عبر resvg بالخطوط المضمّنة (بلا خطوط نظام — حتمية عبر
 * البيئات). المرجع «نص مطبوع اصطناعياً»: محرك الرسم (resvg) مستقل تماماً
 * عن محرك التعرف (Tesseract)، والنص الأصلي معروف بالبناء.
 *
 * الاستخدام: node tools/ocr/render-reference.mjs [--check]
 * --check: يعيد التصيير في الذاكرة ويتحقق أن الملفات الموجودة مطابقة
 *          بايتاً-بايتاً (يمنع انجراف المجموعة المرجعية).
 */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
const fixturesDir = join(repo, "packages", "transforms", "fixtures", "ocr");
const require = createRequire(join(repo, "packages", "reports", "package.json"));
const { Resvg } = require("@resvg/resvg-js");

const AR_FONT = join(repo, "packages", "transforms", "ocr", "fonts", "NotoNaskhArabic-Regular.ttf");
const EN_FONT = join(repo, "packages", "transforms", "ocr", "fonts", "NotoSans-Regular.ttf");

const SIZE = 36;

/** تصيير حتمي: كل سطر عنصر text مستقل، والعرض محسوب من أطول سطر. */
function render(text, fontFile) {
  const lines = text.split("\n");
  const lineH = Math.round(SIZE * 1.9);
  const maxChars = Math.max(...lines.map((l) => l.length));
  const width = Math.ceil(maxChars * SIZE * 0.62) + 80;
  const height = lines.length * lineH + 60;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#ffffff"/>`,
  ];
  lines.forEach((line, i) => {
    const y = 40 + i * lineH + Math.round(SIZE * 0.8);
    parts.push(`<text x="${width / 2}" y="${y}" text-anchor="middle" font-family="f" font-size="${SIZE}" fill="#000000">${line}</text>`);
  });
  parts.push("</svg>");
  const resvg = new Resvg(parts.join("\n"), { font: { fontFiles: [fontFile], loadSystemFonts: false } });
  return Buffer.from(resvg.render().asPng());
}

const gt = JSON.parse(readFileSync(join(fixturesDir, "ground-truth.json"), "utf8"));
let drift = false;
for (const [lang, entries] of Object.entries(gt)) {
  const fontFile = lang === "ar" ? AR_FONT : EN_FONT;
  for (const entry of entries) {
    const png = render(entry.text, fontFile);
    const out = join(fixturesDir, entry.file);
    if (process.argv.includes("--check")) {
      const existing = existsSync(out) ? readFileSync(out) : null;
      if (existing === null || !existing.equals(png)) {
        drift = true;
        console.error(`DRIFT: ${entry.file} (غير موجود أو غير مطابق للتصيير الحتمي)`);
      }
    } else {
      writeFileSync(out, png);
      console.log(`rendered ${entry.file} (${png.length} bytes)`);
    }
  }
}
if (process.argv.includes("--check")) {
  if (drift) process.exit(1);
  console.log("reference set is deterministic (no drift)");
}
