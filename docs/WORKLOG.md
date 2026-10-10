# سجل العمل (WORKLOG) — إضافة فقط

> **قواعد GR-01 وGR-04 وGR-09:** كل إيداع يضيف إدخالاً جديداً **في آخر هذا الملف** في الإيداع نفسه، يذكر معرّفات المهام المذكورة في رسالة الإيداع، ويصف ما تم والأدلة وما لم يتم والخطوة التالية. لا تُحذف الإدخالات ولا تُعدَّل؛ التصحيح بإدخال جديد.

الصيغة:

```markdown
### YYYY-MM-DD — [Pn-nnn] عنوان قصير
- **المنفّذ:** ...
- **ما تم:** ...
- **الأدلة:** `الأمر` => النتيجة
- **ما لم يتم / ملاحظات:** ...
- **التالي:** ...
```

---

### 2026-10-10 — خط الأساس (قبل الحوكمة)
- **المنفّذ:** Replit Agent (4 إيداعات من 2026-06-10 إلى 2026-06-17، آخرها `56e0f14`)
- **ما تم:** هيكل مساحة عمل pnpm، خادم صحة، طبقات بيانات للواجهة، 370 تعريف معرّف (ملف معطوب).
- **الأدلة:** قياسات القسم 2 من `docs/ROADMAP.md` [مُقاس].
- **ما لم يتم / ملاحظات:** البناء وفحص الأنواع يفشلان؛ لا اختبارات ولا CI. هذا الإدخال تاريخي ويوثق نقطة البداية.
- **التالي:** تفعيل الحوكمة وإكمال الخارطة.

### 2026-10-10 — [P0-001] [P0-002] [P0-003] [P0-018] [P0-020] [P0-012] الخارطة الحاكمة والحوكمة وكتالوج الأدوات
- **المنفّذ:** Perplexity Computer (وكيل ذكاء اصطناعي) بتفويض من مالك المستودع.
- **ما تم:**
  - P0-002: إكمال `docs/ROADMAP.md` من القسم 2 إلى نهايته: تعريف المنتج (3)، المنافسون وD1–D13 (4)، المعمارية و20 قراراً (5)، 142 مهمة في 8 مراحل مع جدول تتبع العيوب (6)، 42 محوّلاً معتمداً لـ GA وخط اعتماد الأدوات (7)، الاختبار (8)، المتطلبات غير الوظيفية (9)، الإصدار والتشغيل (10)، 20 خطراً (11)، 50 بوابة (12)، القواعد الحاكمة GR-01..GR-15 (13)، والملاحق A–G. وإنشاء `docs/STATUS.md` (142 مهمة، 50 بوابة، 50 عيباً) وهذا السجل.
  - P0-001: `GOVERNANCE.md`؛ الحارس `scripts/governance/check.mjs` (أوضاع: commit-msg، range، last، consistency) واختباراته (9 حالات T-GOV)؛ `scripts/governance/sync-status.mjs`؛ الخطافان `.githooks/pre-commit` و`.githooks/commit-msg`؛ سكربت `prepare` يفعّل الخطافات عند `pnpm install`؛ سير عمل CI `.github/workflows/governance.yml` يفحص **كل إيداع** في كل PR وكل دفع إلى `main`.
  - P0-003: `tools/catalog/build.py` و`sources.json` (19 قائمة)؛ الناتج `docs/tools/catalog.csv` و`STATS.md` و22 ملف مجال و`README.md`.
  - P0-018: قالب PR بقائمة الحوكمة، وقوالب Issues (مهمة، اعتماد مصدر، عيب).
  - P0-020: `AGENTS.md` لكل الوكلاء الآليين.
  - P0-012 (جزئي): `replit.md` أعيدت كتابته ويحيل إلى القواعد الحاكمة (يقرؤه Replit Agent).
- **الأدلة:**
  - `node --test scripts/governance/` => 9 pass, 0 fail
  - `node scripts/governance/check.mjs --consistency` => ROADMAP and STATUS are consistent
  - `python3 tools/catalog/build.py` => total 10814، usable 9692 (reachable 7221، restricted 2471)، unreachable 1122، excluded offensive 199، irrelevant 591
  - هذا الإيداع نفسه مرّ بخطاف `commit-msg` (أول إيداع خاضع للقاعدة)
- **ما لم يتم / ملاحظات:**
  - حماية الفرع `main` (جزء من P0-001) تُفعَّل بعد دمج هذا الإيداع لأن الفحص المطلوب `governance` يجب أن يوجد أولاً؛ لذلك P0-001 = `in_progress`.
  - P0-012: بقي `index.html` (`lang`/`dir` والوصف).
  - الحالات في 4.1 والقسم 7 موسومة [للتحقق] حتى تُراجع ببروتوكول 4.2 وخط 7.2.
- **التالي:** تفعيل حماية الفرع وإغلاق P0-001، ثم P0-004 (إصلاح `identifierList.ts`).

### 2026-10-10 — [P0-001] إصلاح أمر اختبارات الحارس في CI
- **المنفّذ:** Perplexity Computer.
- **ما تم:** فشل فحص `governance` في PR #1 لأن Node 24 لا يقبل مجلداً في `node --test scripts/governance/` (MODULE_NOT_FOUND). استُبدل بمسار الملف `scripts/governance/check.test.mjs` في سير العمل و`package.json` والوثائق.
- **الأدلة:** سجل التشغيل 38010674079 (فشل)؛ محلياً `node --test scripts/governance/check.test.mjs` => 9 pass.
- **ما لم يتم / ملاحظات:** يوضح هذا الإصلاح أن القاعدة GR-01 تسري على إصلاحات الحوكمة نفسها.
- **التالي:** دمج PR #1 ثم تفعيل حماية الفرع.

### 2026-10-10 — [P0-001] تفعيل حماية الفرع وإغلاق مهمة الحوكمة
- **المنفّذ:** Perplexity Computer.
- **ما تم:** دُمج PR #1 بطريقة rebase (كل إيداع فيه اجتاز الحارس). فُعّلت حماية `main` عبر واجهة GitHub: فحص `governance` مطلوب ومحدَّث (strict)، PR إلزامي، تسري على المشرفين (`enforce_admins: true`)، لا دفع قسري ولا حذف، تاريخ خطي. أضيف `scripts/governance/set-status.mjs` لتحديث صفوف الحالة وإعادة حساب جدول تقدم المراحل.
- **الأدلة:** `gh api repos/sovereignaie-star/investigation/branches/main/protection` => `contexts: ["governance"]`, `enforce_admins: true`؛ فحص PR #1 = pass (التشغيل 38010760742).
- **ما لم يتم / ملاحظات:** فحوص `build` و`test` تُضاف إلى الفحوص المطلوبة عند P0-011.
- **التالي:** P0-004.

### 2026-10-10 — [P0-004] إصلاح identifierList.ts المعطوب (D-001)
- **المنفّذ:** Perplexity Computer.
- **ما تم:** السطر 421 (مدخل `onion_v3`) كان مقطوعاً بمثال طوله نحو 79.8 ألف حرف من `w` ولم يُغلق النص ولا المصفوفة. استُبدل بمدخل سليم بالحقول نفسها، ومثال بصيغة v3 صحيحة (56 حرفاً من `[a-z2-7]`: عنوان مشروع Tor العام)، وأُغلقت المصفوفة بـ `];`.
- **الأدلة:**
  - حجم الملف: 195,740 => 116,264 بايت؛ أطول سطر: 79,832 => 410 حرفاً [مُقاس]
  - `pnpm run typecheck` => لم يعد يظهر `TS1002`؛ الخطأ الوحيد المتبقي `TS2352` في `investigationDatabase.ts(77,33)`، مطابق لما تنبأ به القسم 2.3 [مُقاس]
- **ما لم يتم / ملاحظات:** اختبار T-IDL (العدد والتفرد وطول السطر) يُضاف في P0-010.
- **التالي:** P0-005.

### 2026-10-10 — [P0-005] إصلاح TS2352 ومفتاح كاش العقد (D-004)
- **المنفّذ:** Perplexity Computer.
- **ما تم:** جدول `nodeCache` في Dexie كان بمفتاح `++id` بينما العقدة تحمل `id` نصياً، ثم يُحوَّل إلى رقم عند التحديث (`existing.id as number`)، فتتعارض القيود عند تكرار العقدة بمفتاح كاش مختلف. أضيفت نسخة مخطط 2: حذف `nodeCache` (كاش قابل للاستغناء) وإنشاء `nodeCacheByKey` بمفتاح أساسي `cacheKey`، واستُعمل `put()` (إدراج أو تحديث) و`get(cacheKey)`. لم يُمس جدول `investigations`؛ استبداله الكامل في P1-013.
- **الأدلة:** `pnpm run typecheck` => exit 0 لكل المساحة (أول مرة منذ بدء المستودع) [مُقاس]. البوابة G-01 متحققة.
- **ما لم يتم / ملاحظات:** لا اختبار وحدة لطبقة Dexie (تتطلب IndexedDB وهمية)؛ الطبقة كلها مقرر استبدالها في P1-013.
- **التالي:** P0-006 (نقطة دخول الواجهة).

### 2026-10-10 — [P0-006] [P0-012] نقطة دخول الواجهة وتنظيف index.html (D-002، D-041، D-047)
- **المنفّذ:** Perplexity Computer.
- **ما تم:**
  - P0-006: `src/main.tsx` و`src/App.tsx` و`src/index.css` (Tailwind 4). صفحة عربية RTL مؤقتة تعرض المرحلة الحالية، وعدد أنواع المعرّفات حسب التصنيف من `IDENTIFIER_LIST` الفعلي، وروابط الوثائق الحاكمة. النصوص مضمّنة مؤقتاً حتى P3-017.
  - P0-012: `index.html` صار `lang="ar" dir="rtl"` بعنوان ووصف حقيقيين و`robots: noindex`، وأزيل تحميل خطوط Google الخارجي لأنه طلب لطرف ثالث يخالف مبدأ المحلية (E-06)؛ تُستعمل خطوط النظام.
- **الأدلة:**
  - `pnpm run typecheck` => exit 0
  - `PORT=22124 BASE_PATH=/ pnpm run build` => نجاح: 30 وحدة، JS 290.7KB (82.2KB gzip)، CSS 16.2KB [مُقاس]
  - لقطة شاشة بمتصفح بلا واجهة: الصفحة تُعرض RTL، و**عدد الأنواع 371** (لا 370): الـ 370 السليمة + `onion_v3` الذي أصلحه P0-004 [مُقاس]. التصنيفات: Social 69، Phone 67، وثائق الهوية 53، Crypto 29، Network 25، Device 25، API 25، Financial 22، Hash 20، Domain 19، Email 15، DarkWeb 2.
- **ما لم يتم / ملاحظات:** الرقم 370 في الخارطة (T-IDL-001 والملحق B) يُصحَّح في إيداع P0-010 مع الاختبار الذي يقيسه.
- **التالي:** P0-007، P0-009، P0-010.

### 2026-10-10 — [P0-007] [P0-009] نظافة ملفات البيئة وتثبيت بيئة التشغيل (D-039، D-040 جزئياً)
- **المنفّذ:** Perplexity Computer.
- **ما تم:**
  - P0-007: أضيف إلى `.gitignore`: `.env` و`.env.*` مع `!.env.example`. أُنشئ `.env.example` بمتغيرات الملحق D بلا قيم، مع تنبيه أن مفاتيح المزوّدين مكانها الخزنة لا البيئة. الخطاف `pre-commit` يرفض أصلاً أي ملف `.env` مُدرَج (GR-12).
  - P0-009: `package.json` في الجذر: `engines: {node: ">=24", pnpm: ">=10"}` و`packageManager: "pnpm@10.34.6"`، و`.nvmrc` بالقيمة 24 (ADR-03).
- **الأدلة:** `git check-ignore -v .env .env.local` => يطابقان السطرين 31 و32؛ `git check-ignore .env.example` => غير مُتجاهَل [مُقاس].
- **ما لم يتم / ملاحظات:** بيئة التنفيذ المحلية لهذا الوكيل تعمل بـ Node v20.20.2، لذا تُظهر pnpm تحذير engines محلياً فقط؛ CI يستعمل Node 24.
- **التالي:** P0-013، P0-014.

### 2026-10-10 — [P0-013] [P0-014] جعل قاعدة البيانات اختيارية (D-038، D-044)
- **المنفّذ:** Perplexity Computer.
- **ما تم:**
  - P0-013: تبيّن أن وصف D-044 في الخارطة غير دقيق: `pnpm --filter db exec pwd` => `/…/lib/db`، أي أن المرشّح يُحل إلى `@workspace/db` [مُقاس]. الخلل الحقيقي أن `drizzle-kit push` يفشل حين لا يوجد `DATABASE_URL`، فيفشل `post-merge.sh` كله على Replit. صار السكربت يستعمل الاسم الصريح ويتخطى الدفع بلا قاعدة. صُحّح سطر D-044 في الخارطة بوسم [مُقاس].
  - P0-014: `lib/db/src/index.ts` لم يعد يرمي خطأ عند الاستيراد؛ يوفر `isDatabaseConfigured()` و`getPool()` و`getDb()` الكسولة. لا مستهلك حالياً لـ `db`/`pool` المصدّرين سابقاً (`grep` في `artifacts/api-server/src` => لا استيراد).
- **الأدلة:** `pnpm --filter db exec pwd` => `lib/db`؛ `pnpm run typecheck` => exit 0.
- **ما لم يتم / ملاحظات:** اختبار «الاستيراد لا يرمي» يُضاف في P0-010 (لا يمكن تشغيل TS مباشرة على Node 20 المحلي).
- **التالي:** P0-010 (Vitest)، P0-011 (CI البناء).

### 2026-10-10 — [P0-010] إطار الاختبار وأول الاختبارات (D-040 جزئياً)
- **المنفّذ:** Perplexity Computer.
- **ما تم:** أضيف Vitest 3 في الجذر مع `vitest.config.ts` (يشمل `artifacts/` و`lib/` و`packages/` و`apps/`، ويستثني mockup-sandbox) وسكربتا `test` و`test:watch`. اختبارات:
  - `identifierList.test.ts`: T-IDL-001 (371 نوعاً)، T-IDL-002 (تفرد المعرّفات)، T-IDL-003 (الحقول الإلزامية وRegExp)، T-IDL-004 (لا سطر ≥ 2,000 حرف: حارس ضد تكرار D-001)، T-IDL-005 (مثال onion_v3)، T-IDL-006 (خط أساس مطابقة الأمثلة ≥ 80% لا يتراجع؛ يُرفع إلى 100% في P1-004).
  - `lib/db/src/index.test.ts`: استيراد `@workspace/db` بلا `DATABASE_URL` لا يرمي، و`getDb()` يرمي رسالة واضحة (يثبت P0-014).
- **الأدلة:**
  - `pnpm test` => Test Files 2 passed، Tests 8 passed [مُقاس]
  - `pnpm run typecheck` => exit 0 (ملفات الاختبار ضمن الفحص)
  - قياس: 371 نوعاً، 377 مثالاً، 303 تطابق نمطها = 80.37%؛ التصنيفات Email 15، Phone 67، Network 25، Domain 19، Social 69، Crypto 29، Documents 53، Device 25، Finance 22، Hash 20، API 25، DarkWeb 2 [مُقاس]
- **تحديث الخارطة:** صُحّح T-IDL-001 والمهمتان P0-004 وP1-003 من 370 إلى 371، واستُبدلت أرقام الملحق B التقريبية بالأرقام المقيسة (وأضيف صف API، والهدف الكلي 810).
- **ما لم يتم / ملاحظات:** تقارير التغطية تُضاف مع حزم النواة في المرحلة 1.
- **التالي:** P0-011 (CI للبناء والاختبار).

### 2026-10-10 — [P0-011] خط CI للبناء والاختبار
- **المنفّذ:** Perplexity Computer.
- **ما تم:** `.github/workflows/ci.yml` بوظيفتين على Node 24 وpnpm من `packageManager`: `build` (تثبيت مقفل، `typecheck`، بناء كل الحزم بـ `PORT=22124 BASE_PATH=/`) و`test` (`pnpm test`). يعمل على كل PR وكل دفع إلى `main`، مع إلغاء التشغيلات المتزامنة للفرع نفسه.
- **الأدلة:** محلياً: `pnpm run typecheck` => 0، `pnpm run build` => نجاح، `pnpm test` => 8 passed. نتيجة CI تُسجل في الإدخال التالي.
- **ما لم يتم / ملاحظات:** الحالة `in_progress` حتى تنجح الوظيفتان على GitHub وتُضافا إلى الفحوص المطلوبة لحماية `main`.
- **التالي:** دمج PR #3، ثم تسجيل `build` و`test` فحوصاً مطلوبة وإغلاق P0-011.

### 2026-10-10 — [P0-011] إغلاق: build وtest فحوص مطلوبة لحماية main
- **المنفّذ:** Perplexity Computer.
- **ما تم:** بعد دمج PR #3 ونجاح أول تشغيل لـ `ci.yml` (build ✓ في 20 ثانية، test ✓ في 17 ثانية، governance ✓)، حُدّثت حماية `main` لتشترط الفحوص الثلاثة `governance` و`build` و`test` مع `strict` (الفرع يجب أن يكون محدثاً قبل الدمج).
- **الأدلة:** `gh api -X PATCH repos/sovereignaie-star/investigation/branches/main/protection/required_status_checks` => `["governance","build","test"]` [مُقاس]. البوابة G-03 متحققة.
- **ما لم يتم / ملاحظات:** لا شيء متبقٍ في P0-011.
- **التالي:** P0-021 (دمج الخطة الشاملة التي أرفقها المالك).

### 2026-10-10 — [P0-021] تمهيد دمج الخطة الشاملة: القاعدة GR-16 وتوسيع الحارس
- **المنفّذ:** Perplexity Computer.
- **ما تم:** أرفق المالك `INVESTIGATION_ROOM_MASTER_PLAN.md` (5,625 سطراً، 67 قسماً) وطلب دمجه في المشروع مع وصف كل ما أُنجز فيه، دون تعارض أو تكرار. قبل إدخال الملف:
  - أضيفت القاعدة **GR-16** إلى `GOVERNANCE.md` والقسم 13.1 من الخارطة و`AGENTS.md`: الخطة الشاملة طبقة رؤية لا طبقة تنفيذ، فلا تحمل حالة (لا مربعات اختيار)، وكل معرّف مهمة فيها يجب أن يوجد في الخارطة.
  - `check.mjs`: دالة `masterPlanChecks` تُشغَّل ضمن `--consistency` (تتجاهل كتل الشيفرة)؛ وأنماط المعرّفات صارت `P[0-9]` في `check.mjs` و`set-status.mjs` و`sync-status.mjs` لدعم مرحلة ما بعد GA (المرحلة 8).
  - أربعة اختبارات جديدة T-GOV-009..012.
  - سُجّلت المهمة P0-021 في الخارطة والحالة، وأضيف `MASTER_PLAN.md` إلى خريطة الملفات الحاكمة 0.6.
