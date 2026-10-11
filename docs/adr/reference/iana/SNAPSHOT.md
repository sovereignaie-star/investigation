# سجل IANA المرجعي — نسخة محفوظة مؤرخة (2026-10-11)

## المصدر الرسمي
- IPv4 Special-Purpose Address Registry: https://www.iana.org/assignments/iana-ipv4-special-registry/iana-ipv4-special-registry-1.csv
- IPv6 Special-Purpose Address Registry: https://www.iana.org/assignments/iana-ipv6-special-registry/iana-ipv6-special-registry-1.csv

## تواريخ المصدر (من ترويسات HTTP للمصدر وقت الجلب)
- `last-modified` (IPv4): `Tue, 29 Sep 2026 00:49:13 GMT`
- `last-modified` (IPv6): `Tue, 29 Sep 2026 00:48:48 GMT`
- تاريخ الجلب: `Sun, 11 Oct 2026 01:57:47 GMT`

## البصمات (SHA-256 للملفات المحفوظة)
- `iana-ipv4-special-purpose-registry.csv`: `e3e39e76d00b1677335db8e9a805c7b9480ea2f4dc9e33f0b93cd3a905128d73`
- `iana-ipv6-special-purpose-registry.csv`: `775feea0621dec8735a44fbf30f762e721e8f0a1b3ab7eb341961a88cfce2139`

## الغرض
النسخ المحفوظة هنا هي المرجع المعتمد لاختبار `docs/adr/reference/iana/iana-registry.test.ts`:
- يتحقق الاختبار أن البصمة الحالية للملفات المحفوظة تطابق البصمات أعلاه (يكشف أي تعديل محلي للنسخة).
- يتحقق أن القواعد المستخدمة فعلياً في ADR-08 (القبول/الرفض) متسقة مع الأعمدة الرسمية `Globally Reachable` و`Forwardable` و`Reserved-by-Protocol` في النسخة المحفوظة.
- لا تعتبر البصمة وحدها إثباتاً لصحة التصنيف؛ الربط بالقواعد الفعلية هو الإثبات.
- **كيف يُكتشف الانحراف عن المصدر الرسمي:** أداة `scripts/reference/iana-drift.mjs` تقارن نسخة مصدر مجلوبة يدوياً بالنسخة المحفوظة وتُرجع خروجاً غير صفري عند الانحراف أو تعذّر التحقق (فشل مغلق)، واختباراتها في `scripts/reference/iana-drift.test.mjs` (`pnpm reference:test`، بلا شبكة). إعادة الجلب عملية يدوية موثّقة (لا تُنفَّذ في CI لتفادي الاعتماد على الشبكة في الاختبارات).
