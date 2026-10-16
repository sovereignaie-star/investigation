# دليل المساهمة

شكراً لاهتمامك. هذا المشروع محكوم بقواعد مفروضة آلياً؛ اقرأ [`GOVERNANCE.md`](GOVERNANCE.md) أولاً. الوكلاء الآليون يتبعون أيضاً [`AGENTS.md`](AGENTS.md).

## قبل أن تبدأ

1. اختر مهمة من [`docs/ROADMAP.md`](docs/ROADMAP.md) حالتها `todo` في [`docs/STATUS.md`](docs/STATUS.md) واعتمادياتها منجزة. العمل غير المربوط بمهمة يبدأ بإضافة مهمة إلى الخارطة (GR-02).
2. أنشئ فرعاً: `feat/P1-003-identifier-yaml` (النوع، ثم المعرّف، ثم وصف قصير).
3. ثبّت الاعتماديات بـ `pnpm install --frozen-lockfile`؛ هذا يفعّل خطافات `.githooks`.

## كل إيداع

- رسالة بصيغة [Conventional Commits](https://www.conventionalcommits.org/) وتحمل معرّف المهمة: `fix(core): repair identifier list [P0-004]`.
- يعدّل `docs/STATUS.md` (عبر `node scripts/governance/set-status.mjs`) ويضيف إدخالاً إلى `docs/WORKLOG.md` **في الإيداع نفسه** (GR-01).
- لا أسرار ولا ملفات `.env` (GR-12).
- إعداد البيئة: [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).
- تحقق محلياً: `pnpm run lint`، `pnpm run typecheck`، `pnpm test`، `pnpm run governance`. خطاف `pre-commit` يشغّل ESLint وPrettier على الملفات المُودَعة فقط (lint-staged)، فيُطبَّق التنسيق تدريجياً على ما تلمسه دون إعادة تنسيق المستودع كله.
- السطر الأول من رسالة الإيداع بصيغة Conventional Commits: `type(scope): ملخص [P0-004]` (GR-03، ADR-22)، ويرفضه الحارس إن خالفها.

## طلب الدمج

- املأ قالب الـ PR بما فيه قائمة الحوكمة.
- الفحوص المطلوبة: `governance` و`build` و`test`. لا دمج قبل أن تخضر.
- الدمج squash (تاريخ خطي، إيداع دمج واحد لكل PR يحمل رقم المهمة في رسالته). كانت هذه الوثيقة تنص على rebase والممارسة التشغيلية المعتمدة منذ أول دمج في المشروع squash — حُددت الوثيقة لمطابقة الممارسة (L-15 في DECLARED_LIMITS).
- تعريف الإنجاز في الخارطة 12.1 يجب أن يُستوفى قبل تحويل المهمة إلى `done`.

## مصادر وأدوات جديدة

أي مصدر بيانات أو أداة جديدة تمر بخط الاعتماد في الخارطة 7.2 وتُسجَّل في الكتالوج (GR-10)، وتحترم الحدود الأخلاقية 3.5.

## الترخيص

بمساهمتك توافق على ترخيص مساهمتك بـ `AGPL-3.0-or-later`، وتؤكد أن لك الحق في ذلك.