- **الأدلة:** `node --test scripts/governance/check.test.mjs` => pass 13، fail 0؛ `check.mjs --consistency` => متسق [مُقاس].
- **ما لم يتم / ملاحظات:** إدخال الخطة نفسها والقسم 14 في الإيداع التالي.
- **التالي:** إيداع الخطة الشاملة المدمجة.

### 2026-10-10 — [P0-021] دمج الخطة الشاملة في المشروع
- **المنفّذ:** Perplexity Computer.
- **ما تم:**
  - `docs/MASTER_PLAN.md`: النسخة المدمجة 1.1 (3,569 سطراً بدل 5,625). أضيف القسم 0 (العلاقة بالخارطة، العلامات، لقطة مؤرخة لكل ما أُنجز، وما عولج عند النقل)، وسطر «الربط بالخارطة» لكل مرحلة من 0 إلى 20، و«ملاحظة الدمج C-nn» في كل موضع تعارض. حُوّلت 634 مربع اختيار إلى بنود عادية (GR-16)، واستُبدل القسم 2 بالوضع المقيس، واختُصر القسم 67 (100 بند مكرر) إلى 19 بنداً فريداً، ودُمجت 6 خواتيم في خاتمة واحدة، وحُذف تفصيل الأسبوعين 1 و2 المكرر من القسم 61. أرقام الأقسام الأصلية محفوظة.
  - الأصل محفوظ حرفياً في `docs/archive/MASTER_PLAN-original-2026-10-10.md` (SHA-256 `eee2d3f0…7224`).
  - الخارطة: القسم 14 الجديد (الأسبقية 14.1، ربط 21 مرحلة 14.2، 39 تعارضاً محسوماً C-01..C-39 في 14.3، حالة 38 مصدراً 14.4، ما أضيف 14.5، كيف عولج النقل 14.6)؛ مهام جديدة P0-022..P0-025، P2-023..P2-027، P3-021..P3-025، P5-018..P5-024، P6-015، P7-011، والمرحلة 8 (6.10) P8-001..P8-022؛ محوّلات TR-043..TR-053؛ NFR-21..NFR-25؛ R-21، R-22؛ ADR-21..ADR-24؛ شروط DoD 8..12؛ TheHive/Cortex وIntelligence X في 4.1؛ فهرس 0.4 وخريطة الملفات 0.6.
  - `STATUS.md`: صفوف كل المهام الجديدة، وقسم وصف تقدم للمرحلة 8. قالب الـ PR: بند DoD وGR-16.
- **الأدلة:** `grep -c "\[ \]" docs/MASTER_PLAN.md` => 0؛ `sha256sum docs/archive/…` يطابق المرفق؛ `check.mjs --consistency` => متسق. مصادر متوقفة [مُتحقَّق]: BinaryEdge أُغلق 2025-03-31 (Coalition)، PassiveTotal استُبدل بـ Defender TI (RiskIQ)، Clearbit أوقف الأدوات المجانية 2025-04-30، Bing Search API أُوقفت 2025-08-11 (Microsoft Learn)، Google Custom Search JSON API مغلقة للجدد وتتوقف 2027-01-01 (Google)، abuse.ch يشترط Auth-Key منذ 2025-06-30، VirusTotal العامة تمنع الاستعمال التجاري.
- **ما لم يتم / ملاحظات:** خانات المنافسين الجديدة [للتحقق]. المهام الجديدة كلها `todo`.
- **التالي:** P0-008 (README والترخيص AGPL وملفات المجتمع).

### 2026-10-10 — [P0-008] ملفات المشروع والترخيص
- **المنفّذ:** Perplexity Computer.
- **ما تم:** `README.md` (عربي مع ملخص إنجليزي، يربط الوثائق الحاكمة وأوامر التشغيل)، `LICENSE` بنص AGPL-3.0 الرسمي، `SECURITY.md` (إبلاغ خاص عبر GitHub Security Advisories، مدد الاستجابة، النطاق)، `CONTRIBUTING.md` (دورة العمل وقواعد الإيداع والـ PR)، `CODE_OF_CONDUCT.md` (مقتبس من Contributor Covenant 2.1). حقل `license` في `package.json` من MIT إلى `AGPL-3.0-or-later` (ADR-10). فُعّل الإبلاغ الخاص عن الثغرات في المستودع.
- **الأدلة:** `sha256sum LICENSE` => `0d96a4ff…abcb0` (النص الرسمي من gnu.org، 661 سطراً)؛ `gh api repos/sovereignaie-star/investigation/private-vulnerability-reporting` => `{"enabled":true}` [مُقاس]. العيب D-040 مُصلح بكامل عناصره، والبوابة G-04 متحققة.
- **ما لم يتم / ملاحظات:** CODEOWNERS والتسميات وفحص الأسرار ضمن P0-024.
- **التالي:** P0-015 (سجلات القرار في `docs/adr/`).

### 2026-10-10 — [P0-015] سجلات القرار الأولى
- **المنفّذ:** Perplexity Computer.
- **ما تم:** `docs/adr/` بملف لكل قرار «مُقرّر» بالصيغة المعتمدة في الخارطة 5.20 (السياق، القرار، البدائل، العواقب، الحالة): ADR-01، 02، 03، 10، 11، 13، 14، 19، 20، 21، 22، 23، مع فهرس `docs/adr/README.md`. القرارات «المقترحة» (04..09، 12، 15..18) تُكتب ملفاتها مع مهامها، وADR-24 مفتوح حتى P8-001. أضيف إلى معيار قبول P0-022 فحص صيغة Conventional Commits في الحارس وlint-staged (ADR-22). عنوان القسم 6 في الخارطة صار مطابقاً للفهرس.
- **الأدلة:** `ls docs/adr | wc -l` => 13 (12 قراراً + فهرس) [مُقاس]. العيب D-045 مُصلح بـ ADR-01.
- **ما لم يتم / ملاحظات:** لا شيء ضمن نطاق P0-015.
- **التالي:** P0-016 (أصول بايثون المكررة).

### 2026-10-10 — [P0-016] إزالة تكرار أصول بايثون وجردها
- **المنفّذ:** Perplexity Computer.
- **ما تم:** تحقق آلي من أن الـ 26 ملفاً في `attached_assets/` أزواج متطابقة (13 زوجاً، بصمة واحدة لكل زوج). نُقلت نسخة واحدة من كل زوج بـ `git mv` إلى `attached_assets/legacy/<الاسم>.py` وحُذفت الأخرى، ونُقل النص الملصوق إلى `legacy/pasted-notes.txt`. أنشئ `legacy/MANIFEST.md` بالأسطر والبايتات وSHA-256 ونتيجة `py_compile` والحكم والأسماء الأصلية. أضيف `__pycache__/` إلى `.gitignore`.
- **الأدلة:** 13 ملفاً فريداً، 11,563 سطراً، `py_compile` يمر على Investigation1 و2 و4 (بايثون صالح) و9 (JSON يبدو قاموساً) ويفشل على الباقي: يطابق الخارطة 1.2 و2.9 [مُقاس]. لا كود يستورد هذه الملفات (الاسم المستعار `@assets` في Vite لا يُستعمل معها). العيب D-042 مُصلح.
- **ما لم يتم / ملاحظات:** استخراج التصنيفات إلى YAML في المرحلة 5.
- **التالي:** P0-017 (Dependabot وCodeQL وgitleaks).

### 2026-10-10 — [P0-017] فحوص أمن آلية: Dependabot وCodeQL وgitleaks
- **المنفّذ:** Perplexity Computer.
- **ما تم:** `.github/dependabot.yml` (npm وGitHub Actions أسبوعياً بتوقيت الرياض، تجميع التحديثات الصغرى، حد 5 طلبات)؛ `.github/workflows/codeql.yml` (javascript-typescript بمجموعة `security-extended` على كل PR وعلى `main` وأسبوعياً)؛ `.github/workflows/secrets.yml` (gitleaks 8.30.1 بتنزيل مثبّت والتحقق من SHA-256، يفحص إيداعات الـ PR وكامل التاريخ عند الدفع إلى `main`)؛ `.gitleaks.toml` بالقواعد الافتراضية واستثناء واحد مراجَع.
- **الأدلة:** `gitleaks git --redact .` على كامل التاريخ (33 إيداعاً) وجد نتيجة واحدة: `private-key` في `identifierList.ts:409`، وهي نمط كشف ومثال `-----BEGIN RSA PRIVATE KEY-----` بلا أي مادة مفتاح، فاستُثنيت بنمط سطر محدد لا بالملف كله. بعد الاستثناء: `no leaks found` [مُقاس]. حارس الحوكمة يتعامل مع إيداعات Dependabot (BOT_AUTHORS) بشرط إيداع محكوم في الـ PR نفسه. البوابة G-07 متحققة.
- **ما لم يتم / ملاحظات:** الفحوص الجديدة غير مطلوبة لحماية `main` بعد؛ تُضاف بعد أسبوع من الاستقرار. فحص الأسرار المدمج في GitHub ضمن P0-024.
- **التالي:** P0-019 (سكربت القياس).

### 2026-10-10 — [P0-026] دمج «المرجع الشامل لقدرات OSINT»
- المنفّذ: وكيل آلي (Perplexity Computer) بطلب المالك.
- ما تم: قُرئ الملف المرفق (5,762 سطراً، SHA-256 `a40147bbd9124616962d31fe836363cb215806c1801861e9231401f835763846`). المحتوى الفعلي في الأسطر 1–765؛ الأقسام 15–20 بنود فارغة مرقمة وقالبان مكرران فتُركت. الملف الثاني المرفق (`INVESTIGATION_ROOM_MASTER_PLAN.md`) مطابق بايتياً لما دُمج في PR #4 فلا جديد فيه. أُضيفت المهام P2-028 (طبقة خصوصية المحقق: HTTP/SOCKS5/Tor وقوائم وكلاء)، P2-029 (إلغاء الطلبات وتعطيل المصدر وإحصاءاته)، P2-030 (الدفعة السادسة)، P4-018..P4-022 (العقد الحرجة، أنماط الصمت والنشاط، ATT&CK/CAPEC/D3FEND، YARA وSigma محلياً، تصدير MISP وOpenIOC)، و27 محوّلاً TR-054..TR-080، والقسم 14.7 (ما أُخذ وأين، وما لم يُؤخذ مع السبب والمصدر). أضيف إلى مولّد الكتالوج مصدر `curated` ووضع `--add-curated` (دمج دون إعادة الجلب وفحص الروابط الجديدة فقط)، و`tools/catalog/curated.json` بـ 20 أداة ناقصة.
- الأدلة: `python3 tools/catalog/build.py --add-curated` → 10,834 أداة (كانت 10,814)، 9,711 قابلة للمتابعة؛ VirusBay حُذف لأن نطاقه لا يُحلّ [مُقاس]؛ وصف Feodo Tracker عُدّل لأن مرشح السياسة الهجومية كان يستبعده بكلمة botnet. توقف Google Cache وAlexa وBitcoinAbuse وProject Sonar موثق بمصادر في 14.7.
- ما لم يتم: كتابة المحوّلات نفسها (P2-030 وما يليها)؛ شروط Shodan InternetDB وواجهة archive.today [للتحقق].
- التالي: P0-019 ثم P0-022..P0-025.

### 2026-10-10 — [P0-019] سكربت قياس خط الأساس
- المنفّذ: وكيل آلي (Perplexity Computer).
- ما تم: `scripts/audit/measure.mjs` يعيد قياس جدول 1.2 بالتعريفات نفسها (الملفات، الإيداعات، المشاريع والحزم، typecheck/build/test مع `--full`، أسطر الواجهة، أنواع المعرّفات وجالباتها ودقة الأمثلة و«أول تطابق»، الاختبارات، CI، ملفات المشروع، مسارات API، نظافة الأسرار، أصول بايثون). يحمّل `identifierList.ts` بمترجم TypeScript الموجود في مساحة العمل دون اعتمادية جديدة. أضيف `pnpm run audit:measure` وإحالة في 1.2.
- الأدلة: يعيد أرقام خط الأساس حيث لم يتغير الكود: 31 نوعاً بجالب، 14 مثالاً صحيحاً بـ«أول تطابق» (3.7%)، 11,563 سطر بايثون، 3 برامج صالحة. الفروق المتوقعة: 371 نوعاً (إصلاح onion_v3 في P0-004)، وtypecheck وbuild وtest تنجح الآن. القياس الحالي (قبل هذا الإيداع):

| المقياس | القيمة |
|---|---|
| الإيداع المقيس | `767dfa8` |
| الملفات المتتبعة في git | 230 ملفاً |
| الإيداعات | 22 إيداعاً (2026-06-10 إلى 2026-10-10)، المؤلفون: sovereignaie-star، Replit Agent |
| مشاريع مساحة العمل (workspace) | 9 مشاريع، 558 حزمة مثبتة |
| `pnpm run typecheck` | **ينجح** (6.4 ث) |
| `build` لكل المشاريع | **ينجح** (3.5 ث) |
| `pnpm test` | **ينجح**: 8 اختباراً (1.6 ث) |
| أسطر TypeScript في تطبيق الواجهة | 1,754 سطراً (1,332 دون `identifierList.ts`) |
| أنواع المعرّفات | 371 نوعاً في 12 تصنيفاً |
| أنواع لها جالب بيانات فعلي | 31 من 371 (8.4%) |
| أمثلة تطابق regex نوعها | 303 من 377 (80.4%) |
| تصنيف «أول تطابق» يُعيد النوع المعلن | 14 من 377 (3.7%) |
| ملفات الاختبار | 3 ملفات |
| تكامل مستمر (CI) | 4 مسارات: ci.yml، codeql.yml، governance.yml، secrets.yml |
| README / LICENSE / SECURITY | README.md: موجود، LICENSE: موجود، SECURITY.md: موجود |
| مسارات API | 1: `GET /healthz` |
| نظافة الأسرار | `.env` في `.gitignore`: نعم؛ إعداد gitleaks: موجود؛ مسار فحص الأسرار: موجود |
| ملفات بايثون المرفقة | 13 ملفاً = 13 فريداً، 11,563 سطراً، 3 منها برامج بايثون صالحة |

- ما لم يتم: القياس على إيداع قديم (`--ref`) غير مدعوم لأن خط الأساس `56e0f14` لا يُبنى أصلاً؛ أرقامه مجمّدة في 1.2.
- التالي: P0-022.

### 2026-10-10 — [P0-022] جودة الكود الثابتة
- المنفّذ: وكيل آلي (Perplexity Computer).
- ما تم: `eslint.config.mjs` (ESLint 9 + typescript-eslint strict + react-hooks؛ قواعد: `complexity` ≤ 15، `no-console` خارج السكربتات والاختبارات، `no-explicit-any`)؛ `.prettierrc.json` و`.prettierignore` و`.editorconfig`؛ `pnpm run lint` وخطوة Lint في وظيفة `build` في CI؛ lint-staged في `.githooks/pre-commit` (ESLint وPrettier على الملفات المُودَعة فقط، فيُطبّق التنسيق تدريجياً)؛ فحص Conventional Commits في الحارس (GR-03، ADR-22) مع T-GOV-013/014. إصلاحات صغيرة كشفها المدقق: متغيرات غير مستعملة، كتلة فارغة، تأكيدات non-null، حذف مفتاح ديناميكي. وأُصلح D-013: أُزيل استدعاء `api.whoisfreaks.com` غير المستعمل الذي كان يرسل اسم النطاق الهدف لطرف ثالث. أضيف `yaml: ^2.9.1` إلى `overrides` لأن lint-staged جلب نسخة ثانية من yaml فتكررت نسخة vite وفشل typecheck في `mockup-sandbox` (TS2769).
- الأدلة: `pnpm run lint` بلا أخطاء؛ `pnpm run build` ينجح؛ `pnpm test` 8 ناجحة؛ اختبارات الحارس 15 ناجحة؛ `check.mjs --range origin/main..HEAD` بلا فشل.
- ما لم يتم: أربعة ملفات قديمة معفاة صراحة من `complexity` و`no-useless-escape` و`no-control-regex` في `eslint.config.mjs` (`identifierList.ts`، `resultFetcher.ts`، `smartInvestigator.ts`، `custom-fetch.ts`) حتى تستبدلها P1-004..P1-006 ومحوّلات المرحلة 2؛ ومكونات shadcn في `mockup-sandbox`. لم يُعَد تنسيق المستودع كله بـ Prettier عمداً.
- التالي: P0-023.

### 2026-10-10 — [P0-023] دليل التطوير
- المنفّذ: وكيل آلي (Perplexity Computer).
- ما تم: `docs/DEVELOPMENT.md` (المتطلبات، التشغيل، ما يُفحص عند الإيداع، أوامر مفيدة، القياس المسجل)، و`.vscode/extensions.json`، وروابط من README وCONTRIBUTING.
- الأدلة: استنساخ نظيف للفرع في `/tmp` بمخزن pnpm فارغ: install 113 ث، lint 4 ث، typecheck 13 ث، build 11 ث، test 2 ث (8 ناجحة)، `dev` للواجهة HTTP 200، `/api/healthz` يعيد `{"status":"ok"}`؛ المجموع 158 ث [مُقاس]. البيئة Node 20.20.2 لا 24.
- ما لم يتم: `compose.dev.yml` (اختياري، لنمط الفريق فقط) لم يُضف لأن النمط الفردي لا يحتاج قاعدة بيانات؛ يُضاف مع مهام Postgres.
- التالي: P0-024.

### 2026-10-10 — [P0-024] إعدادات المستودع
- المنفّذ: وكيل آلي (Perplexity Computer) بصلاحية المالك.
- ما تم: `.github/CODEOWNERS` (المالك مراجعاً لكل المسارات، مع تخصيص صريح لملفات الحوكمة)، و`.github/labels.yml` بـ 25 تسمية (النوع، المرحلة 0–8، المجال، الأولوية M/S/C، `blocked`، `natural-person-gate`) طُبّقت على المستودع.
- الأدلة (أوامر `gh api`):
  - `gh label create <name> --color <c> --description <d> --force` × 25 → 25 ناجحة.
  - `gh api -X PUT repos/sovereignaie-star/investigation/vulnerability-alerts` → 204.
  - `gh api -X PUT repos/sovereignaie-star/investigation/automated-security-fixes` → 204؛ القراءة: `{"enabled":true,"paused":false}`.
  - `gh api repos/sovereignaie-star/investigation --jq .security_and_analysis` → `secret_scanning` و`secret_scanning_push_protection` و`dependabot_security_updates`: enabled.
  - `gh api repos/sovereignaie-star/investigation/private-vulnerability-reporting` → `{"enabled":true}` (فُعّل في P0-008).
- ما لم يتم: `secret_scanning_non_provider_patterns` و`secret_scanning_validity_checks` بقيا معطّلين؛ طلب التفعيل لم يغيّر الحالة (يتطلبان GitHub Advanced Security أو Secret Protection المدفوع) [مُقاس]. gitleaks في CI يغطي الأنماط العامة.
- التالي: P0-025.

