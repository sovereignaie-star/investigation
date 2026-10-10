# غرفة التحقيق (Investigation Room)

أداة تحقيق مفتوح المصدر، عربية الأولوية، محلية أولاً، تبني رسماً من الارتباطات فوق سجل أدلة موثَّق. الخطة الكاملة في `docs/ROADMAP.md`.

## قواعد إلزامية لأي وكيل يعمل هنا (Replit Agent وغيره)

**اقرأ `AGENTS.md` و`GOVERNANCE.md` قبل أي تغيير.** باختصار:

- لا إيداع ولا دفع إلا مع تحديث `docs/STATUS.md` وإضافة إدخال إلى `docs/WORKLOG.md` **في الإيداع نفسه**.
- رسالة كل إيداع تحمل معرّف مهمة من الخارطة، مثل `[P0-006]`.
- لا عمل خارج مهمة معرّفة في `docs/ROADMAP.md` (القسم 6). العمل الجديد يبدأ بإضافة مهمته.
- لا دفع مباشر إلى `main`؛ فرع + Pull Request.

## Run & Operate

- `pnpm install` — يثبت الاعتماديات ويفعّل خطافات الحوكمة
- `pnpm run typecheck` — فحص الأنواع
- `pnpm run build` — فحص الأنواع + البناء
- `pnpm run governance` — فحص الحوكمة لآخر إيداع واتساق الخارطة والحالة
- `pnpm --filter @workspace/api-server run dev` — الخادم
- `pnpm --filter @workspace/api-spec run codegen` — توليد العميل والمخططات من OpenAPI

## Where things live

| المسار | المحتوى |
|---|---|
| `docs/ROADMAP.md` | خارطة الطريق الحاكمة |
| `docs/STATUS.md` | الحالة الحية |
| `docs/WORKLOG.md` | سجل العمل (إضافة فقط) |
| `docs/tools/` | كتالوج الأدوات (10,814 أداة) |
| `artifacts/investigation-room` | الواجهة (Vite + React 19 + Tailwind 4) |
| `artifacts/api-server` | الخادم (Express 5) |
| `lib/` | OpenAPI، Zod، عميل React Query، قاعدة البيانات |

## Stack

pnpm workspaces، Node.js 24، TypeScript 5.9، Express 5، Vite 7، React 19، Tailwind 4، Zod، Orval، Drizzle.
