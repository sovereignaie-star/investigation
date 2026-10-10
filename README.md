# غرفة التحقيق — Investigation Room

منصة تحقيقات رقمية مفتوحة المصدر (OSINT) تحوّل معرّفاً واحداً (نطاق، عنوان IP، بريد، اسم مستخدم، محفظة، ملف...) إلى رسم ارتباطات قابل للتدقيق، بسجل أدلة غير قابل للتعديل، وبواجهة عربية أولاً.

> **الحالة:** قيد التطوير، المرحلة 0 (التثبيت والتأسيس). لا إصدار بعد. الحالة الحية في [`docs/STATUS.md`](docs/STATUS.md).

## الوثائق الحاكمة

| الوثيقة | الدور |
|---|---|
| [`GOVERNANCE.md`](GOVERNANCE.md) | القواعد الملزمة لكل مساهم، بشراً أو وكلاء آليين |
| [`AGENTS.md`](AGENTS.md) | تعليمات الوكلاء الآليين |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | خارطة الطريق: النطاق، المعمارية، المهام، معايير القبول، البوابات |
| [`docs/MASTER_PLAN.md`](docs/MASTER_PLAN.md) | الخطة الشاملة: الرؤية والاستراتيجية والآفاق البعيدة |
| [`docs/STATUS.md`](docs/STATUS.md) | الحالة الحية لكل مهمة وعيب وبوابة |
| [`docs/WORKLOG.md`](docs/WORKLOG.md) | سجل العمل: ما تم، بأدلته |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | مدخل مختصر إلى المعمارية (يحيل إلى القسم 5 وسجلات القرار) |
| [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) | دليل التطوير والتشغيل المحلي |
| [`docs/tools/`](docs/tools/) | كتالوج الأدوات والمصادر (10,834 أداة) |

## القاعدة الأولى

**لا إيداع ولا دفع إلا مع تحديث وثائق المشروع بما تم، في الإيداع نفسه**: كل إيداع يعدّل `docs/STATUS.md` ويضيف إدخالاً إلى `docs/WORKLOG.md`، ويحمل معرّف مهمة من الخارطة مثل `[P0-008]`. مفروضة بخطافات git وبفحص CI وبحماية الفرع `main`. التفاصيل في [`GOVERNANCE.md`](GOVERNANCE.md).

## التشغيل محلياً

المتطلبات: Node 24 (انظر `.nvmrc`) وpnpm 10 (مثبّت في `packageManager`).

```sh
pnpm install --frozen-lockfile   # يفعّل خطافات الحوكمة تلقائياً
pnpm run lint
pnpm run typecheck
pnpm test
PORT=22124 BASE_PATH=/ pnpm run build
PORT=5173 BASE_PATH=/ pnpm --filter @workspace/investigation-room run dev
```

متغيرات البيئة موثقة في [`.env.example`](.env.example). قاعدة البيانات اختيارية في هذه المرحلة؛ بدون `DATABASE_URL` يعمل كل شيء عدا مسارات الخادم التي تحتاجها.

## المساهمة والأمن والسلوك

- [`CONTRIBUTING.md`](CONTRIBUTING.md): دورة العمل، الإيداعات، طلبات الدمج.
- [`SECURITY.md`](SECURITY.md): الإبلاغ الخاص عن الثغرات.
- [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md): قواعد السلوك.
- الحدود الأخلاقية للأداة (ما لا تفعله أبداً) في الخارطة القسم 3.5.

## الترخيص

[GNU Affero General Public License v3.0 أو أحدث](LICENSE) (`AGPL-3.0-or-later`)، بحسب القرار ADR-10 في الخارطة.

---

## English summary

Investigation Room is an Arabic-first, open-source OSINT investigation platform that turns a single identifier into an auditable link graph backed by a tamper-evident evidence ledger. Status: pre-release (phase 0). Every commit must update `docs/STATUS.md` and `docs/WORKLOG.md` and reference a roadmap task ID; see `GOVERNANCE.md`. Licensed under AGPL-3.0-or-later.