### 2026-10-10 — [P0-025] مدخل المعمارية
- المنفّذ: وكيل آلي (Perplexity Computer).
- ما تم: `ARCHITECTURE.md` في الجذر: ثلاثة مبادئ، جدول «أين تجد ماذا» يحيل إلى 5.1–5.20 و`docs/adr/` دون نسخ، وجدول الوضع الحالي مقابل المستهدف (`artifacts/*` إلى `apps/*` و`packages/*`). رابط من README.
- الأدلة: كل روابط الأقسام (14 رابطاً) تطابق عناوين القسم 5 بصيغة روابط GitHub (فحص آلي)؛ `check.mjs --consistency` ناجح.
- ما لم يتم: لا شيء ضمن معيار القبول.
- التالي: إغلاق المرحلة 0 ودفع الفرع وفتح PR.

### 2026-10-10 — [P0-025] روابط README وCONTRIBUTING وإغلاق المرحلة 0
- المنفّذ: وكيل آلي (Perplexity Computer).
- ما تم: روابط من README إلى `ARCHITECTURE.md` و`docs/DEVELOPMENT.md`، ورابط الدليل في CONTRIBUTING. كان رابط CONTRIBUTING مذكوراً في إدخال P0-023 ولم يُطبَّق لأن أمر التحرير توقف قبله؛ صُحّح هنا. تحديث ملخص الحالة: المرحلة 0 مكتملة 26/26.
- الأدلة: `check.mjs --consistency` ناجح؛ جدول تقدم المراحل في STATUS: المرحلة 0 = 26 من 26.
- ما لم يتم: لا شيء.
- التالي: دفع الفرع وفتح PR ثم المرحلة 1 (P1-001).

