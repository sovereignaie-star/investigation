// P5-027 — النموذج الأولي: التقرير المرجعي بمحرك Chromium (Playwright) على قالب HTML
// يعمل بـ: node playwright-print.mjs report.html out-playwright.pdf
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";

const [, , htmlPath, outPath] = process.argv;
if (!htmlPath || !outPath) throw new Error("usage: node playwright-print.mjs <report.html> <out.pdf>");
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(await readFile(htmlPath, "utf8"), { waitUntil: "load" });
await page.pdf({ path: outPath, format: "A4" });
await browser.close();
console.log("done");
