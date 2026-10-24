#!/usr/bin/env node
// مولد موقع التوثيق الثابت — P7-005
// الاستخدام: node scripts/docs-site/build.mjs [outDir=../site-dist]
// ينتج صفحات ثابتة بلا أي اعتماد خارجي (ADR-23: بلا تتبع).

import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { useCases, siteMeta } from "./content.mjs";

const outDir = process.argv[2] ?? new URL("../../site-dist/", import.meta.url).pathname;

function write(rel, content) {
  const p = join(outDir, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}

const css = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, "Segoe UI", Tahoma, sans-serif; line-height: 1.7; }
header { background: #16324f; color: #fff; padding: 1rem 1.5rem; }
header a { color: #9fd1ff; }
main { max-width: 860px; margin: 0 auto; padding: 1.5rem; }
h1 { font-size: 1.5rem; }
h2 { font-size: 1.15rem; border-bottom: 2px solid #d0dbe6; padding-bottom: .3rem; }
table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
th, td { border: 1px solid #c9d4de; padding: .45rem .6rem; text-align: start; vertical-align: top; }
th { background: #eef3f8; }
.badge { display: inline-block; background: #e6f0ea; color: #1d5c3d; border-radius: 999px; padding: 0 .7rem; font-size: .8rem; }
.uc-card { border: 1px solid #c9d4de; border-radius: 8px; padding: .8rem 1rem; margin: .8rem 0; }
.uc-card a { font-weight: 600; }
footer { border-top: 1px solid #c9d4de; margin-top: 2rem; padding: 1rem 1.5rem; font-size: .85rem; color: #55606b; }
.lang-switch { float: inline-end; }
`;

function esc(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "\u0026amp;",
        "<": "\u0026lt;",
        ">": "\u0026gt;",
        '"': "\u0026quot;",
        "'": "\u0026#39;",
      })[c],
  );
}

function layout({ lang, title, body }) {
  const meta = siteMeta[lang];
  const dir = lang === "ar" ? "rtl" : "ltr";
  return `<!doctype html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — ${esc(meta.title)}</title>
<style>${css}</style>
</head>
<body>
<header>
  <div><strong>${esc(meta.title)}</strong>
  <span class="lang-switch"><a href="${meta.otherLangHref}">${esc(meta.otherLang)}</a></span></div>
</header>
<main>
${body}
</main>
<footer>
  <a href="https://github.com/sovereignaie-star/investigation">GitHub</a> ·
  <a href="https://github.com/sovereignaie-star/investigation/blob/main/SECURITY.md">Security</a> ·
  AGPL-3.0
</footer>
</body>
</html>
`;
}

function ucCard(lang, uc) {
  return `<div class="uc-card">
  <a href="/${lang}/uc-${uc.id.slice(3)}.html">${esc(uc[lang].title)}</a>
  <span class="badge">${uc.id}</span>
  <div>${esc(uc[lang].goal)}</div>
</div>`;
}

function ucPage(lang, uc) {
  const f = uc[lang];
  const label = {
    ar: { goal: "الهدف", actors: "الشخصية", input: "المدخل", output: "المخرج", acceptance: "معيار القبول", phase: "المرحلة" },
    en: { goal: "Goal", actors: "Actors", input: "Input", output: "Output", acceptance: "Acceptance", phase: "Phase" },
  }[lang];
  const body = `
<h1>${esc(f.title)} <span class="badge">${uc.id}</span></h1>
<p>${esc(f.goal)}</p>
<table>
  <tr><th>${label.actors}</th><td>${esc(f.actors)}</td></tr>
  <tr><th>${label.input}</th><td>${esc(f.input)}</td></tr>
  <tr><th>${label.output}</th><td>${esc(f.output)}</td></tr>
  <tr><th>${label.acceptance}</th><td>${esc(f.acceptance)}</td></tr>
  <tr><th>${label.phase}</th><td>${uc.phase}</td></tr>
</table>
<p><a href="/${lang}/">← ${lang === "ar" ? "عودة إلى الفهرس" : "Back to index"}</a></p>`;
  write(`${lang}/uc-${uc.id.slice(3)}.html`, layout({ lang, title: `${uc.id} ${f.title}`, body }));
}

for (const lang of ["ar", "en"]) {
  // فهرس اللغة — language index
  const meta = siteMeta[lang];
  const byPhase = {};
  for (const uc of useCases) (byPhase[uc.phase] ??= []).push(uc);
  const intro = {
    ar: `منصة تحقيقات مفتوحة المصدر للفرق الصحفية والحقوقية والبحثية. القاعدة الأولى في المنصة: <strong>لا خطوة بلا دليل، ولا دليل بلا مصدر</strong>. يوثّق هذا الموقع كل حالات الاستخدام الـ24 ومعايير قبولها كما وردت في الخارطة (المرجع: <code>docs/ROADMAP.md</code> §3.3).`,
    en: `An open-source investigations platform for journalism, human-rights and research teams. The platform's first rule: <strong>no step without evidence, no evidence without a source</strong>. This site documents all 24 use cases and their acceptance criteria as defined in the roadmap (<code>docs/ROADMAP.md</code> §3.3).`,
  }[lang];
  const phaseTitle = { ar: (p) => `المرحلة ${p}`, en: (p) => `Phase ${p}` };
  let body = `<h1>${esc(meta.title)}</h1><p>${intro}</p>`;
  for (const phase of Object.keys(byPhase)
    .map(Number)
    .sort((a, b) => a - b)) {
    body += `<h2>${esc(phaseTitle[lang](phase))}</h2>`;
    for (const uc of byPhase[phase]) body += ucCard(lang, uc);
  }
  write(`${lang}/index.html`, layout({ lang, title: meta.tagline, body }));
  for (const uc of useCases) ucPage(lang, uc);
}

// صفحة اختيار اللغة — language chooser
write(
  "index.html",
  `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(siteMeta.en.title)}</title><style>${css}</style>
<meta http-equiv="refresh" content="0; url=/en/"></head>
<body><main>
<h1>${esc(siteMeta.en.title)}</h1>
<p><a href="/en/">English</a> · <a href="/ar/">العربية</a></p>
</main></body></html>
`,
);

// robots.txt — بلا فهرسة للنسخ؟ الموقع عام — allow all
write("robots.txt", "User-agent: *\nAllow: /\n");

console.log(`docs-site: generated ${useCases.length * 2} UC pages + indexes into ${outDir}`);