### 2026-10-10 — [P0-027] دمج تحديثات Dependabot وحل تعارضاتها
- المنفّذ: وكيل آلي (Perplexity Computer) بطلب المالك «حل تعارض طلبات الدمج».
- ما تم: فتح Dependabot ثلاثة طلبات (#6 `pnpm/action-setup` 4→6، #7 `actions/setup-node` 4→7، #8 `actions/checkout` 4→7)، كلها تعدّل الأسطر نفسها في `ci.yml` فتتعارض عند دمجها تباعاً، وكلها تفشل في فحص الحوكمة لأنها لا تحدّث STATUS وWORKLOG. أُبقي إيداع #6 كما هو (مؤلف آلي، يُستثنى في فحص النطاق ما دام في الطلب إيداع محكوم)، وطُبّق #7 و#8 معاً هنا مع حل التعارض في `ci.yml`.
- الأدلة: `grep -h uses: .github/workflows/*.yml` → `actions/checkout@v7` × 5، `actions/setup-node@v7` × 3، `pnpm/action-setup@v6` × 2، `codeql-action@v4` × 2؛ الفرق مع فروع #7 و#8 في الأسطر المعنية صفر.
- ما لم يتم: إغلاق #6–#8 يتم بعد دمج هذا الطلب.
- التالي: P0-028.

### 2026-10-10 — [P0-028] دمج «ترسانة الأدوات والقدرات» (PR #9)
- المنفّذ: وكيل آلي (Perplexity Computer) بطلب المالك «رتب الملف وطوره ووزعه حسب الاختصاصات».
- ما تم: PR #9 أضاف `docs/ROADMAP2.md` (1,249 سطراً، SHA-256 `48926fd09492654593fd1168b5467de642ba3157257c38140adf31e6088bc68f`). لم يُدمج كخارطة ثانية (الخارطة واحدة، 14.1)، بل:
  - `docs/tools/ARSENAL.md`: 517 أداة فريدة في 65 قسماً وتسع طبقات، لكل أداة رابط الكتالوج وموقعها في الخارطة (يُستخرج آلياً من صفوف TR والمهام) وحالتها. يولّده `tools/catalog/arsenal.py` من `tools/catalog/arsenal.json`.
  - 55 أداة في `tools/catalog/curated.json` (47 جديدة على الكتالوج)؛ الكتالوج 10,881 أداة.
  - TR-081..TR-088، والمهام P2-031 وP4-023 وP5-025..P5-027 وP8-023 وP8-024، والقسم 14.8 (التوزيع، أولويات الملحق د مقابل الخارطة، التصحيحات).
  - النص الأصلي في `docs/archive/ROADMAP2-arsenal-original-2026-10-10.md`.
- الأدلة: `python3 tools/catalog/arsenal.py` → في الخارطة 105، مكدس المشروع 26، في الكتالوج 219، مرشح 151، متوقف 8، مستبعد 8. كل الإضافات الجديدة تستجيب عند الفحص (Perma.cc 403 مقيّد). توقف Mozilla/Firefox Monitor وCuckoo موثق بمصدر في 14.8.
- إصلاح عرضي: مرشح الروابط في `build.py` كان يستبعد أي نطاق ينتهي بـ `t.me/` (مثل `oxt.me`) ظناً أنه تيليجرام؛ صار `//t.me/`. لا أثر على الكتالوج الحالي إلا عند إعادة البناء الكامل.
- ما لم يتم: 151 أداة «مرشح» بلا رابط موثق بعد؛ تُضاف إلى `curated.json` عند الحاجة. OXT لا يستجيب فلم يُضف.
- التالي: دمج الطلب وإغلاق #6–#9، ثم المرحلة 1 (P1-001).

### 2026-10-10 — [P0-029] دمج تحديثات npm من Dependabot
- المنفّذ: وكيل آلي (Perplexity Computer).
- ما تم: فتح Dependabot خمسة طلبات npm تتعارض كلها على `pnpm-lock.yaml`. اختُبر كل طلب منفرداً في worktree مستقل (install، lint، build، test): #10 (مجموعة minor/patch، 54 تحديثاً) و#12 (vite 7→8) و#13 (chokidar 4→5) و#14 (vitest 3→5) نجحت؛ #11 (recharts 2→3) يكسر typecheck في `mockup-sandbox/src/components/ui/chart.tsx` (TS2339 على `payload` و`label`، وTS7006). طُبّقت تعديلات #10 و#12–#14 على `package.json` و`pnpm-workspace.yaml` بدمج ثلاثي، وحُلّ تعارض كتالوج `pnpm-workspace.yaml` بأخذ نسخ #10 مع `vite: ^8.3.3` من #12، ثم أُعيد توليد ملف القفل مرة واحدة. أضيفت قاعدة `ignore` لتحديثات recharts الكبرى في `.github/dependabot.yml` حتى نقل `mockup-sandbox` إلى `packages/ui` في المرحلة 3.
- الأدلة: بعد الدمج: `pnpm run lint` و`typecheck` و`build` و`test` (8) ناجحة؛ `pnpm install --frozen-lockfile` ناجح؛ في ملف القفل نسخة واحدة لكل من vite (8.3.4) وvitest (5.0.3) وyaml (2.9.1).
- ما لم يتم: recharts 3 مؤجل بسبب موثق أعلاه؛ يُغلق #11 بإحالة إلى هذا الإدخال.
- التالي: دمج #15 وإغلاق #6–#14، ثم P1-001.

### 2026-10-10 — [P1-001] إعادة هيكلة مساحة العمل إلى `apps/*` و`packages/*`
- المنفّذ: وكيل آلي (Perplexity Computer)، بداية المرحلة 1 بطلب المالك «ابدأ بناء المشروع».
- ما تم: `git mv` (يحفظ التاريخ): `artifacts/investigation-room` → `apps/web` (`@ir/web`)، `artifacts/api-server` → `apps/server` (`@ir/server`)، `artifacts/mockup-sandbox` → `apps/sandbox` (`@ir/sandbox`، مؤقتاً حتى P3-001). فُتح `packages/*` في `pnpm-workspace.yaml` مع `packages/README.md` (قواعد الحزمة). حُدّثت المسارات والأسماء في: `package.json` (typecheck يشمل `apps/**` و`packages/**`)، `vitest.config.ts`، `eslint.config.mjs`، `scripts/audit/measure.mjs`، ملفات `.replit-artifact/artifact.toml` الثلاثة، README وAGENTS وreplit.md وDEVELOPMENT وARCHITECTURE والقسم 5.3. بقيت `lib/*` كما هي (5.3).
- الأدلة: `pnpm install` ثم `pnpm run lint` و`typecheck` و`build` و`test` (8) و`audit:measure` ناجحة؛ `node apps/server/dist/index.mjs` يجيب `/api/healthz` بـ `{"status":"ok"}`؛ `apps/web/dist/public/index.html` يُبنى.
- إصلاح في الخطاف: `lint-staged` كان يعيد تنسيق الملفات المنقولة فيحوّل النقل إلى حذف وإضافة (153 ملفاً بدل إعادة تسمية). صار `.githooks/pre-commit` يمرر `--diff-filter=ACM` فلا تُلمس ملفات النقل (R)، ويبقى تاريخها متصلاً (`git log --follow`).
- ما لم يتم: معرّف عنصر الواجهة في Replit (`id = "artifacts/investigation-room"`) أُبقي كما هو لأنه مفتاح ثابت؛ [للتحقق] أن Replit يكتشف `.replit-artifact` خارج `artifacts/` عند فتح المستودع فيه. D-043 يبقى مفتوحاً حتى P3-001.
- التالي: P1-002 (`@ir/schema`) وP1-019 (الساعة والمولّد القابلان للحقن).

### 2026-10-10 — [P1-019] ساعة ومولّد قابلان للحقن
- المنفّذ: وكيل آلي (Perplexity Computer).
- ما تم: أول حزمة نواة `packages/core` (`@ir/core`): واجهة `Clock` (`systemClock`، `manualClock` لا يرجع إلى الوراء) و`Random` (`cryptoRandom`، `seededRandom` حتمي لعالم المحاكاة والاختبارات) و`ulidFactory(clock, random)` وفق مواصفة ULID، رتيب داخل الملّي ثانية نفسها وعند رجوع الساعة، و`ulidTime()`. قاعدة ESLint تمنع `Date.now()` و`new Date()` و`Math.random()` في `packages/core` و`packages/schema` و`packages/ledger` (عدا `clock.ts` والاختبارات)، فلا يدخل وقت أو عشوائية غير محقونة إلى النواة (5.2، D1، D11).
- الأدلة: `packages/core/src/clock.test.ts` (6 اختبارات): حتمية بالحقن، 1,000 معرّف فريد مرتب في الملّي ثانية نفسها، بادئة الوقت `01ARYZ6S41` لمثال المواصفة (1469918176385)، الرتابة عند رجوع الساعة. ملف تجريبي يستدعي `Date.now()` و`Math.random()` يُرفض برسالتي P1-019.
- ما لم يتم: —
- التالي: P1-002.

### 2026-10-10 — [P1-002] `@ir/schema`: مخططات نموذج البيانات
- المنفّذ: وكيل آلي (Perplexity Computer).
- ما تم: `packages/schema` (`@ir/schema`) بمخططات Zod v4 (من نسخة الكتالوج 3.25.76، المسار `zod/v4`) للكيانات الإحدى عشرة في 5.4: `Case` و`Entity` و`Identifier` و`Observation` و`Claim` و`Evidence` و`LedgerEntry` و`MergeDecision` و`AuditEvent` و`TransformManifest` و`ViewState`. القيود من الخارطة صارت قواعد تحقق: غرض لا يقل عن 10 أحرف وأساس من قائمة مغلقة (E-01)، سياسة احتفاظ (E-09)، `canonicalKey` بصيغة `<type>:<normalized>` ويبدأ بنوع الكيان (D-020، D-021)، ملاحظة إيجابية أو سلبية أو خطأ على كيان واحد أو ادعاء واحد (D3)، الحافة ادعاء بمسند مُنمَّط وكائن واحد فقط وصلاحية زمنية مرتبة (D-025، D4)، `blobRef` يطابق SHA-256 وترويسات الأسرار ممنوعة في الطلب المحفوظ (5.5)، الإدخال الأول وحده بلا `prevHash`، الناجي في الدمج أحد المدموجين (D9)، بيان المحوّل بقائمة شبكة وأسرار وحدود وفئة ترخيص (D7)، وحالة العرض منفصلة (D-026). `SCHEMAS` و`toJsonSchemas()` يولّدان JSON Schema 2020-12 في `packages/schema/json/` (`pnpm --filter @ir/schema run gen:jsonschema`).
- الأدلة: `packages/schema/src/schema.test.ts` (19 اختباراً): تسلسل وفك تسلسل ثابت لكل نموذج، ورفض الحالات المخالفة أعلاه، وتطابق ملفات JSON Schema المولّدة مع المخططات. `pnpm test` = 33 ناجحاً؛ lint وtypecheck وbuild ناجحة.
- ما لم يتم: D-036 (حفظ الاستجابة الخام ومصدرها) يكتمل بالتخزين في P1-009 وP1-010؛ النموذج `Evidence` جاهز له.
- التالي: P1-007 (التطبيع والمفتاح القانوني) وP1-009 (السجل).

### 2026-10-10 — [P1-023] إصلاح تنبيهات CodeQL الموروثة
- المنفّذ: وكيل آلي (Perplexity Computer).
- ما تم: بعد النقل في P1-001 أظهر CodeQL تنبيهين قديمين كأنهما جديدان (تغيّر المسار): (1) `js/incomplete-url-substring-sanitization` (متوسط) في `VideoNode.tsx`: كان يقبل أي رابط يحتوي `youtube.com` فيضمّن إطاراً لمضيف آخر. صار `apps/web/src/utils/youtube.ts` يحلل الرابط ويقبل مضيفات YouTube المعروفة وبروتوكول http/https ومعرّفاً بصيغة صحيحة فقط. (2) `js/bad-code-sanitization` (عالٍ) في `apps/sandbox/mockupPreviewPlugin.ts`: المسارات المكتشفة تُكتب في وحدة مولّدة بـ `JSON.stringify`؛ صارت تمر بدالة `literal()` تهرّب `<>/\` وفواصل الأسطر و`U+2028/2029`.
- الأدلة: `apps/web/src/utils/youtube.test.ts` (2): يقبل `www.youtube.com/watch?v=` و`youtu.be/`، ويرفض `youtube.com.evil.example` و`?u=youtube.com` و`javascript:` ومعرّفاً فيه `<script>`. `literal()` يعيد بالتقييم القيمة الأصلية نفسها لمسار عادي ولنص فيه `"</script>\` وسطر جديد و`U+2028`. بناء `apps/sandbox` ناجح؛ `pnpm test` = 35.
- ما لم يتم: —
- التالي: دمج طلب المرحلة 1، ثم P1-007 وP1-009.

### 2026-10-10 — [P1-007] التطبيع والمفتاح القانوني
- المنفّذ: وكيل آلي (Perplexity Computer) بطلب المالك «نفذ P1-007 وP1-009».
- ما تم: `packages/core/src/normalize.ts`: `normalize(type, raw)` و`canonicalKey(type, raw)` = `<type>:<normalized>` و`parseCanonicalKey()`. خطوة عامة لكل الأنواع: NFKC، حذف المحارف الخفية وعلامات الاتجاه، قص الفراغات، وتحويل الأرقام العربية الهندية إلى ASCII (عدا النص الحر والترميزات الحساسة لحالة الأحرف). ثم مطبِّع لكل عائلة من معرّفات `identifierList` الـ 371: النطاقات (أحرف صغيرة، punycode، بلا نقطة أخيرة)، البريد، الروابط (بلا fragment ولا منفذ افتراضي)، IPv4 (بلا أصفار بادئة) وIPv6 (RFC 5952) وCIDR، ASN بصيغة `AS…`، MAC، الهواتف (`+` من `00`، الأرقام فقط؛ E.164 الكامل مع TR-036)، عناوين EVM بأحرف صغيرة، bech32 (يرفض الحالة المختلطة)، التجزئات بأحرف صغيرة، IBAN وBIC وLEI وISIN والهويات بأحرف كبيرة مضغوطة، البطاقات وIMEI أرقاماً، أسماء المستخدمين بلا `@` وبأحرف صغيرة. الترميزات الحساسة لحالة الأحرف (base58، base64، المفاتيح والرموز) تبقى كما هي. القيمة التي لا تصلح لنوعها ترمي `NormalizeError`.
- ربط بالتطبيق الحالي: `apps/web/src/utils/smartInvestigator.ts` صار يبني `nodeId` بـ `canonicalKey` ويزيل التكرار على المفتاح لا النص الخام، ويرجع إلى `text` إن لم تصلح القيمة لنوعها المكتشف. بهذا أُغلق D-020 (`Example.com` و`example.com` عقدتان) وD-021 (القطع عند 64 حرفاً واستبدال الرموز).
- الأدلة: `normalize.collision.test.ts`: 100,000 مُدخل مختلف من 9 عائلات (منها 11,000 رابط تشترك في أول 70 حرفاً، فكانت كلها ستصير عقدة واحدة بالمعرّف القديم) تعطي 100,000 مفتاح بلا تصادم، وكل صيغة بديلة (أحرف كبيرة، أصفار بادئة، `:443` و`#frag`، أرقام عربية، `@`، فراغات ومحارف خفية) تعطي مفتاح الأصل نفسه، في نحو ثانيتين. `normalize.test.ts` (36): تكافؤات منها `مثال.إختبار` = `xn--mgbh0fb.xn--kgbechtv` و`+٩٦٦٥٠١٢٣٤٥٦٧` = `+966501234567`، وحالات تصادم المعرّف القديم، و12 رفضاً. `smartInvestigator.test.ts` (3). `pnpm test` = 75.
- ما لم يتم: الأسماء العربية (التطبيع الإملائي والتحويل الصوتي) في `@ir/arabic` (المرحلة 5)؛ صحة المجاميع (Luhn، IBAN، EIP-55) في P1-005.
- التالي: P1-009.

### 2026-10-10 — [P1-009] `@ir/ledger`: سلسلة تجزئة + JCS
- المنفّذ: وكيل آلي (Perplexity Computer).
- ما تم: حزمة `packages/ledger` (`@ir/ledger`):
  - `canonicalize()` وفق RFC 8785 (JCS). يرفض ما ليس JSON صرفاً بدل إسقاطه بصمت.
  - `hashEntry()`: `SHA-256(JCS(["ir-ledger/1", prevHash, seq, kind, at, actor, payload]))`. يغطي كل الحقول المحفوظة؛ صيغة 5.5 الأولى لم تغطِّ `at` و`actor`، فصُححت في 5.5 بقرار ADR-06.
  - `Ledger`: إضافة فقط، بالساعة المحقونة (P1-019)، وتحقق المخطط من `@ir/schema`. الإدخالات مجمّدة، والحمولة تُلتقط عند الإضافة، والمخزن الفاسد يُرفض عند الفتح. واجهة `LedgerStore` للتخزين (SQLite في P1-013).
  - `verify()`: يعيد كل خطأ بموضعه ونوعه (`entry_hash`، `seq`، `prev_hash`، `payload`، `schema`، `head`، `length`).
  - كُتب `docs/adr/ADR-06-evidence-ledger.md`، وعُرّفت T-LED-002..004 و006..010 في جدول الاختبارات (كان معرّفاً منها 001 و005 فقط).
- الأدلة: `jcs.test.ts` (16): مثال RFC 8785 3.2.2، وترتيب 3.2.3 بوحدات UTF-16، و12 رقماً من الملحق B، وثبات الناتج مع ترتيب المفاتيح والنص العربي، و12 قيمة مرفوضة. `ledger.test.ts` (12): T-LED-001..008 و010، واختبار شامل يغيّر كل حرف في كل إدخال من سلسلة من 4 إدخالات، حرفاً واحداً في كل مرة: 993 تعديلاً يبقى بعدها JSON صالحاً، وكلها اكتُشفت. `pnpm test` = 103؛ lint وtypecheck وbuild ناجحة.
- ما لم يتم: قص الذيل لا يُكتشف إلا مقابل رأس معروف، والرأس الموقّع يأتي في P1-011 (موثق في T-LED-008 وADR-06). D-036 يبقى مفتوحاً حتى مخزن الأدلة الخام في P1-010.
- التالي: P1-010 (مخزن الأدلة بعنونة المحتوى) وP1-011 (التوقيع بـ Ed25519).

### 2026-10-10 — [P1-023] تنبيه CodeQL على أنماط العائلات في `normalize.ts`
- المنفّذ: وكيل آلي (Perplexity Computer).
- ما تم: نبّه CodeQL (`js/regex/missing-regexp-anchor`) إلى أنماط في `FAMILIES` تخلط بديلاً مثبتاً في البداية وآخر في النهاية (`^phone_|_number$`)، فيسهل أن يُقرأ التثبيت خطأً. قُسّم كل نمط مركّب إلى أنماط مستقلة مثبتة بالكامل (`^phone_` و`_number$`، و`(?:^|_)url$` و`^url_`، وهكذا)، بالترتيب نفسه وبالمطبِّعات نفسها.
- الأدلة: اختبارات `packages` الـ 90 (منها اختبار المئة ألف) ناجحة بلا تغيير.
- ما لم يتم: —
- التالي: إزالة Replit (P1-024).

### 2026-10-10 — [P1-024] إزالة Replit وتشغيل مستقل
- المنفّذ: وكيل آلي (Perplexity Computer) بقرار المالك: «لا حاجة لـ Replit، سيُشغَّل المشروع عبر Render أو Railway أو أي منصة أخرى أو جهاز محلي».
- ما تم:
  - حُذفت ملفات Replit: `.replit` و`.replitignore` و`replit.md` و`scripts/post-merge.sh` وملفات `.replit-artifact` الثلاثة. وأُزيلت إضافات `@replit/vite-plugin-*` من الواجهة ومعاينة المكونات ومن كتالوج `pnpm-workspace.yaml` واستثناءاته، مع الإشارات في GOVERNANCE وAGENTS و`.gitignore` والخارطة والحالة. صار R-19 «الارتباط بمنصة استضافة واحدة»، وهو مُعالج.
  - `PORT` و`BASE_PATH` اختياريان: الخادم على 8080 افتراضياً، وخادم تطوير الواجهة على 5173 ويحوّل `/api` إلى الخادم (`API_URL`).
  - الخادم يقدّم الواجهة المبنية (`WEB_DIST`، وكل مسار غير `/api` يعود إلى `index.html`)، فيعمل المشروع خدمة واحدة. أضيف `pnpm start`.
  - ملفات النشر: `Dockerfile` (بناء متعدد المراحل على Node 24، يعمل بالمستخدم `node`، وفيه فحص صحة)، و`.dockerignore`، و`render.yaml` (Blueprint يعتمد `autoDeployTrigger: checksPass` بدل `autoDeploy` المهجور حسب [مرجع Render](https://render.com/docs/blueprint-spec))، و`railway.json` (بناء من Dockerfile حسب [مرجع Railway](https://docs.railway.com/reference/config-as-code)).
  - مهمة `docker` في CI تبني الصورة وتتحقق من `/api/healthz` ومن الصفحة العربية.
- الأدلة: نسخة من `apps/server/dist` و`apps/web/dist/public` وحدهما، بلا `node_modules`، تجيب `/api/healthz` بـ `{"status":"ok"}` و`/` بالصفحة RTL، ومسار الواجهة `/case/123` بـ 200، و`/api/nope` بـ 404. `pnpm run build` يعمل بلا متغيرات بيئة. وخادم تطوير الواجهة يجيب 200. lint وtypecheck وtest (103) و`audit:measure` ناجحة. بناء الصورة يُختبر في CI لعدم توفر Docker في بيئة التنفيذ.
- ما لم يتم: إدخالات WORKLOG السابقة والملفات المؤرشفة في `docs/archive/` تبقى كما هي (WORKLOG إضافة فقط، GR-09)، وفيها ذكر تاريخي لـ Replit.
- التالي: P1-005 (المدققات) وP1-010 وP1-011.

### 2026-10-10 — [P1-024] حد معدل لتقديم الواجهة
- المنفّذ: وكيل آلي (Perplexity Computer).
- ما تم: نبّه CodeQL (`js/missing-rate-limiting`) إلى أن مسار تقديم الواجهة يقرأ من نظام الملفات بلا حد. أضيف `express-rate-limit` (600 طلب في الدقيقة لكل عميل، بترويسات `RateLimit` القياسية) على الملفات الثابتة والمسار الاحتياطي. مسارات `/api` خارج هذا الحد؛ حدودها تأتي مع المحرك ووكيل الخروج في المرحلة 2.
- الأدلة: الاستجابة على `/` تحمل `RateLimit: "600-in-1min"; r=599`؛ و`/api/healthz` سليم؛ lint وtypecheck وtest ناجحة.
- ما لم يتم: —
- التالي: P1-005.

### 2026-10-10 — [P1-024] تنظيف آخر إشارة في عنوان المهمة
- المنفّذ: وكيل آلي (Perplexity Computer).
- ما تم: عنوان المهمة P1-024 ودليلها في الخارطة والحالة كانا يذكران اسم المنصة السابقة؛ صارا «منصة الاستضافة السابقة».
- الأدلة: البحث عن الاسم في ملفات المشروع الحية (غير WORKLOG والأرشيف) لا يعيد شيئاً.
- ما لم يتم: —
- التالي: P1-005.

### 2026-10-10 — [P1-005] المدققات بمتجهات رسمية
- المنفّذ: وكيل آلي (Perplexity Computer).
- ما تم: مدققات بنيوية للمعرّفات في `@ir/core` دون أي اعتماد خارجي، تعمل كما هي في المتصفح والخادم:
  - `hash.ts`: SHA-256 وKeccak-256 وSHA3-256 مكتوبة بلغة TS صرفة. Keccak ضروري لـ EIP-55، وSHA3 يشاركه دالة التبديل نفسها فيتيح مقارنته بـ node:crypto.
  - `luhn`، و`checkIban` (سجل SWIFT لـ 89 دولة: الطول وبنية BBAN وmod-97، مع سبب الرفض)، و`isValidIsin` (ISO 6166).
  - `checkEip55` و`toChecksumAddress` (يُقبل العنوان كله بأحرف صغيرة أو كله بأحرف كبيرة بلا checksum، ويُرفض المختلط إن خالف الـ checksum).
  - `base58`/`base58CheckDecode`، و`bech32Decode` (Bech32 وBech32m)، و`decodeSegwitAddress` (قواعد BIP-350 وBIP-141)، و`decodeBitcoinAddress` (يعيد scriptPubKey والشبكة).
  - `isIPv4` و`isIPv6` بصرامة: لا أصفار بادئة، ولا معرّف zone.
  - `@ir/core/psl`: قائمة اللواحق العامة (10,018 قاعدة و310 wildcard و8 استثناءات) مع `publicSuffix` و`registrableDomain` و`isRegistrableHost`. هي مسار فرعي مستقل حتى لا تُحمَّل 150 KB إلا حيث تلزم.
  - `validate(type, normalized)` و`validatorFor(type)` تربط 33 نوعاً من الكتالوج بمدققاتها، وتميّز بين «صالح» و«غير صالح» و«لا مدقق له» (null). الاسم المعاد يُخزَّن في `Identifier.validator`.
  - البيانات مأخوذة من مصادرها في `packages/core/data` (iban.dat من python-stdnum عن سجل SWIFT، وpublic_suffix_list.dat)، وتُولَّد منها الوحدات بـ `pnpm --filter @ir/core run gen:data`.
- الأدلة: 62 اختباراً في `packages/core` (منها 19 جديدة؛ المجموع في المستودع 122) بمتجهات من مصادرها كما هي:
  - BIP-173 وBIP-350: سلاسل checksum صالحة وغير صالحة، وعناوين segwit مع scriptPubKey. عناوين v1+ المكتوبة بـ Bech32 في BIP-173 تُرفض كما يقتضي BIP-350.
  - EIP-55 بحالاته الثلاث، مع قلب حالة كل حرف.
  - Bitcoin Core: `key_io_valid.json` (54 عنواناً تطابق scriptPubKey) و`key_io_invalid.json` (70 مرفوضة) و`base58_encode_decode.json`.
  - ملف `test_psl.txt` الرسمي كاملاً.
  - Luhn وmod-97: كل استبدال لرقم واحد يُكتشف.
  - IP: مطابقة مع `node:net` على 20,000 مدخل مولّد.
  - مفاتيح WIF الخاصة في متجهات Bitcoin Core استُبعدت من الملفات المحفوظة.
- ما لم يتم: الهواتف (libphonenumber) خارج نطاق هذه المهمة وتأتي مع P5-005. وربط `validate()` بالكشف يأتي في P1-006. وD-029 مفتوح جزئياً: الأنواع EVM الأربعة تمر الآن بمدقق EIP-55 صريح، لكن التمييز بين السلاسل يحتاج P2-010.
- التالي: P1-006 (محرك الكشف متعدد المرشحين)، P1-010، P1-011.

### 2026-10-10 — [P1-010] مخزن الأدلة بعنونة المحتوى
- المنفّذ: وكيل آلي (Perplexity Computer).
- ما تم: في `packages/ledger`:
  - `blobs.ts`: واجهة `BlobStore` مع `fsBlobStore(root)` (`blobs/<sha256[0:2]>/<sha256>` مضغوطاً بـ zstd من `node:zlib`) و`memoryBlobStore()`. العنوان SHA-256 للبايتات قبل الضغط، وكل قراءة تفك الضغط وتعيد التجزئة، فلا يُعاد دليل تغيّر منه بايت؛ الخطأ `BlobIntegrityError` بسببه (`missing` أو `corrupt` أو `mismatch`). الكتابة ذرّية (ملف مؤقت ثم rename)، ومتكررة بلا أثر، وتستبدل نسخة تالفة سابقة. العنوان غير السداسي يُرفض فلا يمكن الخروج من المجلد.
  - `evidence.ts`: `redactRequest` تحذف ترويسات الاعتماد (القائمة في `@ir/schema`، وما يحمل token أو secret أو api-key أو signature أو session)، وتستبدل قيم مفاتيح الرابط (key وapi_key وtoken وsig وpassword وغيرها) وuserinfo بعلامة `[REDACTED]`. `storeEvidence` تحفظ البايتات وتضيف إدخال `evidence.stored` بسجل `Evidence` (المعرّف والبصمة والحجم وblobRef والطلب المنقّح والمحوّل والإصدار). `verifyEvidence` تعيد قراءة كل دليل في السلسلة.
  - عُرّفت T-LED-016..019 في جدول الاختبارات.
- الأدلة: `evidence.test.ts` (5):
  - T-LED-016: قلب البتّين 0x01 و0x80 في كل بايت من الملف المضغوط يُرفض كله؛ والاستبدال بمحتوى صالح آخر يُرفض (`mismatch`)، والحذف كذلك (`missing`).
  - T-LED-017: 100 KB تصبح أقل من 1 KB على القرص، وتبدأ بترويسة zstd ‏`28 b5 2f fd`.
  - T-LED-018: لا يبقى أي من الأسرار الستة في السجل.
  - T-LED-019: حذف دليل واستبدال آخر يُحددان بالموضع والسبب.
- ما لم يتم: zstd يحتاج Node 22.15 أو أحدث، والمشروع على Node 24 في CI وDocker (`engines`). D-036 مفتوح جزئياً حتى P2-007 (الكاش).
- التالي: P1-011.

### 2026-10-10 — [P1-011] التوقيع بـ Ed25519 ونقاط التثبيت
- المنفّذ: وكيل آلي (Perplexity Computer).
- ما تم: في `packages/ledger`:
  - `merkle.ts`: جذر Merkle وإثبات التضمين وخوارزمية التحقق، كلها وفق RFC 9162 (الورقة والعقدة بفصل المجال 0x00 و0x01).
  - `signing.ts`: مفتاح التثبيت Ed25519 (`generateInstallationKey`، و`loadOrCreateInstallationKey(dir)` يحفظه PKCS#8 بصلاحية 0600 ومعه `installation.pub`، و`keyIdOf`). نقطة التثبيت `ir-checkpoint/1` تُوقّع على JCS للحمولة. `checkpoint(ledger, key)` تضيفها إلى السلسلة كإدخال `checkpoint` وتعيدها للنشر خارجها. `verifyCheckpoint` و`verifyEmbeddedCheckpoints` للتحقق.
  - حُدّثت ADR-06 (الحالة: مُنفّذ، مع صيغ نقطة التثبيت والتوقيع وkeyId والبدائل) و5.5، وعُرّفت T-LED-011..015، وصُحّح تعليق `LedgerEntry` القديم في `@ir/schema`.
- الأدلة: `signing.test.ts` (5):
  - T-LED-011: نقطة التثبيت لا تمر إلا بمفتاح التثبيت نفسه؛ أي تعديل في الحمولة أو قلب بت في التوقيع يُرفض.
  - T-LED-012: كل قص للذيل من 7 إلى 1 يُكتشف `truncated`، مع أن البادئة وحدها تمر في `verify`.
  - T-LED-013: تزوير متسق داخلياً يمر في `verify` ويسقط بـ `head` و`root`، والنقطة المضمّنة في السلسلة تكشفه أيضاً.
  - T-LED-014: إثبات التضمين يتحقق لكل ورقة في كل حجم من 1 إلى 33 (561 حالة)، ويفشل عند تغيير الإثبات أو الورقة أو الموضع.
  - T-LED-015: المفتاح الخاص غائب عن السلسلة ونقطة التثبيت، ومحفوظ بصلاحية 0600، ومفاتيح RSA مرفوضة.
  - مجموع `packages/ledger` ‏38 اختباراً.
- ما لم يتم: الختم الزمني RFC 3161 (اختياري، يحتاج خادم TSA يختاره المستخدم) وتوقيع حزم التصدير (P5). وتدوير المفتاح يُوثَّق مع P1-015 (خزنة المفاتيح).
- التالي: P1-013 (تخزين القضية SQLite) يربط LedgerStore وBlobStore بالقرص، ثم P1-003/P1-004 وP1-006.

### 2026-10-10 — [P1-011] إزالة سباقات نظام الملفات (CodeQL)
- المنفّذ: وكيل آلي (Perplexity Computer).
- ما تم: نبّه CodeQL (`js/file-system-race`) إلى فحص الوجود ثم الاستعمال. صار إنشاء `installation.key` ذرّياً: `open(..., "wx", 0o600)` ثم `fchmod` على الواصف نفسه، وإن كان الملف موجوداً (`EEXIST`) يُقرأ، فلا يمكن لعمليتين أن تكتبا مفتاحين مختلفين. وفي `fsBlobStore` صارت القراءة مباشرة مع معالجة `ENOENT` بدل `existsSync`، وفي الاختبار صار الملف يُقرأ مرة واحدة.
- الأدلة: اختبارات `packages/ledger` الـ 38 ناجحة، وlint وtypecheck ناجحان.
- ما لم يتم: —
- التالي: P1-013.

### 2026-10-10 — [P1-011] قراءة مفتاح التثبيت عبر الواصف
- المنفّذ: وكيل آلي (Perplexity Computer).
- ما تم: بقي تنبيه `js/file-system-race` على قراءة المفتاح الموجود بالمسار بعد محاولة الإنشاء. صار يُفتح للقراءة ويُقرأ عبر الواصف نفسه ثم يُغلق.
- الأدلة: اختبارات `packages/ledger` الـ 38 ناجحة.
- ما لم يتم: —
- التالي: P1-013.

### 2026-10-10 — [P1-011] فتح واحد لملف مفتاح التثبيت
- المنفّذ: وكيل آلي (Perplexity Computer).
- ما تم: بقي تنبيه `js/file-system-race` لأن المسار يُفتح مرتين (محاولة إنشاء ثم قراءة). صار يُفتح مرة واحدة (`O_RDWR | O_CREAT`، 0600)، وكل ما بعدها يمر عبر الواصف: `fchmod`، ثم `fstat`، ثم قراءة المفتاح الموجود أو كتابة مفتاح جديد إن كان الملف فارغاً. لم يُغلق التنبيه يدوياً.
- الأدلة: اختبارات `packages/ledger` الـ 38 ناجحة، ومنها T-LED-015 (إعادة الفتح تعيد المفتاح نفسه، والصلاحية 0600).
- ما لم يتم: لو بدأت عمليتان التثبيت الأول في اللحظة نفسها فقد تكتبان معاً. التثبيت يحدث مرة واحدة عند أول تشغيل، فالخطر ضئيل، ويُعالَج بقفل في خزنة المفاتيح (P1-015).
- التالي: P1-013.

### 2026-10-10 — [P1-025] تنبيهات CodeQL القديمة على main
- المنفّذ: وكيل آلي (Perplexity Computer).
- ما تم: على الفرع الرئيسي 8 تنبيهات مفتوحة من كود سابق لهذه الأعمال:
  - `scripts/governance/set-status.mjs` (4 تنبيهات `js/regex-injection`): معرّفات الوسائط تُتحقق من صيغتها (`D-nnn` و`G-nn` و`Pn-nnn`)، ثم تُهرَّب قبل بناء RegExp.
  - `lib/api-client-react/src/custom-fetch.ts` (`js/polynomial-redos`): إزالة الشرطات المائلة في آخر عنوان الأساس صارت بحلقة خطية بدل `/\/+$/`.
  - أضيفت المهمة P1-025 إلى الخارطة والحالة.
- الأدلة: `set-status.mjs --defect 'D-0.*'` و`--gate 'G-0('` يُرفضان برسالة الاستعمال (exit 2)، والاستعمال العادي يعمل (هذا الإيداع نفسه). اختبارات الحزم وlint وtypecheck ناجحة.
- ما لم يتم: تنبيهات `js/clear-text-storage-of-sensitive-data` الثلاثة في `apps/web/src/utils/apiKeyManager.ts` سببها حفظ مفاتيح المزودين في localStorage. علاجها الصحيح نقل المفاتيح إلى خزنة الخادم حتى لا تعود إلى الواجهة (P1-015، D-030)، لا تشفيرها في المتصفح.
- التالي: P1-013 وP1-014 وP1-015.

### 2026-10-10 — [P1-013] تخزين القضية SQLite + ترحيلات
- المنفّذ: وكيل آلي (Perplexity Computer).
- ما تم: حزمة `packages/store` (`@ir/store`) وADR-04 (مُقرّر بتفويض ومُنفّذ):
  - المحرك `node:sqlite` المدمج في Node 24 بدل `better-sqlite3` مع SQLCipher، فلا وحدة أصلية تُبنى على Render وRailway وDocker. التشفير ينتقل إلى مستوى التطبيق في P1-014. المسار في الخارطة صار `packages/store` بدل `apps/server/storage`، لأن الخادم وأمر `ir verify` (P1-012) يستعملانها معاً.
  - `migrations.ts`: ثلاثة ترحيلات:
    - v1: `schema_migrations` و`meta` و`ledger` بقيود CHECK.
    - v2: `audit_events` لـ P1-017.
    - v3: فهرس `evidence`.
    - قواعد `migrate()`: كل ترحيل في معاملة، والإصدار في `user_version`، وبصمة كل ترحيل محفوظة. تُرفض القاعدة الأحدث (`newer`) والترحيل المعدّل (`drift`) والفجوة في الترقيم (`gap`)، ويُتراجع عن الترحيل الفاشل.
  - مشغّلات «إضافة فقط» على `ledger` و`audit_events` و`evidence`.
  - `sqliteLedgerStore`: الحمولة تُحفظ بنص JCS نفسه الذي جُزّئ.
  - `openCase(dir)`: يفتح `case.sqlite` بجانب `blobs/`، مع WAL وFULL sync وقيود المفاتيح الأجنبية. `addEvidence` يحفظ الدليل في السلسلة والفهرس داخل معاملة واحدة. الوضع `readOnly` للتحقق.
- الأدلة: `store.test.ts` (6):
  - الترحيل من قاعدة فارغة إلى الأحدث، وإعادة تشغيله بلا أثر.
  - الترقية من كل إصدار وسيط (v0 إلى v3) تعطي مخططاً مطابقاً لقاعدة جديدة.
  - رفض `newer` و`drift` و`gap`، وتراجع كامل عن ترحيل فاشل.
  - المشغّلات ترفض UPDATE وDELETE، وقيد `seq=0 ⇔ prevHash=NULL` يعمل.
  - القضية تبقى بعد إعادة الفتح: `verify` و`verifyEvidence` ناجحان، والقراءة فقط تمنع الكتابة.
  - تعديل السلسلة بعد حذف المشغّل يُرفض عند الفتح (`corrupt`).
- ما لم يتم: D-033 وD-035 يخصّان تخزين الواجهة (Zustand persist وDexie)، ويُغلقان حين تنتقل الواجهة إلى الخادم (P1-021). وإذا فشلت معاملة `addEvidence` قد يبقى blob يتيم؛ هذا لا يضر لأنه معنون بالمحتوى، والتنظيف يأتي مع الحذف الآمن في P3.
- التالي: P1-012 (`ir verify`)، ثم P1-014 وP1-015.

### 2026-10-10 — [P1-012] أمر `ir verify`
- المنفّذ: وكيل آلي (Perplexity Computer).
- ما تم:
  - `verifyCase(dir, {publicKeyPem, checkpoint})` في `@ir/store`: يفتح القضية للقراءة فقط بلا ترحيلات، ويجمع في تقرير واحد:
    - السلسلة: `verify`، مع الطول المعروف من نقطة التثبيت المنشورة.
    - الأدلة: إعادة تجزئة كل blob.
    - نقاط التثبيت المضمّنة.
    - نقطة التثبيت المنشورة، لكشف القص وإعادة كتابة التاريخ.
    - إصدار المخطط.
  - `formatReport` يعرض كل قسم PASS أو FAIL، والتحقق من التوقيع يظهر SKIP، لا PASS، إن لم يُعطَ مفتاح.
  - `Ledger` قبل الخيار `skipVerify`، و`openCase` قبل `skipChainCheck`، حتى يعرض المدقق الخلل بدل أن يرفض فتح القضية. والحمولة غير القابلة للتحليل تُعرض خطأ `entry_hash` بدل أن تُسقط العملية.
  - `packages/cli` (`@ir/cli`): الأمر `ir verify <case> [--key] [--checkpoint] [--json]` بـ `node:util parseArgs`. رموز الخروج: 0 سليم، و1 خلل، و2 استعمال أو قراءة.
  - يُحزم بـ esbuild في `dist/ir.mjs` ليعمل بلا `node_modules`، ونُسخ إلى صورة Docker، وتشغّل مهمة CI الأمر `--help` داخل الصورة. أضيف `pnpm ir` للتطوير.
  - وُثّق في 5.5 وفي DEVELOPMENT.
- الأدلة: `ir.test.ts` (4):
  - قضية سليمة تمر كل أقسامها بـ exit 0، ونتيجة `--json` مطابقة.
  - بلا مفتاح يظهر SKIP.
  - صف سلسلة معدّل: `[entry_hash] entry 0`. وblob مستبدل: `[corrupt] entry 1`. وذيل محذوف خلف نقطة تثبيت منشورة: `[truncated]`. كلها exit 1.
  - أخطاء الاستعمال exit 2.
  - الحزمة المنسوخة وحدها إلى /tmp تحققت من قضية بنجاح.
- ما لم يتم: تحقق إعادة التشغيل (replay) بايتاً ببايت يأتي مع المحرك في المرحلة 2.
- التالي: P1-014 (تشفير القضية) ثم P1-015 (خزنة المفاتيح).

### 2026-10-10 — [P1-014] تشفير القضية
- المنفّذ: وكيل آلي (Perplexity Computer).
- ما تم:
  - `packages/store/src/crypto.ts`:
    - مفتاح بيانات عشوائي لكل قضية، مغلّف بـ AES-256-GCM تحت مفتاح Argon2id. Argon2id مدمج في `node:crypto` منذ 24.7، لذا رُفع `engines` إلى `>=24.7`.
    - مفاتيح فرعية بـ HKDF.
    - ظرف `aes-256-gcm/1` للحمولات.
    - `encryptedBlobStore`: يضغط بـ zstd ثم يختم بـ GCM، بعنوان HMAC.
    - `changePassphrase` يعيد التغليف فقط.
  - `openCase({ passphrase, kdf })`:
    - ينشئ قضية مشفرة أو يفتحها، و`append` يختم الحمولة.
    - `entries()` و`openEntries()` تفتحان الحمولات.
    - القضية المقفلة: السلسلة مقروءة والمحتوى يرمي `CaseLockedError`.
    - يُرفض ملف مفتاح قضية أخرى، وتُرفض عبارة مرور لقضية غير مشفرة. `meta`: `case_id` و`created_at` و`encryption`.
  - `storeEvidence` صار يقبل أي `Appender`.
  - `verifyCase` و`ir verify`:
    - قسم `encrypted`.
    - الأدلة SKIP بلا عبارة مرور.
    - `[sealed]` للحمولة التي تفشل مصادقتها.
    - عبارة المرور من `--passphrase-file` أو `IR_CASE_PASSPHRASE`، لا من سطر الأوامر.
  - وُسّع ADR-04 بقسم التشفير، وحُدّث 5.9.
- الأدلة: `crypto.test.ts` (7) و`ir.test.ts` (+1):
  - متجه RFC 9106 §5.3.
  - لا نص ولا بصمة ولا رابط ظاهر في أي ملف من ملفات القضية، وملف المفتاح بإذن 0600.
  - القراءة بلا مفتاح تفشل، وكذلك بعبارة خاطئة، والعبارة الصحيحة تعيد كل شيء.
  - السلسلة ونقاط التثبيت تُتحقق بلا مفتاح.
  - العبث بالظرف يُكشف (`entry_hash` و`sealed`)، والعبث بالدليل يُكشف (`corrupt`).
  - تغيير العبارة يعمل.
  - الحمايات تعمل.
- ما لم يتم:
  - D-035 مفتوح جزئياً: الواجهة ما زالت على Dexie حتى المرحلة 3.
  - مفتاح نظام التشغيل (keychain) بديلاً لعبارة المرور مؤجل.
- إصلاح CodeQL ‏(js/file-system-race ‏#23–24): قراءة `case.key.json` بفتح واحد ومعالجة ENOENT بدل existsSync ثم القراءة، والإنشاء بعلَم `wx`؛ وفي الاختبار `withFileTypes` بدل stat ثم read.
- التالي: P1-015 (خزنة المفاتيح في الخادم، D-030، وتنبيهات CodeQL ‏#13–15).

### 2026-10-10 — [P1-014] إصلاح تنبيه CodeQL في ملف مفتاح القضية
- المنفّذ: وكيل آلي (Perplexity Computer).
- ما تم:
  - تنبيه CodeQL ‏js/file-system-race (#23–24): `case.key.json` صار يُقرأ بفتح واحد مع معالجة ENOENT بدل existsSync ثم القراءة، ويبقى الإنشاء بعلَم `wx`.
  - في الاختبار: `withFileTypes` بدل stat ثم read.
- الأدلة: اختبارات `@ir/store` الـ13 تمر، وفحص CodeQL على طلب الدمج #23.
- ما لم يتم: لا شيء.
- التالي: P1-015.

### 2026-10-10 — [P1-015] خزنة المفاتيح في الخادم
- المنفّذ: وكيل آلي (Perplexity Computer).
- ما تم:
  - `packages/store/src/vault.ts`:
    - ملف `vault.json` بإذن 0600، يختم كل مدخل بـ AES-256-GCM واسمه AAD فلا تُبدَّل المدخلات، مع قيمة تحقق للمفتاح الرئيس.
    - المفتاح الرئيس من `IR_VAULT_KEY` (32 بايت base64)، أو `IR_VAULT_PASSPHRASE` (Argon2id)، أو ملف `vault.key` مولَّد بإذن 0600 للتثبيت المحلي.
    - `list()` تعيد أسماء وأوقاتاً فقط، و`reveal()` للموصلات داخل الخادم فقط. الأسماء مقيّدة بنمط، والقيمة بين 1 و4096 حرفاً، والكتابة ذرية.
  - مسارات الخادم:
    - `GET /api/vault` (الحالة فقط)، و`PUT|DELETE /api/vault/:name`، و`POST /api/vault/:name/test`.
    - `GET /api/lookup/ip/:ip` و`/api/lookup/breaches/:email`: نقلتا من المتصفح إلى الخادم، والمفتاح يذهب في ترويسة للمزود لا في الرابط.
    - حد طلبات 60 في الدقيقة.
    - الإدارة بـ `IR_ADMIN_TOKEN` بمقارنة زمنها ثابت، وبدونه للعميل المحلي (loopback) فقط وبلا `x-forwarded-for`. فالنشر المستضاف مغلق حتى يُضبط الرمز.
  - `TRUST_PROXY` في `app.ts`.
  - Docker: `IR_DATA_DIR=/data` كمجلد قابل للربط. و`render.yaml` يضيف `TRUST_PROXY`، و`IR_VAULT_KEY` و`IR_ADMIN_TOKEN` بـ `generateValue`، وقرصاً على `/data`. وُثّق ذلك في `.env.example` وREADME.
  - الواجهة:
    - `apiKeyManager` صار عميلاً للخزنة: لا localStorage، والرمز الإداري في الذاكرة فقط. و`migrateLegacyKeys` تنقل المفاتيح القديمة مرة واحدة ثم تحذفها.
    - `resultFetcher` يستدعي `/api/lookup`، وأزيل وسيط `apiKeys` من `fetchIdentifier` و`smartInvestigator`.
  - هذا يعالج تنبيهات CodeQL ‏js/clear-text-storage ‏#13–15 في الكود نفسه.
- الأدلة:
  - `vault.test.ts` (4): السر غير موجود في الملف، والمفتاح الخاطئ يفشل، ونقل مدخل لاسم آخر يفشل، والتحقق من الأسماء وملف المفتاح المولَّد.
  - `routes/vault.test.ts` (3): لا استجابة ولا ترويسة تحوي السر، والمفتاح لا يظهر في رابط المزود، ورفض المدخلات الخاطئة، ويعمل الرمز الإداري، ويُرفض `x-forwarded-for` بلا رمز.
  - تشغيل محلي للخادم المبني: السر غائب عن السجل وعن الملف.
  - مهمة CI ‏docker: ‏403 من المضيف، وتخزين وعرض حالة من داخل الحاوية.
- ما لم يتم: شاشة إعدادات المفاتيح في الواجهة (P3-013).
- التالي: P1-017 (سجل التدقيق) وP1-018 (غرض القضية).

### 2026-10-10 — [P1-018] [P1-017] غرض القضية وسجل التدقيق
- المنفّذ: وكيل آلي (Perplexity Computer).
- ما تم:
  - P1-018:
    - `openCase` يرفض إنشاء قضية بلا `create` (`NoCaseError`). `CaseInit` الجديد في `@ir/schema` يشترط غرضاً لا يقل عن 10 أحرف وأساساً من قائمة مغلقة (E-01)، ويُتحقق منه قبل كتابة أي ملف.
    - `case.created` أول مدخل في السلسلة، ويحمل سجل القضية كاملاً بالقيم الافتراضية: المالك هو الفاعل، والحساسية standard، والاحتفاظ indefinite.
    - `info()` يعيد السجل الحالي.
    - `update(changes, reason)` يضيف مدخل `case.updated` مع سبب إلزامي، ولا يغيّر المعرّف ولا تاريخ الإنشاء ولا المالك.
  - P1-017:
    - `audit(action, target, detail)` ينشئ `AuditEvent` بالقيمة `purposeRef` = معرّف القضية، ويضيفه مدخل `audit.event` في السلسلة (تغطيه البصمات ونقاط التثبيت)، وصفاً في فهرس `audit_events` في المعاملة نفسها.
    - يُسجَّل تلقائياً: إنشاء القضية، وتحديثها، وتخزين الأدلة، وفتح قضية مشفرة للكتابة، وتغيير عبارة المرور (`Case.changePassphrase`).
    - في القضايا المشفرة تبقى التفاصيل مختومة في السلسلة، ولا تُكتب في الفهرس.
  - `verifyCase` و`ir verify`: قسم `audit` يطابق الفهرس مع السلسلة، بالعدد دائماً، وبالمعرّف والوقت والفاعل والفعل عند فتح القفل.
  - أنواع السلسلة: أضيف `case.updated` و`audit.event`، وأعيد توليد JSON Schema.
- الأدلة:
  - `audit-purpose.test.ts` (5):
    - لا قضية بلا غرض، والقضية المرفوضة لا تترك ملف مفتاح.
    - التحديث بسبب يستمر بعد إعادة الفتح.
    - مسار التدقيق كامل ومربوط بالغرض.
    - القضية المشفرة: الفتح وتغيير العبارة مسجّلان، والتفاصيل غائبة عن الفهرس.
    - حذف صف تدقيق خلف المشغّلات يُكشف.
  - حُدّثت اختبارات `store` و`crypto` و`ir` للعدد الجديد من المدخلات.
- ما لم يتم: تمييز الأشخاص الطبيعيين (D-050) يأتي مع P2-013.
- التالي: P1-003/P1-004 (فهرس المعرّفات YAML) ثم P1-006 (محرك الكشف).

### 2026-10-10 — [P1-003] [P1-004] [P1-008] فهرس المعرّفات في YAML وإصلاح الأمثلة والحساسية
- المنفّذ: وكيل آلي (Perplexity Computer).
- ما تم:
  - P1-003:
    - 371 نوعاً نُقلت بتحويل لمرة واحدة من `identifierList.ts` إلى `packages/core/identifiers/<category>.yaml`، ملف لكل تصنيف (13)، بالمخطط `IdentifierSpec` الجديد في `@ir/schema` حسب 5.6. حقول المخطط: id، وcategory، وlabels، وdescription، وpatterns، وflags، وvalidator، وcontext، وexamples.positive/negative، وsensitivity، وtransforms.
    - `gen:data` يولّد `src/identifiers/catalog.ts`.
    - `@ir/core/identifiers`: `IDENTIFIER_SPECS` و`specById` و`patternsOf` و`matchesSpec` (النمط ثم المدقق على القيمة المطبّعة) و`accepts` و`expandExample`.
    - `identifierList.ts` في الواجهة صار محوّلاً من 40 سطراً بدل 4,400.
    - تصنيف `Messaging` جديد (D-010).
    - `scripts/audit/measure.mjs` يقرأ YAML، وأصلح عدّاد الجوالب: الأرقام بين علامتي اقتباس مزدوجتين كانت تُحسب صفراً.
  - P1-004: أصلحت 78 حالة:
    - أمثلة مبتورة بـ «...» استُبدلت بقيم كاملة معروفة، مثل كتلة بيتكوين الأولى، ومتجهات EIP-55 وBIP-32 وBOLT-11، وعنوان TRC-20 صحيح.
    - روابط اجتماعية بلا بروتوكول صار البروتوكول فيها اختيارياً.
    - نطاقات هواتف بريطانيا والمكسيك ورومانيا وكازاخستان والصومال.
    - IPv6 صار نمط بنية ويتولى المدقق التحقق.
    - `hdd_serial` يقبل الشرطة.
    - `mx_record` صار تطبيعه ومدققه «الأفضلية + المضيف».
    - IMEI بقيم تمر بـ Luhn.
    - أمثلة المفاتيح والرموز صارت قوالب `{{N:c}}` تُوسَّع وقت التشغيل فقط، فلا نص بشكل سر في المستودع.
    - مثال سلبي لكل نوع.
    - `wickr_id` (D-009): طول 5..20 مع `context.required`.
  - P1-008: `sensitivity` لكل نوع. 52 نوعاً من وثائق الهوية الشخصية موسومة `natural_person_gate`، و`cnpj_br` (منشأة) عادي. صُحّح رقم «32» التقديري في الخارطة إلى العد الفعلي.
  - وُثّق سير التعديل في DEVELOPMENT.
- الأدلة:
  - `catalog.test.ts` (8):
    - T-IDL-001..004.
    - كل نوع صالح وفق `IdentifierSpec`.
    - المولَّد مطابق لـ YAML.
    - 100% من الإيجابيات مقبولة، وكل سلبي مرفوض.
    - Messaging وسياق wickr.
    - 52 نوعاً محجوبة.
    - القوالب.
  - القياس: «أمثلة تطابق regex نوعها» من 302 من 376 (80.3%) إلى 377 من 377 (100%).
- ما لم يتم: «أول تطابق» ما زال 14.1% (D-005، D-007)، ويعالجه محرك الكشف متعدد المرشحين في P1-006.
- التالي: P1-006 (محرك الكشف).

### 2026-10-10 — [P1-006] محرك الكشف متعدد المرشحين
- المنفّذ: وكيل آلي (Perplexity Computer).
- ما تم:
  - `detect(value, { context, limit, minScore })` في `@ir/core/identifiers` يعيد كل الأنواع التي يقبلها نمطها ولا يرفضها مدققها، مرتبة بدرجة في (0، 1]. مكوّنات الدرجة:
    - نجاح المدقق: 0.45. فشل المدقق يُسقط المرشح.
    - الخصوصية: 0.35، وتُقاس من الفهرس نفسه بعدد أمثلة الأنواع الأخرى التي يقبلها النمط.
    - السياق: كلمات `context.keywords` أو كلمات تسمية النوع، بحد أقصى 0.2. النوع ذو `context.required` يُسقط بلا كلمة سياق.
  - `detectBest` يعيد المرشح الأعلى.
  - `matchesSpec` يعامل فشل التطبيع رفضاً بدل الاستثناء.
  - مدقق `domain` صار يقبل النطاق القابل للتسجيل نفسه (eTLD+1) حسب PSL، و`subdomain` ما تحته.
  - الواجهة: `detectType` يستدعي `detectBest`، و`detectAll` يعيد المرشحين بدرجاتهم، وحُذف `detectIdentifier` (D-027).
- الأدلة: `detect.test.ts` (8):
  - الاستدعاء 100% (377 من 377).
  - الأنواع ذات المدقق 33 من 33: أولاً، أو متعادلاً، أو خلف نوع أضيق مثل Visa قبل البطاقة العامة.
  - الأفضل صحيح في 59.4% بلا سياق (أول تطابق كان 14.1%)، وفي 83.3% مع كلمة التسمية.
  - فيتو Luhn وIBAN.
  - التمييز بالسياق (github).
  - wickr بالسياق فقط.
  - domain مقابل subdomain.
  - الحتمية والحدود.
- ما لم يتم:
  - المجموعة الذهبية المستقلة (P1-020)، فبقي D-005 مغلقاً جزئياً.
  - استخراج المعرّفات من نص حر متعدد الكلمات.
  - D-018 (نصوص خام كمعرّفات فرعية) يُغلق مع P2-004.
  - مقياس `measure.mjs` لـ«أول تطابق» باقٍ كخط أساس تاريخي.
- التالي: P1-020 (المجموعة الذهبية).

### 2026-10-10 — [P1-020] المجموعة الذهبية للكشف والاستخراج من نص حر
- المنفّذ: وكيل آلي (Perplexity Computer).
- ما تم:
  - `fixtures/detect/golden.jsonl`: 5,000 مقتطف، منها 2,700 عربي تقريباً. تضم 6,533 معرّفاً حتمياً و3,025 معرّفاً آخر بمواضعها، و800 شبيه معطوب:
    - IBAN بخانتي تحقق خاطئتين.
    - بطاقة وIMEI وISIN برقم أخير خاطئ.
    - Base58 وBech32 بحرف مبدل.
    - EIP-55 بحالة حرف مقلوبة.
    - IPv4 بثُمانية أكبر من 255.
  - مولّد حتمي في `packages/core/scripts/gen-golden.mjs` (`gen:golden`، و`--check` للتحقق من إعادة الإنتاج):
    - تطبيقات مستقلة عن النواة لـ Luhn وmod-97 وISIN وBase58Check وBech32 وKeccak-256/EIP-55، يُتحقق منها بمتجهات منشورة قبل أي إخراج.
    - لا بيانات لأشخاص حقيقيين: BIN اختبارية، ونطاقات هواتف خيالية، ونطاقات IP توثيقية.
  - `extract(text)` في `@ir/core/identifiers`:
    - تقطيع ونزع ترقيم.
    - سياق من 5 كلمات قبل القيمة وكلمتين بعدها.
    - يُبلّغ عن الكلمة إذا تحقق مدققها، أو كانت محددة بما يكفي، أو دعمها السياق.
  - إصلاحات كشفتها المجموعة:
    - EIP-55 كان يُدقق بعد التطبيع الذي يُصغّر الحروف فيضيع التحقق، فقُبل شبيه معطوب. صار التدقيق على النص المكتوب (`CASE_SENSITIVE`).
    - `stock_ticker` كان يلتقط كل كلمة كبيرة الحروف (IP، MAC، US)، فصار يتطلب سياقاً.
    - `phone_ca` كان يطابق كل أرقام NANP، فقُيّد برموز مناطق كندا.
  - README للمجموعة يشرح المصدر والمراجعة والعتبات.
- الأدلة: `golden.test.ts` (9):
  - البصمة والمواضع وإعادة الإنتاج وغياب بيانات الأشخاص.
  - المراجعة الثانية: مدققات النواة توافق كل تسمية وترفض كل شبيه معطوب، وIP يطابق `node:net`.
  - النتائج:

| المقياس | النتيجة |
|---|---|
| الحتمي: precision | 99.97% |
| الحتمي: recall | 99.97% |
| الشبيه المعطوب المقبول | 0 |
| الأنواع الأخرى: recall | 97.5% |
| كلمات عادية مستخرجة خطأً | 1 |

- ما لم يتم:
  - هواتف بريطانيا بلا كلمة سياق: النمط عام، والتحقق من رمز الدولة حسب E.164 تحسين لاحق.
  - المراجعة البشرية للنصوص ليست شرطاً هنا، لأن التسميات تُتحقق آلياً بتطبيقين مستقلين.
- التالي: P1-016 (الإسقاطات).

### 2026-10-10 — [P1-020] إصلاح تنبيه CodeQL في المستخرج
- المنفّذ: وكيل آلي (Perplexity Computer).
- ما تم: نبّه CodeQL (#25، `js/polynomial-redos`) إلى أن نزع الترقيم في نهاية الكلمة بتعبير `[...]+$` قد يبطؤ على تكرار طويل. استُبدل بحلقة خطية على مجموعتي أحرف. أُصلح في الكود ولم يُغلق التنبيه يدوياً.
- الأدلة: اختبار «extract: robustness»:
  - 50,000 علامة تعجب تُعالج في أقل من ثانيتين.
  - المواضع دقيقة مع «» والأقواس والفاصلة العربية.
  - نتائج المجموعة الذهبية لم تتغير.
- التالي: P1-016.

### 2026-10-10 — [P1-016] الإسقاطات: الرسم والجدول والتغطية من السجل
- المنفّذ: وكيل آلي (Perplexity Computer).
- ما تم:
  - `@ir/ledger/projections`:
    - `Projector`: مختزِل نقي (reducer) يطبّق المدخلات بالتسلسل. يقرأ `entity.added` و`claim.added` و`observation.added` و`evidence.stored` و`merge.decided` و`merge.reverted` و`note.added`، ويتحقق من كل حمولة بمخططات `@ir/schema`.
    - الحمولة غير الصالحة والمعرّف المكرر والإحالة إلى كيان أو ادعاء أو دليل أو دمج غير موجود تصير `issues` برقم التسلسل، بدل الاستثناء.
    - المدخلات غير المرتبة تُرفض.
  - العروض المشتقة:
    - `graphView`:
      - عقدة لكل مفتاح قانوني (D-020)، مع `aliases`.
      - الدمج بـ union-find إلى الناجي، والتراجع يعيد الرسم كما كان.
      - الادعاءات ذات القيمة الحرفية تصير `attributes`.
      - الادعاء بين طرفين مدموجين لا يُرسم حلقة، ويبقى في الجدول.
      - الأدلة لكل عقدة وحافة.
    - `tableView`: صف لكل عقدة بعدد الادعاءات والملاحظات والأدلة، وأول ملاحظة وآخرها.
    - `coverageView`:
      - خلية لكل عقدة ومحوّل بعدد النتائج الإيجابية والسلبية والأخطاء، وآخر نتيجة.
      - «بحثنا ولم نجد» تغطية كذلك (D3).
      - قائمة العقد التي لم يُجرَّب عليها شيء.
  - `project(entries, { upTo })` لقطة عند تسلسل معين (5.15). `projectionHash` تجزئة SHA-256 لصيغة JCS، وكل القوائم مرتبة بالمعرّف لتكون البصمة حتمية.
  - `Case.projection()` في `@ir/store`:
    - يُبنى من السلسلة عند أول استدعاء، ثم يتحدث مع كل `append` بالحمولة المقروءة بصيغة JCS.
    - يُصفَّر عند التراجع عن معاملة.
    - يرفض القضية المقفلة.
  - `ir project <case> [--at seq] [--expect sha256] [--json]`: إعادة بناء دون شبكة. ترجع 1 إذا اختلفت البصمة عن `--expect` (نحو T-LED-016).
- الأدلة:
  - `projections.test.ts` (10):
    - السلسلة الفارغة.
    - الرسم والجدول والتغطية.
    - التكرار بالمفتاح القانوني.
    - الدمج والتراجع.
    - الدمج المتسلسل.
    - المشكلات بلا استثناءات.
    - اللقطة.
    - رفض المدخلات غير المرتبة.
    - الحتمية.
    - **القبول:** البصمة الحية تساوي إعادة البناء بعد كل حدث من 600 حدث عشوائي، تشمل الدمج والتراجع والمراجع المعلقة.
  - `projection.test.ts` (3): القضية العادية والمشفرة تعطيان البصمة نفسها بعد إعادة الفتح من `case.sqlite`. في المشفرة يُسجَّل فتح القفل في السجل، فتُقارن اللقطة عند التسلسل نفسه، والعروض لا تتغير.
  - `ir project` (1).
  - الأداء: 10,000 عقدة و20,000 حافة في نحو 0.15 ثانية.
- ما لم يتم:
  - فهارس O(1) واختبار 100,000 عقدة (P1-022).
  - إزالة `persist` من الواجهة (P1-021).
  - ربط الواجهة بالإسقاطات عبر الخادم.
  - الخط الزمني (P4-006).
- التالي: P1-021 ثم P1-022.

### 2026-10-10 — [P1-016] معالجة تنبيه CodeQL في `ir project`
- المنفّذ: وكيل آلي (Perplexity Computer).
- ما تم: نبّه CodeQL (#26، `js/insufficient-password-hash`) إلى أن عبارة المرور تصل إلى تجزئة SHA-256. كانت تُدمج بالنشر (spread) مع خيارات `openCase` التي تحمل `actor`.
  - صارت عبارة المرور حقلاً مستقلاً يُمرَّر لفك مفتاح القضية فقط (Argon2id).
  - عُولج في الكود ولم يُغلق التنبيه يدوياً.
- الأدلة: اختبار `ir project` على قضية مشفرة:
  - بلا ملف عبارة مرور ترجع 2، لأن الحمولات مختومة.
  - مع الملف ترجع 0.
  - البصمة ثابتة بين التشغيلات.
- التالي: انتظار CodeQL ثم الدمج.

### 2026-10-10 — [P1-021] لا بيانات قضية في localStorage
- المنفّذ: وكيل آلي (Perplexity Computer).
- ما تم:
  - `investigationStore.ts` صار مخزن عرض في الذاكرة فقط، بلا `persist` من Zustand. كان يكتب كل العقد والحواف ونتائجها في localStorage تحت المفتاح `investigation-store` (D-033).
  - `store/storagePolicy.ts`: `purgeLegacyCaseStorage()` يحذف المفتاح القديم مرة عند الإقلاع من `main.tsx`، ولا يفشل إذا غاب التخزين أو رفض الوصول. لا يمس غيره من المفاتيح، و`UI_PREFERENCE_KEYS` فارغة اليوم.
  - تغيّر السلوك: إعادة تحميل الصفحة لا تستعيد تحقيقاً غير محفوظ. التحقيقات المحفوظة باقية في IndexedDB حتى تنتقل الواجهة إلى قضية الخادم وإسقاطاتها (D-035، P1-016).
- الأدلة:
  - `investigationStore.test.ts` (3):
    - إضافة عقد وحواف وتعديلها وتحميلها لا تكتب أي شيء في localStorage أو sessionStorage.
    - الحذف عند الإقلاع يزيل المفتاح القديم فقط، وهو آمن مع تخزين غائب أو رافض.
    - حارس يفشل إذا استورد أي ملف في `apps/web/src` `zustand/middleware` أو كتب في التخزين. تحقق أنه كان سيلتقط النسخة السابقة.
  - متصفح Chromium حقيقي (headless) على البناء: وُضع المفتاح القديم ثم أُعيد التحميل، فصارت المفاتيح `[]`، وعُرضت الصفحة بلا أخطاء.
- ما لم يتم:
  - الإضافة الخطية في `addNode` و`addEdge` (D-034) تُعالج في P1-022.
  - Dexie (D-035) يبقى حتى ربط الواجهة بالخادم.
- التالي: P1-022 (فهارس O(1)).

### 2026-10-10 — [P1-022] دمج مراجع المالك وتصنيفها، ثم بدء فهارس O(1)
- المنفّذ: وكيل آلي (Perplexity Computer).
- ما تم:
  - حُلّ تعارض الرفع المزدوج: الملفان في PR #31 وPR #33 هما نفس المحتوى حرفياً (`md5` متطابق)؛ دُمجا في مرجع واحد مصنّف.
  - صُنّف المرجعان (الخريطة الأمّ و`ROADMAP2.md`) حسب المجال/الاختصاص في `docs/references/master-tool-roadmap/` (20 ملفاً) و`docs/references/analytical-tools/` (23 ملفاً) + `INDEX.md` لكل مجلد.
  - الفهرس العام `docs/REFERENCES.md` (طبقة مرجعية، لا تحمل حالة ولا مهام).
  - الأصلان محفوظان حرفياً في `docs/archive/` (نفس نمط 14.7/14.8).
  - الخارطة: أُضيف القسم 14.9 يوثّق الدمج وضوابطه (لا خارطة ثانية؛ المهام عبر GR-02؛ بوابة الأشخاص تقيّد كل محتوى هجومي).
  - الحوكمة: `docs/ROADMAP.md` (14.9)، `docs/STATUS.md` (ملخص الحالة والمراحل وP1-022)، هذا الإدخال (GR-01).
- الأدلة:
  - `md5` بين PR #31 و#33 متطابق (`db988ca0663c972a523de19708be376c`) — تصنيف واحد يكفي.
  - عدد الأقسام المصنّفة يطابق عدد خطوط المرجعين (766 + 1,959).
  - لا تغيير في المحتوى إلا إزالة التكرار الحرفي؛ الترتيب الأصلي محفوظ بالترقيم.
- ما لم يتم:
  - P1-022 (فهارس O(1)) يُنفَّذ في فرع `perf/P1-022-projection-indexes`؛ يُغلق D-034 بعد اكتماله.
- التالي: دمج هذا الفرع، ثم بدء P1-022 فعلياً.

### 2026-10-10 — [P1-026] حصر حدود الوصول للخزنة والاستعلامات
- المنفّذ: Manus (وكيل آلي) بتفويض من المالك.
- ما تم: أزيل CORS المفتوح، وأصبح كل مسار تحت `/api/vault` و`/api/lookup` يتطلب `IR_ADMIN_TOKEN` صريحاً بلا استثناء loopback. نُقلت معرّفات IP والبريد من URL إلى جسم طلب POST، وتُنقّح مسارات lookup قبل التسجيل. أضيفت سياسة عنوان استماع قابلة للاختبار: `127.0.0.1` محلياً و`0.0.0.0` صراحة في الحاوية، مع تحميل `.env` عند التشغيل المحلي.
- الأدلة: `pnpm run lint` و`pnpm run typecheck` و`pnpm test` (28 ملفاً و212 اختباراً) و`pnpm run build` وفحوص الحوكمة ناجحة تحت Node `v24.21.0` وpnpm `10.34.6`.
- التالي: P1-022 لفهارس الإسقاطات، ثم تحويل النتائج العالية المتبقية من التدقيق إلى مهام محددة قبل تفعيل أي محوّل خارجي.

### 2026-10-10 — [P1-026] مواءمة فحص Docker مع حدود الإدارة
- عُدّل فحص CI ليشغّل الصورة برمز `IR_ADMIN_TOKEN` مؤقت مخصص للاختبار، ويتحقق من رفض الطلب بلا رمز (`401`) ومن نجاح إدارة الخزنة بالرمز مع عدم إعادة السر. بذلك يطابق اختبار Docker عقد الوصول الجديد بدلاً من سلوك loopback القديم.

### 2026-10-10 — [P1-022] فهارس O(1) للإسقاطات ومخزن العرض، وإصلاح حتمية فهرس الدمج (D-034، D-051)
- **المنفّذ:** وكيل آلي (Perplexity Computer) بتفويض تنفيذي من المالك.
- **ما تم:**
  - قياس قبل التعديل [مُقاس]:
    - `@ir/ledger` `Projector`: إضافة 100,000 كيان و100,000 ادعاء ثم `view()` في نحو 1.2 ث، أي أن الخرائط بمفاتيح كانت موجودة للكيانات والادعاءات.
    - لكن فهرس الدمج كان يُبنى كاملاً بعد كل `merge.decided` (فرز كل الدمجات و`find` بلا ضغط مسار): 2,000 دمج متسلسل مع `resolve` بعد كل دمج = 76 ث.
    - مخزن العرض في الواجهة: 10,000 عقدة + حوافها في 1.2 ث، و30,000 في 14.6 ث (تربيعي، D-034).
  - عيب حتمية جديد D-051 [مُقاس]: فهرس الدمج المخزَّن لا يُبطَل عند إضافة كيان متأخر سمّاه دمج سابق وصار اسماً مستعاراً لمفتاح قانوني موجود. فبعد عرض وسيط (كما يفعل `Case.projection()`) تختلف بصمة الإسقاط الحي عن إعادة البناء من السلسلة.
  - `packages/ledger/src/projections/state.ts`: union-find تزايدي بضغط مسار. `merge.decided` اتحاد واحد، و`resolve` بحث واحد. يُعاد البناء بالترتيب نفسه (ترتيب seq) فقط عند `merge.reverted` أو عند اسم مستعار متأخر لمعرّف سمّاه دمج. الاتحادات نفسها بالترتيب نفسه، فالحي = إعادة البناء.
  - `apps/web/src/store/investigationStore.ts`: فهرس `IdIndex` (معرّف -> موضع) مربوط بمرجع المصفوفة، يتبع الإضافة في O(1) ويُعاد بناؤه مرة عند استبدال المصفوفة من خارجه (`loadInvestigation`، `setState`). أضيف `addNodes` و`addEdges` (تحديث حالة واحد ونسخة واحدة لكل دفعة)، و`addNode`/`addEdge` يمرّان بهما. `updateNode` يجد العقدة بالفهرس، ولا يغيّر الحالة إن لم توجد.
  - الخارطة: سطر D-051 في 2.6، وإحصاء العيوب (عالٍ 26، المجموع 51)، وتتبع D-051 -> P1-022، وتسليمات P1-022 وقبولها.
- **الأدلة:**
  - `npx vitest run packages/ledger/src/projections` => 13 ناجحة، منها:
    - اختباران لـ D-051 (حالة محددة + 600 حدث عشوائي بدمجات تسمّي معرّفات قبل إضافتها وعروض وسيطة). **يفشلان على الكود القديم** (`git stash` لملف `state.ts`) وينجحان على الجديد.
    - قبول P1-022: 100,000 عقدة تُسقَط في 0.47 ث، و5,000 دمج متسلسل مع `resolve` بعد كل دمج في 0.02 ث، والبصمة تساوي إعادة البناء.
  - `npx vitest run apps/web/src/store` => 8 ناجحة، منها 5 جديدة: الدفعة = الإضافات المفردة (التكرار يُتخطى، الأول يفوز، الإحصاء مرة واحدة)، لا تغيير حالة بلا إضافة، `updateNode` يُبقي الفهرس صالحاً، الفهرس يتبع `loadInvestigation`/`setState`، و100,000 عقدة و99,999 حافة بالدفعات في أقل من 2 ث (قيس محلياً 0.07 ث للعقد).
  - `pnpm run lint` => 0، `pnpm run typecheck` => 0، `pnpm run build` => 0، `pnpm test` => 29 ملفاً و220 اختباراً ناجحة، تحت Node `v24.21.0` وpnpm `10.34.6`.
- **ما لم يتم / ملاحظات:**
  - [مُلاحظ] `addNode` المفرد ما زال ينسخ المصفوفة مرة لكل إضافة (شرط الثبات في React/Zustand)، فهو خطي لكل إضافة: 30,000 إضافة مفردة نحو 3.4 ث بعد أن كانت 14.6. المسار الجماعي هو `addNodes`/`addEdges`. لا مستهلك في التطبيق يضيف عقداً اليوم؛ الربط بإسقاطات الخادم مع لوحة الرسم في P3-005.
  - [مُلاحظ] تغيّر سلوك هامشي: `updateNode` يحدّث أول عقدة بالمعرّف (كان يحدّث كل التكرارات، وهي لا تنشأ إلا بتحميل بيانات مكررة).
  - [مقترح] إعادة البناء بعد التراجع خطية في عدد الدمجات؛ تراجعات متكررة متناوبة مع عروض تبقى O(M) لكل مرة، وهو مقبول لقرار بشري.
  - بوابات خروج المرحلة 1 (G-08..G-13) لم تُقَس بعد.
- **التالي:** قياس بوابات خروج المرحلة 1 وتوثيقها، ثم P2-001.

### 2026-10-10 — [P1-027] [P1-028] قياس بوابات خروج المرحلة 1 (G-08..G-13)، وإنشاء القضية ذرّياً (D-052)، وعقد معرّفات مخزن العرض (ADR-25)
- **المنفّذ:** وكيل آلي (Perplexity Computer) بتفويض تنفيذي من المالك، بعد اعتماد P1-022.
- **البيئة:** Node `v24.21.0`، pnpm `10.34.6`، Linux `6.1.155`، Intel Xeon 2.90GHz ×2، فوق `main` عند `9a43aeb`.
- **ما تم:**
  - حذف الفروع الخمسة القديمة (`docs/P0-001-governance`، `docs/P0-008-project-files`، `docs/P0-021-master-plan`، `feat/P0-006-entry-point`، `fix/P0-004-identifier-list`) بعد التحقق [مُتحقَّق]: الفرع الافتراضي `main`، ولا حماية على أي منها، و0 طلبات دمج مفتوحة، ورأس كل فرع = رأس طلبه المدموج (#1..#5). لم يبقَ على الخادم إلا `main`.
  - `scripts/gates/phase1.ts` (`pnpm run gates:phase1 [-- --json <ملف>]`): يقيس كل بوابة بمعيارها في الخارطة 12.2، لا بنجاح `test` وحده. يشغّل Vitest كاملاً مع التغطية (مخرَج JSON)، ويقرأ كتالوج المعرّفات وملف golden، ويشغّل الخادم المبني و يفحص حزمة الواجهة. يسجّل البيئة والإيداع، ويخرج بـ 1 عند فشل أي بوابة أو اختبار.
  - G-13: أضيف `@vitest/coverage-v8@5.0.3` وسكربت `test:coverage`، وكتلة تغطية في `vitest.config.ts` (v8، `packages/core/src` و`packages/ledger/src`، بلا ملفات الاختبار والملف المولّد `catalog.ts`، وسقف أسطر 85% لكل حزمة). وظيفة `test` في CI صارت `pnpm run test:coverage`، وأضيفت وظيفة `gates` تبني ثم تشغّل `gates:phase1`.
  - G-12 كشف عيباً جديداً **D-052** [مُقاس]: صفوف `meta` (`case_id`، `created_at`، `encryption`) كانت تُكتب في `resolveKey` خارج معاملة `case.created`. انقطاع مُحقن عبر الساعة عند القراءات 5–10 ترك مجلداً يُفتح قضيةً بـ 0 إدخالات (بلا غرض)، و`verifyCase` أعطاه `ok=true`، وكذلك قاعدة مرحّلة فارغة ليست قضية. الإصلاح (P1-028) في `packages/store/src/case.ts`: `meta` و`case.created` وتدقيقه في معاملة واحدة؛ ملف `case.key.json` يُكتب آخراً ويُحذف إن فشل الإنشاء؛ فتح الكتابة لسلسلة لا تبدأ بـ `case.created` يرمي `IncompleteCaseError`. وفي `verify-case.ts` أضيف فحص `purpose` (السجل حين يُقرأ، والنوع حين تكون القضية مقفلة) إلى التقرير و`allGood`.
  - تعارض ترقيم [مُلاحظ]: T-LED-016 معرّفة مرتين في 8.3 (العبث بالـ blob، ونفّذها P1-010؛ والإعادة بلا شبكة). أعيد ترقيم الإعادة إلى **T-LED-020**، وقبول P2-018 صار «T-LED-020 (وتبقى 016..019 خضراء)»، وصُحح تعليقان في `projections/index.ts` و`cli/src/ir.ts`.
  - `updateNode` (ADR-25): فحص العقد أن معرّف العقدة `canonicalKey` (P1-007، D-020) ومعرّف الحافة يجمع طرفيها، والإضافات تتخطى الموجود، فالتكرار ممنوع معمارياً. المدخل الوحيد الممكن للتكرار `loadInvestigation`؛ صار يرفضه بـ `DuplicateIdError` ويترك الحالة كما هي (لا حذف صامت). بهذا الثابت يكون «الأول» هو الوحيد، والسلوك مطابق للسابق على كل حالة صالحة.
  - `addNode`: أعيد القياس قبل أي تغيير [مُقاس، 3 تشغيلات]: المفرد 10,000 = 0.12–0.14 ث، و30,000 = 1.62–1.63 ث (نسخ القائمة لكل إضافة، شرط مرجع جديد في Zustand/React)؛ `addNodes` لـ 100,000 بدفعات 1,000 = 0.06–0.09 ث. القرار: لا تغيير في الواجهة البرمجية؛ المسار الجماعي معتمد في ADR-25، ولا مستهلك يضيف عقداً اليوم (P3-005).
  - الخارطة: P1-027 وP1-028 في 6.2، وسطر D-052 في 2.6، وإحصاء العيوب (عالٍ 27، المجموع 52)، وتتبع D-052 -> P1-028، وADR-25 في 5.20، وتوضيح قياس 8.5. وراجعت سطر D-051 وتتبعه -> P1-022: مسجلان كما يجب.
- **الأدلة (نتائج `pnpm run gates:phase1`):**
  - المجموعة: 226/226 اختباراً ناجحة في 29 ملفاً.
  - G-08 ✔: 377/377 مثالاً إيجابياً لـ 371 نوعاً تمر بنمطها ومدققها (100%)، و`detect` يسرد النوع نفسه للـ 377 كلها.
  - G-09 ✔: golden 5,000 مقتطف و6,533 وسماً حتمياً. الدقة 99.97% (6,531 صحيحاً و2 إيجاب كاذب)، والاستدعاء 99.97%، و0 قريب سلبي مقبول. شرط النجاح: الدقة والاستدعاء كلاهما ≥ 99%.
  - G-10 ✔ لنطاق المرحلة 1: كل T-LED-001..019 لها اختبار واحد على الأقل، وكلها خضراء. T-LED-020 لا يمكن وجودها قبل `engine.replay` (P2-018).
  - G-11 ✔: 8 اختبارات وحدة للخزنة. على الخادم المبني (`127.0.0.1`، مجلد مؤقت، بلا استعلامات شبكة) 15 طلباً (PUT لستة مزودين، GET، POST test، DELETE) كلها 200/204، ولا يظهر المفتاح في أي رد أو ترويسة أو سجل الخادم (3,130 بايت) أو ملف الخزنة نصاً. والمتصفح: 6 استدعاءات للخادم، و0 استدعاء لمزود بمفتاح، و0 مفتاح في URL، ولا طريقة لقراءة سر، و0 كتابة في تخزين المتصفح.
  - G-12 ✔: 9 اختبارات (P1-018 + 4 لـ D-052: انقطاع عند كل قراءة ساعة 1..40 للقضية العادية والمشفرة لا يترك قضية ولا ملف مفتاح ويمكن الإعادة؛ مجلد قديم ناقص يُرفض للكتابة ويفشل في `purpose`؛ التحقق بالسجل أو بالنوع). **الاختبارات الأربعة تفشل على الكود القديم** (`git stash` لـ `case.ts` و`verify-case.ts`). لا ملف خارج `case.ts` يفتح `DatabaseSync`.
  - G-13 ✔: أسطر `core` 544/548 = 99.27%، و`ledger` 418/423 = 98.82%. الإجمالي: أسطر 99.07%، وتعليمات 96.23%، وفروع 86.76%، ودوال 99.27%. `engine` و`egress` لم تُنشآ بعد.
  - الحتمية: 12 اختباراً خضراء، منها الحي = إعادة البناء بعد كل حدث من 600 عشوائياً (2.9 ث)، واختبارا D-051 (إضافة متأخرة واسم مستعار)، والدمج ثم التراجع، والدمج المتسلسل، والحي = إعادة البناء من `case.sqlite` للقضية العادية والمشفرة.
  - الأداء: قبول P1-022 (100,000 عقدة < 2 ث و5,000 دمج متسلسل) 5.5 ث للاختبار كله، ودفعات الواجهة 100,000 عقدة و99,999 حافة في 0.28 ث.
  - ضوابط سلبية: سقف تغطية 99.9% -> `vitest` يخرج بـ 1 («Coverage for lines (99.27%) does not meet»)؛ وحقن `fetch` إلى `ipinfo.io` بمفتاح في URL داخل `resultFetcher.ts` -> G-11 FAIL (أعيد الملف).
  - الواجهة: الحزمة المبنية تُعرض في Chromium بلا واجهة رسومية (`lang="ar" dir="rtl"`، 371 نوعاً) بلا أي رسالة console. `investigationStore.index.test.ts`: 7 اختبارات، منها رفض التكرار مع بقاء الحالة كما هي، واختبار مقارن بالنموذج على 3,000 عملية عشوائية يطابق التنفيذ السابق (`find`/`map`) خطوة بخطوة.
  - `pnpm run lint` => 0، `typecheck` => 0، `build` => 0، `pnpm test` => 0، `test:coverage` => 0، `governance` => 0.
- **ما فشل أثناء العمل:**
  - أول تشغيل لـ G-11 فشل لأن الفحص كان مطابقة نصية لأسماء المزودين، فالتقط `numverify` اسمَ تحويل في الكتالوج ورابط «احصل على مفتاحك». استُبدل بفحص الاستدعاءات الفعلية.
  - أول نسخة من الاختبار المقارن فشلت لخطأ في النموذج نفسه (فرع التحميل)، لا في المخزن.
  - قاعدة `complexity` رفضت `openCase` (18) و`g11` (24)؛ قُسّمتا إلى دوال أصغر بلا تغيير سلوك.
- **ما لم يتم / ملاحظات:**
  - [مُلاحظ] الواجهة ما زالت ترسل معرّفات مباشرة إلى 5 خدمات عامة بلا مفاتيح (`dns.google`، `api.github.com`، `blockchain.info`، `api.etherscan.io` برمز العرض العام `YourApiKeyToken`، `api.macvendors.com`). هذا لا يخرق G-11 (لا مفاتيح)، لكنه خروج بيانات يعالجه البوّاب `egress` (P2-003) وD-048.
  - T-LED-020 مع P2-018. `engine` و`egress` تدخلان سقف التغطية عند إنشائهما (P2-001، P2-003).
  - وظيفة `gates` في CI ليست فحصاً مطلوباً في حماية `main`؛ جعلها مطلوبة قرار للمالك.
- **التالي:** P2-001، ولم يبدأ.

### 2026-10-10 — [P1-027] متانة سكربت البوابات في CI
- **المنفّذ:** وكيل آلي (Perplexity Computer) بتفويض تنفيذي من المالك.
- **ما فشل:** على PR #37 فشلت وظيفة `gates` في CI بـ `ENOENT coverage/coverage-summary.json` بعد 32 ث من تشغيل Vitest، وانهار السكربت قبل أن يطبع أي تقرير. ونبّه CodeQL (`js/file-system-race`، تحذير) إلى `statSync` ثم `readFileSync` في دوال المرور على المجلدات. محلياً، وحتى بعد حذف `coverage/`، تنجح البوابات كلها [مُقاس].
- **ما تم:**
  - ملف نتائج Vitest صار في مجلد مؤقت خارج `coverage/` (يحذف Vitest هذا المجلد قبل كتابة التغطية).
  - `coverage.reportOnFailure: true`: تبقى G-13 قابلة للقياس حتى لو فشل اختبار، ويبقى التشغيل نفسه فاشلاً.
  - غياب تقرير التغطية صار FAIL صريحاً لـ G-13 بسببه، بدل الانهيار، والتقرير يطبع كل اختبار فاشل باسمه وملفه.
  - دالة واحدة `listFiles` تأخذ أنواع المداخل من `readdir` نفسها (`withFileTypes`)، فلا `stat` قبل القراءة.
- **الأدلة:** `rm -rf coverage && pnpm run gates:phase1` => 226/226، وG-08..G-13 كلها PASS (G-10 لنطاقها). `eslint` و`tsc -p scripts/gates/tsconfig.json` نظيفان. وننتظر نتيجة CI.
- **التالي:** دمج PR #37 بعد أن تخضرّ الفحوص؛ ثم P2-001، ولم يبدأ.

### 2026-10-10 — [P1-027] [P1-030] [P1-029] إغلاق فجوات المرحلة 1 بعد تدقيق الجاهزية: D-053، وR-10، وتعطيل lookups، وتصحيح ادعاء
- **المنفّذ:** وكيل آلي (Perplexity Computer) بتوجيه المالك بعد تدقيق جاهزية المرحلة 2 (القرارات D-1..D-8).
- **الحالة قبل التغيير [مُتحقَّق]:** `main` = `origin/main` = `4b9941b`؛ 0 طلب دمج مفتوح؛ وظيفة `gates` في تشغيل CI ‏38070936592 فشلت على `main`؛ الفحوص المطلوبة في حماية الفرع `governance` و`build` و`test` فقط؛ 23 تنبيه Dependabot مفتوحاً (حرج 1، عالٍ 11، متوسط 8، منخفض 3).
- **تصحيح ادعاء سابق (R-05) [مُتحقَّق]:** في مدخل P1-027 أعلاه كتبتُ أن «الواجهة ما زالت ترسل معرّفات مباشرة إلى 5 خدمات عامة». هذا **غير صحيح للتطبيق المشحون**: `App.tsx` لا يستورد إلا `identifierList`، و`resultFetcher.ts` و`smartInvestigator.ts` و`investigationDatabase.ts` و`apiKeyManager.ts` كود غير مستورد، والحزمة المبنية لا تحوي أي مضيف خارجي. الخدمات الخمس موجودة في كود ميت فقط (عزله بحارس: قرار المالك D-5، لم يُنفَّذ في هذا الإيداع). أكد ذلك الآن فحص الشبكة الفعلي أدناه: 0 طلب خارجي.
- **تصحيح الحالة (R-06):** `STATUS` كان يقول إن G-08..G-13 «متحققة» و«المرحلة 2 جاهزة للبدء» بينما `gates` حمراء على `main`. صارت البوابات «مقيسة محلياً وعلى PR #37، ولا تُعد متحققة على `main` حتى خمسة تشغيلات `gates` خضراء متتالية»، مع حدود كل بوابة: G-09 اصطناعية داخلية ولا يُعلن عنها دقةً واقعية (D-4)، وG-10 لنطاق المرحلة 1 فقط وT-LED-020 غير منجزة (D-7)، وG-12 للانقطاع داخل العملية. وD-037 صار «مُصلح جزئياً» (P1-026 أغلق CORS والمصادقة وحد المعدل والجسم؛ باقٍ helmet).
- **ما تم:**
  - **D-053 (R-01)** عيب جديد: اختبار «600 حدث عشوائي» بلا مهلة صريحة تجاوز الافتراضي 5,000 ms على مشغّل CI (5,743 ms) بعد أن أخذ 2,350 ms في وظيفة `test` على الإيداع نفسه. لم يُضعف أي اختبار: أضيفت مهلة صريحة 30,000 ms (السقف الذي حدده المالك) للاختبارات الثقيلة الثلاثة بلا مهلة: الـ 600 حدث، وD-051 بـ 600 حدث، وتصادم 100,000 معرّف؛ وثابت `HEAVY_MS` يوحّد ذلك مع اختبار قبول P1-022 الذي كانت مهلته 30,000 أصلاً.
  - **R-10، سكربت البوابات:**
    - يطبع أول أسطر رسالة الفشل الحقيقية لكل اختبار فاشل، وأخطاء تحميل الملفات، ويكتبها في `failures` بتقرير JSON؛ ويطبع أبطأ 5 اختبارات (`slowest`) ليُقاس الهامش إلى المهلة عبر التشغيلات.
    - G-11: فحص شبكة **فعلي**: يشغّل الخادم المبني ويفتح الواجهة في Chrome بلا واجهة عبر بروتوكول DevTools (بلا اعتمادية جديدة؛ مشغّلات Ubuntu في GitHub فيها Chrome)، ويسجل كل طلب. النجاح: الصفحة حُمّلت وعُرض فيها نص، وطلب واحد على الأقل، وكل الطلبات إلى أصل الخادم، ولا رسالة خطأ أو تحذير في console. إن لم يوجد متصفح تفشل البوابة ولا تُتخطى.
    - G-12: لا `node:sqlite` ولا مشغّل SQLite آخر خارج `packages/store/src`، ولا `new DatabaseSync` فيه خارج `case.ts` (كان: regex واحد على `new DatabaseSync(`).
    - G-10 بقيت مطابقة على معرّف `T-LED-nnn` في اسم الاختبار؛ لم تتغير.
  - **P1-030 (D-2، يخفف D-049)** مهمة جديدة بعد التحقق من عدم وجود بديل: P1-026 منجزة وكان نطاقها المصادقة لا الخروج، وP2-003 وP2-013 من المرحلة 2. `/api/lookup/*` معطلة ما لم تكن `IR_ENABLE_LOOKUPS` تساوي `1` حرفياً، و`IR_OFFLINE=1` يعطّلها دائماً. الفحص بعد المصادقة (بلا رمز: 401) وقبل قراءة الخزنة أو المدخل: 403 برسالة ثابتة. وُثّق في `.env.example` وREADME و`DEVELOPMENT.md` وجدول البيئة في الخارطة.
  - **P1-029 (D-3) وD-054** سُجّلا في الخارطة (لا مهمة قائمة تغطي فرز التنبيهات: P0-017 فعّل الفحوص، وP0-029 دمج طلبات #10–#14 تحديداً). التنفيذ في طلب دمج منفصل لأنه يغيّر ملف القفل.
  - الخارطة: D-053 وD-054 في 2.6، والإحصاء (عالٍ 28، متوسط 16، المجموع 54)، وP1-029 وP1-030 في 6.2، والتتبع D-053 -> P1-027 وD-054 -> P1-029 وD-049 -> P1-030 (تخفيف) وP2-013.
- **الأدلة [مُقاس، محلياً، Node 24.21.0]:**
  - `pnpm run gates:phase1` مع Chromium: 231/231، وG-08..G-13 كلها PASS (G-10 لنطاقها). فحص الشبكة: الصفحة حُمّلت، و488 حرفاً معروضاً، و4 طلبات، و0 طلب خارجي، و0 رسالة console.
  - أبطأ الاختبارات محلياً: P1-022 ‏5,480 ms، والـ 600 حدث 2,717 ms، والتصادم 1,810 ms، وD-051 ‏1,405 ms.
  - ضوابط سلبية: (1) حقن `fetch("https://example.org/gate-control")` في `App.tsx` -> G-11 FAIL و`foreignRequests` تسرده؛ (2) اختبار مؤقت بمهلة 50 ms -> السكربت يطبع «Error: Test timed out in 50ms.»؛ (3) `lookupsEnabled` يعيد `true` -> 4 اختبارات P1-030 تفشل. أعيدت الملفات الثلاثة.
  - اختبارات P1-030: لكل حالة تعطيل (بلا علم، `true`، `IR_OFFLINE=1`) وبمفاتيح مخزنة، 4 طلبات lookup كلها 403، و0 استدعاء لـ `fetch` المحقون، و0 استدعاء خارجي لـ `fetch` العام (مستبدل بشاهد يرمي).
- **ما لم يتم:**
  - إغلاق D-053 مشروط بخمسة تشغيلات `gates` خضراء متتالية على `main` بعد الدمج، ونجاح فحص Chrome على مشغّل CI لم يُقَس بعد.
  - جعل `gates` و`gitleaks` و`analyze` مطلوبة (D-1) بعد ذلك. وD-5 وD-6 وD-8 لم تُنفّذ هنا.
- **التالي:** فرز Dependabot (P1-029) في طلب دمج منفصل، ثم الخمسة تشغيلات، ثم D-1.

### 2026-10-10 — [P1-027] تنبيه CodeQL على فحص الشبكة
- **المنفّذ:** وكيل آلي (Perplexity Computer).
- **ما فشل:** على PR #38 نجحت `gates` و`test` و`build` و`governance` و`docker` و`gitleaks` و`analyze`، وفحص Chrome عمل على مشغّل CI (`google-chrome`، 4 طلبات، 0 خارجي) [مُتحقَّق: تشغيل 38076723985]. لكن فحص CodeQL فشل بتنبيه تحذير `js/unvalidated-dynamic-method-call` (رقم 28) في `scripts/gates/phase1.ts`: استدعاء دالة تُجلب من `Map` بمعرّف من رسالة DevTools.
- **ما تم:** الأوامر تُرسل واحداً واحداً وتُنتظر، فاستُبدلت الخريطة بمنتظر واحد يُطابَق معرّفه؛ لا بحث بمحتوى الرسالة.
- **الأدلة:** `eslint` و`tsc` نظيفان؛ `pnpm run gates:phase1` محلياً => 0، وفحص الشبكة: 4 طلبات، 0 خارجي، 488 حرفاً معروضاً.
- **التالي:** إعادة فحوص PR #38.

### 2026-10-10 — [P1-029] فرز تنبيهات Dependabot وسياسة مهلها (D-3، D-054)
- **المنفّذ:** وكيل آلي (Perplexity Computer) بتوجيه المالك (D-3).
- **الحالة قبل التغيير [مُتحقَّق: واجهة تنبيهات Dependabot]:** 23 تنبيهاً مفتوحاً كلها في `pnpm-lock.yaml`: حرج 1، وعالٍ 11، ومتوسط 8، ومنخفض 3.
- **ما تم:**
  - لكل تنبيه حُدد المسار الفعلي بـ `pnpm why -r` لا بتصنيف Dependabot (الذي يصف معظمها بـ «runtime»). **الحرج الوحيد (`proxy-addr`، #59) على مسار الخادم المشحون** عبر `express@5.2.1`. الخادم يضبط `trust proxy` بعدد قفزات فقط، فالاستغلال غير مرجّح، لكنه لم يُثبت بتجربة فأُصلح بلا استثناء. التنبيهات العالية الباقية في أدوات التطوير والبناء: `fast-uri` ×7 عبر `ajv` <- `orval`، و`browserslist` ×2 عبر Babel، و`brace-expansion` عبر `typescript-eslint`، و`braces` عبر `fast-glob` في `@ir/sandbox`.
  - `pnpm update -r --depth Infinity` لحزم الإصلاح ضمن نطاقاتها المعلنة، بلا تغيير أي `package.json`: `proxy-addr` 2.0.7->2.0.8، و`fast-uri` 3.1.2->3.1.8، و`browserslist` 4.28.2->4.29.3، و`brace-expansion` 5.0.6->5.0.12، و`qs` 6.15.1->6.16.0، و`body-parser` 2.2.2->2.3.0، و`baseline-browser-mapping` 2.10.28->2.11.28، و`fast-copy` 4.0.3->4.1.2. وتبعتها `caniuse-lite` و`electron-to-chromium` و`node-releases` و`update-browserslist-db` و`side-channel` و`hasown` و`es-object-atoms`، وأُضيفت `content-type@2.1.0` و`media-typer@1.1.1` و`type-is@2.1.0` لـ `body-parser@2.3.0`.
  - **استثناء واحد عالٍ:** `braces` (#54) لا إصدار مصلح له (آخر إصدار 3.0.3 داخل النطاق المصاب). النمط الوحيد ثابت في الكود (`src/components/mockups/**/*.tsx`)، والكود في إضافة Vite للتطوير فقط، خارج الخادم وصورة Docker. موعد إعادة المراجعة 2026-10-17.
  - **مؤجلة (متوسط ومنخفض):** `postcss-selector-parser` (#58، مقيد بـ `^6` في `@tailwindcss/typography`)، و`esbuild` (#4، مثبت بـ override `0.27.3`)، و`@babel/core` (#5).
  - السياسة في `SECURITY.md`، والسجل الكامل في `docs/security/DEPENDENCY_ALERTS.md`.
- **ما فشل أو صُحِّح أثناء العمل:**
  - كتبتُ أولاً أن `@babel/core@7.29.6` غير متاح؛ تبيّن أنه منشور (2026-05-25) وضمن النطاق، لكن `pnpm update` أبقى `7.29.0` [مُقاس]، والسبب [للتحقق]. صُحح السجل.
  - أمر `pnpm update ... esbuild` غيّر `esbuild` في `apps/server/package.json` و`packages/cli/package.json` من `0.28.2` إلى `0.27.3` (أثر الـ override)؛ أعيد الملفان كما كانا، ولم يتغير `package.json`. [مُلاحظ] التعارض بين الـ override و`package.json` قائم قبل هذا التغيير.
- **الأدلة [مُقاس، محلياً]:** `pnpm install --frozen-lockfile` => 0، و`build` => 0، و`typecheck` => 0، و`lint` => 0، و`test:coverage` 226/226 قبل إعادة القاعدة على `main`، و231/231 بعدها مع `build` و`lint` و`typecheck` و`governance` => 0؛ و`pnpm why -r proxy-addr` => `2.0.8`.
- **ما لم يتم:** إغلاق التنبيهات في GitHub يحدث آلياً بعد الدمج ويُقاس حينها. وإعادة مراجعة `braces` في 2026-10-17.
- **التالي:** الدمج، ثم قياس التنبيهات المفتوحة، وخمسة تشغيلات `gates` على `main` (D-053)، ثم D-1.

### 2026-10-10 — [P1-027] [P1-029] [P2-003] إغلاق D-053 وتطبيق D-1، ومراجعة تصميم البوّاب (ADR-08) ونطاق D-8
- **المنفّذ:** وكيل آلي (Perplexity Computer) بتوجيه المالك.
- **D-053 (R-01) [مُتحقَّق]:** دُمج PR #38 فصار `main` = `bf114ec`. تشغيل CI ‏38077329839 على هذا الإيداع: المحاولة 1 من الدفع، والمحاولات 2–5 بإعادة تشغيل وظيفة `gates` وحدها. خمس وظائف مستقلة (114286933087 و114287714998 و114288026295 و114288359658 و114288672529) نجحت كلها: 231/231، وG-08..G-13 كلها PASS، وفحص Chrome في كل محاولة 4 طلبات و0 خارجي.
  - أزمنة الاختبارات الثقيلة الأربعة لكل محاولة (من سجل كل محاولة على حدة؛ أداة السجلات أعادت المحاولة الأخيرة للخمس أولاً، فأعيد الجلب بـ `--attempt`): 7,984/4,737/2,551/2,078، و7,765/4,953/2,810/2,395، و5,626/3,634/2,564/1,772، و6,508/4,614/3,637/2,430، و5,899/3,278/2,274/1,767 ms.
  - أقصى زمن 7,984 ms، أي أقل من 27% من المهلة 30,000. وبلغ اختبار الـ 600 حدث 4,953 ms، قريباً من الافتراضي القديم 5,000، وهذا يؤيد التشخيص: تجاوز مهلة لا خطأ منطقي.
- **D-1 [مُتحقَّق: واجهة حماية الفرع]:** الفحوص المطلوبة على `main` صارت `governance` و`build` و`test` و`gates` و`gitleaks` و`analyze`، كلها مربوطة بتطبيق GitHub Actions (app_id 15368) حتى لا تُرضيها حالة من مصدر آخر. وبقي `strict: true` و`enforce_admins: true` والتاريخ الخطي، و0 مراجعة مطلوبة (انظر D-8).
- **P1-029 بعد الدمج [مُتحقَّق]:** دُمج PR #39 (`d4cb6ba`). التنبيهات المفتوحة الآن 4، وكلها في السجل: #54 `braces` (عالٍ، استثناء حتى 2026-10-17)، و#58 `postcss-selector-parser` (متوسط)، و#5 `@babel/core` و#4 `esbuild` (منخفضان). أغلق GitHub آلياً التنبيهات الـ 19 الأخرى.
- **P2-003، مراجعة التصميم الأمنية:** كُتب `docs/adr/ADR-08-egress-gateway.md` (مقترح). استُعمل رقم ADR-08 القائم في الخارطة («عزل المحوّلات + وكيل خروج»، مقترح بلا ملف) بدل رقم جديد. يغطي:
  - نقطة خروج واحدة، مربوطة بقضية وغرض وحساسية المعرّف؛ والرفض الافتراضي لـ `natural_person` حتى P2-013.
  - قائمة مسموحة حرفية، و`https` و443 فقط، ورفض بيانات الاعتماد وصيغ IP البديلة.
  - تثبيت العنوان بعد الحل (`lookup` في `https.request`) مع `net.BlockList` لـ IPv4 وIPv6 والصيغ المضمِّنة.
  - إعادة التوجيه يدوياً بثلاث قفزات، وتجاهل متغيرات الوكيل، وحدود الحجم بعد فك الضغط والمهلات والمعدل.
  - حقن الأسرار وتنقيحها، و`IR_OFFLINE`، وقائمة مقترحة لـ T-SEC-SSRF-001..030 تُبقي 001 و004 و010 و015 كما في الخارطة 8.3، و5 أسئلة للمراجع.
- **D-8:** `docs/security/REVIEW_SCOPE.md` يعيّن المراجع (`@sovereignaie-star`) ويحدد ثمانية بنود للمراجعة، وأضيفت المسارات إلى `CODEOWNERS`. **لم يُفعَّل الفرض في حماية الفرع:** الوكيل يعمل بحساب المالك، وGitHub يمنع صاحب الطلب من الموافقة عليه، و`enforce_admins` مفعّل، فالتفعيل الآن يمنع دمج أي طلب في هذه المسارات. رُفعت الخيارات (حساب آلي منفصل، أو تعليق موافقة يفحصه فحص آلي، أو إيقاف إجرائي) للمالك.
- **حالة P2-003:** `blocked` حتى المراجعة البشرية لـ ADR-08. لم يُكتب أي كود في `packages/egress`، ولم يبدأ P2-001.
- **التالي:** قرار المالك في فرض D-8 ومراجعته لـ ADR-08، ثم تنفيذ P2-003 بحسب ما يُعتمد.

### 2026-10-10 — [P1-031] فحص المراجعة البشرية لمسارات D-8 (`security-review-gate`) واعتماد المراجع `@xuuux-voox`
- **المنفّذ:** وكيل آلي (Perplexity Computer) بتوجيه المالك (اعتماد `@xuuux-voox` مراجعاً، وفرض D-8 قبل P2-003).
- **الحالة قبل التغيير [مُتحقَّق]:** `main` = `b7622bb`، وتشغيلات `ci` و`governance` و`codeql` و`secrets` عليه ناجحة. الطلب المفتوح الوحيد #40 (Dependabot، `esbuild`)، ولم يُمس. المشاركون: `sovereignaie-star` (admin) فقط. `xuuux-voox` (المعرّف 334893315) صلاحيته `read`، لأن المستودع عام لا لأنه مشارك.
- **الصلاحية [مُتحقَّق]:** أُرسلت دعوة بصلاحية `push` (Write): الدعوة 337118492، `permissions: write`، في 2026-10-10T19:19:08Z. لا Admin ولا Maintain. الصلاحية الفعلية بعد الإرسال ما زالت `read` حتى يقبل صاحب الحساب الدعوة.
- **مهمة جديدة P1-031** بعد التحقق من عدم وجود بديل: P0-024 (CODEOWNERS وإعدادات المستودع) منجزة ولم تشمل الفرض، وP2-003 مهمة كود البوّاب نفسه.
- **ما تم:**
  - `scripts/gates/security-review-gate.mjs`: دالة قرار نقية `decide`، و`main` تقرأ الطلب وكل صفحات الملفات والمراجعات من الواجهة، وتعيد قراءة الطلب للتأكد من أن رأسه لم يتغير، وتغلق عند الشك. القواعد في `docs/security/REVIEW_SCOPE.md`.
  - `.github/workflows/security-review.yml`: وظيفة `security-review-gate` على `pull_request_target` و`pull_request_review`. الصلاحيات `contents: read` و`pull-requests: read`، وتأخذ نسخة القاعدة فقط. لا فلتر للفرع الهدف، فالطلبات التجريبية إلى فرع العمل تختبر الإعداد قبل دمجه.
  - `security-review-gate.test.mjs`: 12 اختباراً، منها مطابقة CODEOWNERS لقائمة المسارات في الاتجاهين، فلا يملك المراجع أي مسار خارج D-8. وأضيف تشغيلها إلى وظيفة `governance` لتُختبر تعديلات الفحص نفسه قبل دمجها.
  - `CODEOWNERS`: كتلة D-8 بعد الأنماط الأعم (آخر مطابقة تنتصر)، تسمي `@xuuux-voox` مع بقاء `@sovereignaie-star`. وبقيت سطور المالك والحوكمة كما هي.
- **لماذا لا «مراجعة مالكي الكود» الأصلية:** سطر `*` يجعل المالك مالكاً لكل ملف، والوكيل يفتح الطلبات بحساب المالك، وGitHub لا يقبل موافقة صاحب الطلب، و`enforce_admins` مفعّل. فتفعيلها يمنع دمج كل طلب، لا طلبات D-8 وحدها.
- **الأدلة [مُقاس]:**
  - `node --test scripts/gates/security-review-gate.test.mjs`: 12/12.
  - ضوابط سلبية: إلغاء شرط رأس الطلب يفشّل اختباراً واحداً؛ وتعطيل مطابقة المسارات يفشّل 7. أُعيد الملف بعدهما.
  - تشغيل `main` الحقيقي محلياً على الواجهة (قراءة فقط): #39 PASS (لا مسار D-8)؛ و#38 FAIL (`apps/server/...` و`scripts/gates/phase1.ts`)؛ و#40 FAIL (`apps/server/package.json`)؛ و#41 FAIL (`.github/CODEOWNERS` و`ADR-08`). كلها «no review by @xuuux-voox».
  - بالرمز الخاطئ: `GitHub API 401` يعني FAIL.
- **ملاحظة [مُلاحظ]:** طلبات Dependabot التي تمس `apps/server/package.json` أو `.github/workflows/` ستحتاج موافقة المراجع حين يصبح الفحص مطلوباً، ومنها #40.
- **ما لم يتم:**
  - إثبات حالة «يسمح بعد الموافقة» يحتاج قبول الدعوة ثم موافقة من `@xuuux-voox` على طلب تجريبي.
  - جعل الفحص مطلوباً في حماية `main` لم يُنفّذ، ولن يُنفّذ قبل ذلك الإثبات.
  - الخطر المتبقي (التزوير من سير عمل معدَّل) موثق في REVIEW_SCOPE.
- **التالي:** طلبات تجريبية إلى هذا الفرع، وطلب مراجعة من `@xuuux-voox`، ثم التقرير والتوقف.

### 2026-10-10 — [P1-031] تنبيه CodeQL على ملخص الفحص، وسلوك `pull_request_target`
- **المنفّذ:** وكيل آلي (Perplexity Computer).
- **ما فشل:** نبّه CodeQL على PR #42 (`js/http-to-file-access`، تحذير، رقم 29) إلى كتابة أسماء ملفات من الواجهة في `GITHUB_STEP_SUMMARY`. أُزيل الملخص؛ السجل يكفي.
- **ما لوحظ [مُتحقَّق]:**
  - الطلبان التجريبيان #43 و#44 (قاعدتهما فرع الفحص) لم يشغّلا الفحص عبر `pull_request_target`. سجل تغييرات GitHub في 2025-11-07: هذا الحدث يأخذ ملف سير العمل دائماً من الفرع الافتراضي، فلا يُختبر قبل الدمج في `main`.
  - توثيق GitHub: سياسة افتراضية تمنع `pull_request_target` في المستودعات العامة، تُفرض في 2026-11-02 ما لم تسمح بها سياسة أحداث صريحة.
  - تشغيل `pull_request_review` على #42، من تعليق بوت CodeQL، فشل مغلقاً لأن السكربت غير موجود في `main` بعد.
- **التالي:** اختبار منطق الفحص في Actions عبر `pull_request_review` على #43 و#44، ثم رفع قرار التصميم للمالك.

### 2026-10-10 — [P1-031] طلب تجريبي (inside) لفحص D-8: لا يُدمج
- **المنفّذ:** وكيل آلي (Perplexity Computer).
- **ما تم:** تعديل تجريبي في `apps/server/src/lib/logger.ts` قاعدته فرع الفحص لا `main`، لإثبات سلوك `security-review-gate`. يُغلق الطلب بلا دمج.
