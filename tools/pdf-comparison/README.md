# حصن مقارنة محركات PDF العربية (P5-027 — ADR-35)

نفس التقرير المرجعي العربي (العنوان + قضية + جملتان محالتان إلى دليلين) يُطبع
بالمحركات الثلاثة المتسابقة، والتحقق موحد (`verify.mjs`): استخراج النص
(قبل/بعد NFKC) وعدّ توضيحات الروابط الداخلية.

## التشغيل (من جذر المستودع — الخطوط في packages/reports/fonts)

```bash
# 1. Typst (CLI 0.10 عبر npm — التقرير المرجعي reference.typ)
cp packages/reports/fonts/NotoNaskhArabic-Regular.ttf packages/transforms/ocr/fonts/NotoSans-Regular.ttf tools/pdf-comparison/
npx typst compile tools/pdf-comparison/reference.typ /tmp/out-typst.pdf

# 2. Playwright/Chromium على قالب HTML المستودع نفسه
#    (ولّد report.html عبر renderReportHtml ثم):
node tools/pdf-comparison/playwright-print.mjs /tmp/report.html /tmp/out-playwright.pdf

# 3. React-PDF (نموذج أولي — react + @react-pdf/renderer منفصلان عن شجرة المستودع)
cd tools/pdf-comparison && npm i react @react-pdf/renderer && node react-pdf-prototype.mjs

# التحقق الموحد
node tools/pdf-comparison/verify.mjs /tmp/out-typst.pdf
node tools/pdf-comparison/verify.mjs /tmp/out-playwright.pdf
node tools/pdf-comparison/verify.mjs out-reactpdf.pdf
```

القياسات الكاملة والنتيجة المرئية (صور الصفحات الثلاث): `docs/evidence/2026-10-24-P5-027-pdf-comparison.md`.
