# دليل التطوير

تشغيل «غرفة التحقيق» محلياً من نسخة نظيفة في أقل من 10 دقائق (P0-023). القواعد الحاكمة في [`GOVERNANCE.md`](../GOVERNANCE.md)، والخارطة في [`ROADMAP.md`](ROADMAP.md).

## المتطلبات

| الأداة | النسخة | ملاحظة |
|---|---|---|
| Node.js | 24 (`.nvmrc`) | النسخ الأقدم تعمل مع تحذير `Unsupported engine` لكنها غير مدعومة |
| pnpm | 10 (`packageManager` في `package.json`) | `corepack enable` أو `npm i -g pnpm@10` |
| git | أي نسخة حديثة | الخطافات في `.githooks` تُفعَّل تلقائياً بـ `pnpm install` |
| Python 3 | اختياري | لإعادة بناء كتالوج الأدوات فقط (`tools/catalog/build.py`) |

لا تحتاج قاعدة بيانات: النمط الفردي يعمل بلا Postgres (ADR-04). `DATABASE_URL` مطلوب لنمط الفريق فقط.

## التشغيل

```sh
git clone https://github.com/sovereignaie-star/investigation.git
cd investigation
pnpm install --frozen-lockfile      # يفعّل خطافات الحوكمة (core.hooksPath=.githooks)
pnpm run lint
pnpm run typecheck
pnpm run build
pnpm test
pnpm --filter @ir/server run dev   # الخادم: http://localhost:8080/api/healthz
pnpm --filter @ir/web run dev      # الواجهة: http://localhost:5173 (تحوّل /api إلى الخادم)
pnpm start                         # بعد البناء: خدمة واحدة على http://localhost:8080
```

النشر (Docker، Render، Railway، جهاز محلي) موثق في `README.md` قسم «النشر».

التحقق من سلامة قضية (P1-012):

```sh
pnpm ir verify path/to/case --key installation.pub --checkpoint checkpoint.json   # أو --json
pnpm ir project path/to/case [--at seq] [--expect sha256]   # إعادة بناء الرسم والجدول والتغطية من السجل دون شبكة
node packages/cli/dist/ir.mjs verify path/to/case                                # بعد البناء، بلا node_modules
```

انسخ `.env.example` إلى `.env` إن احتجت متغيرات (لا تُودِع `.env` أبداً، GR-12). مفاتيح مزودي البيانات لا توضع في `.env` بل في خزنة المفاتيح المشفرة (P1-015).

## ما يحدث عند الإيداع

| المرحلة | ما يُفحص | المصدر |
|---|---|---|
| `pre-commit` | `docs/STATUS.md` و`docs/WORKLOG.md` ضمن الإيداع؛ لا ملفات `.env`؛ ESLint وPrettier على الملفات المُودَعة (lint-staged) | `.githooks/pre-commit` |
| `commit-msg` | معرّف مهمة موجود في الخارطة، صيغة Conventional Commits، إدخال WORKLOG يذكر المهمة، WORKLOG إضافة فقط | `scripts/governance/check.mjs` |
| CI | lint، typecheck، build، test، الحوكمة، CodeQL، gitleaks | `.github/workflows/` |

حدّث حالة المهمة بـ `node scripts/governance/set-status.mjs P0-023 done "الدليل"` ثم أضف إدخال WORKLOG بيدك في الإيداع نفسه.

## أوامر مفيدة

| الأمر | الغرض |
|---|---|
| `pnpm run audit:measure` | يعيد قياس جدول 1.2 على الشجرة الحالية (P0-019) |
| `pnpm run governance` | فحص آخر إيداع واتساق ROADMAP وSTATUS وMASTER_PLAN |
| `node scripts/governance/check.mjs --range origin/main..HEAD` | فحص كل إيداعات الفرع قبل الدفع |
| `python3 tools/catalog/build.py --add-curated` | دمج `tools/catalog/curated.json` في الكتالوج دون إعادة الجلب |

## القياس المسجّل

نسخة نظيفة من الفرع في 2026-10-10، مخزن pnpm فارغ، بيئة Linux بـ Node 20.20.2 [مُقاس]:

| الخطوة | الزمن | النتيجة |
|---|---|---|
| `pnpm install --frozen-lockfile` | 113 ث | ينجح |
| `pnpm run lint` | 4 ث | ينجح |
| `pnpm run typecheck` | 13 ث | ينجح |
| `pnpm run build` | 11 ث | ينجح |
| `pnpm test` | 2 ث | 8 ناجحة |
| `dev` للواجهة | نحو 10 ث | HTTP 200 |
| الخادم `/api/healthz` | نحو 3 ث | `{"status":"ok"}` |
| **المجموع من الاستنساخ** | **158 ث** | أقل من 10 دقائق |

يُعاد هذا القياس على Node 24 في CI (وظيفتا `build` و`test`).

## فهرس المعرّفات (P1-003)

- البيانات: `packages/core/identifiers/<category>.yaml`، نوع لكل مدخل بالمخطط `IdentifierSpec` (`@ir/schema`).
- بعد أي تعديل: `pnpm --filter @ir/core run gen:data` لتوليد `packages/core/src/identifiers/catalog.ts`. الاختبار يفشل إن لم يطابق المولَّد ملفات YAML.
- كل نوع يحتاج مثالاً إيجابياً يقبله نمطه ومدققه، ومثالاً سلبياً يرفضه.
- أمثلة المفاتيح والرموز السرية تُكتب قوالب `{{N:c}}` (مثل `sk_test_{{24:x}}`)، ولا تُكتب نصاً حرفياً.
- النوع الذي يطابق نمطه كلمات عامة يُضبط فيه `context.required: true` مع كلمات سياق.

