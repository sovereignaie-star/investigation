import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";

test("T-DOC-001: مصدر محتوى الموقع يغطي كل حالات الاستخدام UC-01..UC-24 بالعربية والإنجليزية", async () => {
  assert.ok(existsSync("scripts/docs-site/content.mjs"), "ملف المحتوى مفقود");
  const { useCases } = await import("../docs-site/content.mjs");
  assert.ok(Array.isArray(useCases), "لا يوجد جدول useCases");
  assert.equal(useCases.length, 24, "يجب أن تكون 24 حالة استخدام");
  for (let i = 1; i <= 24; i++) {
    const id = `UC-${String(i).padStart(2, "0")}`;
    const uc = useCases.find((u) => u.id === id);
    assert.ok(uc, `${id} مفقودة`);
    for (const lang of ["ar", "en"]) {
      assert.ok(uc[lang], `${id} بلا محتوى ${lang}`);
      for (const f of ["title", "goal", "actors", "input", "output", "acceptance"]) {
        assert.ok(uc[lang][f] && uc[lang][f].trim(), `${id}/${lang}.${f} فارغ`);
      }
    }
  }
});

test("T-DOC-002: مولد الموقع ينتج كل صفحات UC باللغتين مع الفهرسة", () => {
  assert.ok(existsSync("scripts/docs-site/build.mjs"), "المولد مفقود");
  const out = "/tmp/docs-site-build-test";
  rmSync(out, { recursive: true, force: true });
  execFileSync(process.execPath, ["scripts/docs-site/build.mjs", out], { stdio: "inherit" });
  assert.ok(existsSync(`${out}/index.html`), "صفحة الفهرس مفقودة");
  assert.ok(existsSync(`${out}/ar/index.html`), "فهرس العربية مفقود");
  assert.ok(existsSync(`${out}/en/index.html`), "فهرس الإنجليزية مفقود");
  for (let i = 1; i <= 24; i++) {
    const id = `UC-${String(i).padStart(2, "0")}`;
    for (const lang of ["ar", "en"]) {
      const p = `${out}/${lang}/uc-${String(i).padStart(2, "0")}.html`;
      assert.ok(existsSync(p), `${p} مفقودة`);
      const html = readFileSync(p, "utf8");
      assert.ok(html.includes(id), `${p} لا تذكر ${id}`);
    }
  }
});

test("T-DOC-003: سير عمل النشر إلى GitHub Pages موجود ويستخدم مسار Pages الرسمي", () => {
  const y = readFileSync(".github/workflows/docs-site.yml", "utf8");
  assert.ok(y.includes("actions/configure-pages"), "configure-pages مفقود");
  assert.ok(y.includes("actions/upload-pages-artifact"), "upload-pages-artifact مفقود");
  assert.ok(y.includes("actions/deploy-pages"), "deploy-pages مفقود");
});

test("T-DOC-004: الصفحات العربية RTL والإنجليزية LTR", () => {
  const out = "/tmp/docs-site-build-test";
  const ar = readFileSync(`${out}/ar/uc-01.html`, "utf8");
  const en = readFileSync(`${out}/en/uc-01.html`, "utf8");
  assert.ok(ar.includes('lang="ar"') && ar.includes('dir="rtl"'), "الصفحة العربية ليست RTL");
  assert.ok(en.includes('lang="en"') && en.includes('dir="ltr"'), "الصفحة الإنجليزية ليست LTR");
});
