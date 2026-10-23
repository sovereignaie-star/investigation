# P5-024 — أصول OCR المحلية (إشعارات المصدر والرخص)

كل الأصول في هذا الدليل محلية مضمّنة في المستودع — لا تنزيل وقت تشغيل إطلاقاً (LC-A).

## tessdata (نماذج لغة Tesseract)

- **المصدر:** https://github.com/tesseract-ocr/tessdata_fast (فرع `main`، تنزيل 2026-10-23)
- **الرخصة:** Apache-2.0 (راجع https://github.com/tesseract-ocr/tessdata_fast/blob/main/LICENSE)
- **الملفات:**
  - `tessdata/ara.traineddata.gz` — sha256 `e3206d3dc87fd50c24a0fb9f01838615911d25168f4e64415244b67d2bb3e729` (الأصل `ara.traineddata` 1,432,056 بايت)
  - `tessdata/eng.traineddata.gz` — sha256 `7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2` (الأصل `eng.traineddata` 4,113,088 بايت)

## المحرك

- **tesseract.js** (npm، رخصة Apache-2.0) — غلاف WASM يعمل محلياً في Node (worker thread + نواة `tesseract.js-core` من npm) — لا طلبات شبكة عند ضبط `langPath` على هذا الدليل.

## خط الرسم المرجعي

- `fonts/NotoSans-Regular.ttf` — رخصة OFL (راجع `fonts/NotoSans-OFL.txt`)، مصدر notofonts.
- خط الرسم العربي (Noto Naskh Arabic) مستعار من `packages/reports/fonts/` (OFL).
