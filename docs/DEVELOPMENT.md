# دليل التطوير

تشغيل «غرفة التحقيق» محلياً من نسخة نظيفة في أقل من 10 دقائق (P0-023). القواعد الحاكمة في [`GOVERNANCE.md`](../GOVERNANCE.md)، والخارطة في [`ROADMAP.md`](ROADMAP.md).

## المتطلبات

| الأداة | النسخة | ملاحظة |
|---|---|---|
| Node.js | `>=24.7` (`.nvmrc` = 24) | الإصدارات الأقدم غير مدعومة ولا تصلح دليلاً على نجاح الفحوص |
| pnpm | 10 (`packageManager` في `package.json`) | `corepack enable` أو `npm i -g pnpm@10` |
| git | أي نسخة حديثة | الخطافات في `.githooks` تُفعَّل تلقائياً بـ `pnpm install` |
| Python 3 | اختياري | لإعادة بناء كتالوج الأدوات فقط (`tools/catalog/build.py`) |

لا تحتاج قاعدة بيانات: النمط الفردي يعمل بلا Postgres (ADR-04). `DATABASE_URL` مطلوب لنمط الفريق فقط.

## التثبيت وفحوص الأساس

```sh
git clone https://github.com/sovereignaie-star/investigation.git
cd investigation
pnpm install --frozen-lockfile      # يفعّل خطافات الحوكمة (core.hooksPath=.githooks)
pnpm run lint
pnpm run typecheck
pnpm run build
pnpm test
```

## تطوير الواجهة والخادم

انسخ `.env.example` إلى `.env` إذا احتجت إلى إعداد الخادم، ثم عيّن `IR_ADMIN_TOKEN` عشوائياً قبل إدارة الخزنة أو استعمال lookup. لا تودِع `.env` أبداً (GR-12). شغّل الخادم والواجهة في **طرفيتين منفصلتين** لأن كلا الأمرين يستمر في العمل:

```sh
# الطرفية الأولى: يبني الخادم ثم يشغله على http://127.0.0.1:8080
pnpm --filter @ir/server run dev

# الطرفية الثانية: الواجهة على http://localhost:5173 وتحوّل /api إلى الخادم
pnpm --filter @ir/web run dev
```

## تشغيل الخدمة الواحدة محلياً

```sh
pnpm run build
pnpm start                         # يحمّل .env إن وجد، ويستمع افتراضياً على http://127.0.0.1:8080
```

النشر (Docker، Render، Railway، جهاز محلي) موثق في `README.md` قسم «النشر».

التحقق من سلامة قضية (P1-012):

```sh
pnpm ir verify path/to/case --key installation.pub --checkpoint checkpoint.json   # أو --json
pnpm ir project path/to/case [--at seq] [--expect sha256]   # إعادة بناء الرسم والجدول والتغطية من السجل دون شبكة
node packages/cli/dist/ir.mjs verify path/to/case                                # بعد البناء، بلا node_modules
```

مفاتيح مزودي البيانات لا توضع في `.env` بل في خزنة المفاتيح المشفرة (P1-015). رمز `IR_ADMIN_TOKEN` هو رمز إدارة للخادم، لا مفتاح مزوّد، ويُحفظ خارج Git.

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

## قياس تاريخي يحتاج إلى إعادة تحقق

القياس التالي أُخذ في 2026-10-10 تحت Node 20.20.2، وهو **لا يطابق** شرط التشغيل الحالي `>=24.7`؛ لذلك هو سجل تاريخي [مُقاس] وليس دليلاً صالحاً على «أقل من 10 دقائق». يُعاد القياس تحت Node المدعوم قبل أي ادعاء زمني جديد:

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

تعمل وظائف CI على Node 24؛ أضف زمن الاستنساخ النظيف الجديد هنا فقط بعد تسجيل النسخ والنتائج القابلة لإعادة التنفيذ.

## فهرس المعرّفات (P1-003)

- البيانات: `packages/core/identifiers/<category>.yaml`، نوع لكل مدخل بالمخطط `IdentifierSpec` (`@ir/schema`).
- بعد أي تعديل: `pnpm --filter @ir/core run gen:data` لتوليد `packages/core/src/identifiers/catalog.ts`. الاختبار يفشل إن لم يطابق المولَّد ملفات YAML.
- كل نوع يحتاج مثالاً إيجابياً يقبله نمطه ومدققه، ومثالاً سلبياً يرفضه.
- أمثلة المفاتيح والرموز السرية تُكتب قوالب `{{N:c}}` (مثل `sk_test_{{24:x}}`)، ولا تُكتب نصاً حرفياً.
- النوع الذي يطابق نمطه كلمات عامة يُضبط فيه `context.required: true` مع كلمات سياق.
