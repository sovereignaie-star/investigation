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
PORT=22124 BASE_PATH=/ pnpm run build
pnpm test
PORT=5173 BASE_PATH=/ pnpm --filter @ir/web run dev   # الواجهة: http://localhost:5173
PORT=8080 pnpm --filter @ir/server run dev                         # الخادم: http://localhost:8080/api/healthz
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
