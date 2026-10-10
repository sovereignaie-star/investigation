# ADR-22: الخطافات في `.githooks` بلا Husky

| البند | القيمة |
|---|---|
| الحالة | مُقرّر بتفويض |
| التاريخ | 2026-10-10 |
| المرجع | `docs/ROADMAP.md` 5.20 |

## السياق

الخطة الشاملة اقترحت Husky وlint-staged وcommitlint (C-16)، بينما الحوكمة تعمل فعلاً بخطافات git أصلية عبر `core.hooksPath`.

## القرار

نبقي `.githooks` (تُفعَّل بسكربت `prepare`)، ونضيف معها في P0-022: lint-staged داخل `pre-commit`، وفحص صيغة Conventional Commits داخل حارس الحوكمة بدل commitlint. نُفّذ في P0-022 (2026-10-10): `CONVENTIONAL_RE` في `scripts/governance/check.mjs` (T-GOV-013/014)، وlint-staged في `.githooks/pre-commit`.

## البدائل

Husky (اعتمادية إضافية لما نملكه)؛ commitlint (ازدواج مع الحارس).

## العواقب

اعتماديات أقل ومصدر واحد لفحص الإيداعات.
