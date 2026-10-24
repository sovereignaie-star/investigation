/**
 * P6-015: legal documents guard (T-LEGAL-001..003).
 *
 * The privacy policy, terms of use and abuse-report channel must be published
 * in Arabic AND English (acceptance: منشورة بالعربية والإنجليزية، ومراجَعة
 * في P7-008), and the web UI must expose them on a legal page.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

const DOCS = {
  "privacy-policy": {
    sections: {
      ar: ["ما نعالجه", "أين تبقى البيانات", "من يصل إلى البيانات", "حقوقك", "الاتصال"],
      en: ["What we process", "Where your data stays", "Who can reach your data", "Your rights", "Contact"],
    },
  },
  "terms-of-use": {
    sections: {
      ar: ["الاستخدام المسموح", "مسؤوليتك", "المصادر الخارجية", "عدم الضمان", "المراجعة القانونية"],
      en: ["Permitted use", "Your responsibility", "External sources", "No warranty", "Legal review"],
    },
  },
  "abuse-report": {
    sections: {
      ar: ["قناة الإبلاغ", "ما يجب أن يتضمنه البلاغ", "الاستجابة"],
      en: ["Reporting channel", "What a report should include", "Response"],
    },
  },
};

function readDoc(name, lang) {
  const p = join(root, `docs/legal/${name}.${lang}.md`);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}

test("T-LEGAL-001: الوثائق القانونية الثلاث موجودة وموقعة بالعربية والإنجليزية", () => {
  for (const [name, req] of Object.entries(DOCS)) {
    for (const lang of ["ar", "en"]) {
      const md = readDoc(name, lang);
      assert.ok(md !== null, `docs/legal/${name}.${lang}.md غير موجودة`);
      assert.ok(md.includes("P6-015"), `${name}.${lang}: يحمل معرف المهمة P6-015`);
      assert.ok(md.includes("2026-10-24"), `${name}.${lang}: يحمل تاريخ التوقيع`);
      for (const section of req.sections[lang]) {
        assert.ok(md.includes(section), `${name}.${lang}: القسم «${section}» مفقود`);
      }
    }
  }
});

test("T-LEGAL-002: كل وثيقة تحمل شعار المراجعة القانونية المستقلة (P7-008)", () => {
  for (const name of Object.keys(DOCS)) {
    for (const lang of ["ar", "en"]) {
      const md = readDoc(name, lang);
      assert.ok(md.includes("P7-008"), `${name}.${lang}: لا يذكر المراجعة القانونية P7-008`);
    }
  }
});

test("T-LEGAL-003: الواجهة تعرض صفحة قانونية بمسار /legal وبلغتيها", () => {
  const page = join(root, "apps/web/src/pages/LegalPage.tsx");
  assert.ok(existsSync(page), "apps/web/src/pages/LegalPage.tsx غير موجودة");
  const pageText = readFileSync(page, "utf8");
  assert.ok(/privacy|خصوصية/i.test(pageText), "الصفحة لا تعرض سياسة الخصوصية");
  const app = readFileSync(join(root, "apps/web/src/App.tsx"), "utf8");
  assert.ok(app.includes('"/legal"'), "المسار /legal غير مربوط في App.tsx");
  const ar = readFileSync(join(root, "packages/i18n/src/ar.ts"), "utf8");
  const en = readFileSync(join(root, "packages/i18n/src/en.ts"), "utf8");
  assert.ok(/legal\./.test(ar) && /legal\./.test(en), "مفاتيح legal.* غير موجودة في القاموسين");
});
