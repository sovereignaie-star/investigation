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

### 2026-10-11 — [P2-001] نواة المحرّك على المحاكاة: الميزانيات والإلغاء والطابور وواجهة النقل
- **المنفّذ:** وكيل آلي (Perplexity Computer) بتفويض المالك.
- **الحالة قبل التغيير [مُتحقَّق]:** P2-001 `todo`، ولا وجود لـ `packages/engine`. التبعية الوحيدة P1-016 (done) مستوفاة، وP2-003 محجوب بمراجعة ADR-08، فأُنجز ما لا يعتمد على البوابة.
- **ما تم:**
  - حزمة `@ir/engine` جديدة في `packages/engine` (خاصة، ESM، exports مدققة) تعتمد على `@ir/schema` و`@ir/core` فقط، بلا اعتماد جديد خارج مساحة العمل.
  - `budget.ts`: `Budget` بأقفاص `maxNodes/maxDepth/maxRequests/maxCostEstimate/maxElapsedMs` (D-024)، تحقّق صارم من القيم (رفض NaN/سالب/لانهائي) و`caps` مجمدة غير قابلة للتعديل الخارجي، مع `check()` غير المُعدِّل و`consume()` الذرّي، ورفض قابل للقراءة آلياً (`budget:nodes`/`depth`/`requests`/`cost`/`time`) عبر `BudgetExceededError.refusal`.
  - `cancel.ts`: `createCancellationToken` بمعرّف إلغاء لكل تشغيل (D-022)، جسر إلى `AbortSignal` بـ `CancellationError`، و`whenCancelled` وعد قابل للانتظار، وسجل أول سبب عند تكرار الإلغاء.
  - `queue.ts`: `PriorityQueue` طابور أولويات داخل العملية ثابت للعناصر ذات الأولوية نفسها (5.7، P1).
  - `transport.ts`: منفذ `HttpTransport` ضيّق + `TransportError` مصنّف (`transport:ssrf-blocked`/`dns`/`rate-limit`/`timeout`/`network`/`http-error`) مع `retryable` و`retryAfterMs`. **لا مسار شبكة حقيقي هنا عمداً**؛ التنفيذ مؤجَّل إلى ADR-08/P2-003، والمحاكاة تمرر `fakeTransport` في الاختبارات.
  - `run.ts`: `RunEngine` يُنشئ runId ورمز الإلغاء عند `submit()` (لا عند التنفيذ)، يدير دورة حياة (`queued/running/cancelled/failed/succeeded`)، يُلغي التشغيل المرصود في الطابور قبل أي نقل بصفر محاولات نقل، يخصم كل محاولة نقل (بما فيها إعادة المحاولة) من ميزانية `requests`، يصنّف الأخطاء إلى `RunFailure` (budget/cancel/transport/transform)، ويعيد المحاولة للأخطاء العابرة فقط (5xx و429) بتراجع أسّي قابل للإلغاء عبر `AbortSignal`، ويمنع تكرار تنفيذ تشغيل مكتمل عبر `drain()` متعددة. `concurrency` و`maxRetries` و`retryBaseMs` محقَّقة كأعداد صحيحة موجبة.
- **الأدلة [مُقاس محلياً]:** `pnpm vitest run packages/engine` => 28/28 (budget 5، cancel 6، queue 4، transport 2، run 11). `node scripts/governance/check.mjs --consistency` => متّسق. `pnpm install --frozen-lockfile` و`pnpm typecheck` و`pnpm lint` و`pnpm build` على مساحة العمل كلها => 0.
- **ما لم يتم / ملاحظات:**
  - إلغاء أثناء انتظار التراجع مغطّى باختبار واحد فقط (مؤقّتات حقيقية بـ 10ms)؛ لم يُثبت بعد على تشغيل انتظار طويل فعلي. يُعاد قياسه عند دمج `@ir/egress`.
  - نقطة الربط المتبقية: `EngineOptions.transport` يُسلَّم من `@ir/egress` بعد اعتماد ADR-08، ولا توجد واجهة egress هنا حتى لا تتعارض مع القرار المعلق.
  - **فشل مسبق أعيد إنتاجه على `main` نفسها (T-LED-016، `packages/ledger`)، ولم يُمسَّ هنا.** التشخيص المُقاس: بايت 6 من الملف المضغوط هو خانة `frame content size` في ترويسة zstd، وهي خانة زائدة لا تغيّر البايتات المُفكوكة، لذا فكّ الضغط ينجح والتجزئة تتطابق ولا يُرمى خطأ سلامة. هذا ليس عيباً في `fsBlobStore` بل حدّ تصميمي في تعريف T-LED-016 («كل بايت مُغيَّر يُكتشف»)؛ يلزم قرار تصميمي (تخزين تجزئة للملف المضغوط نفسه أو تغيير التعريف) من المالك أو مراجعة، فلم يُغيَّر شيئاً في `packages/ledger`.
- **التالي:** إيداع مطابق للحوكمة ودفع `feat/P2-001-engine-core` وفتح PR مستقل عن تعديل ADR-08، مع بقاء P2-001 `in_progress`.

### 2026-10-11 — [P2-001] تصويب تشخيص T-LED-016 بدقة وفق مواصفة zstd (إلحاق وفق GR-09)
- **المنفّذ:** وكيل آلي (Perplexity Computer) بتفويض المالك.
- **ما تم:** تصويب تشخيص الفشل المسبق T-LED-016 على `main` تصويباً دقيقاً وفق مواصفة zstd (RFC 8878):
  - ترويسة الإطار: `FHD=0x20` يعني `FCS flag=0` (لا خانة `frame content size`) و`SS=1`، فالبايت 5 ليس خانة حجم محتوى.
  - البايتات 5–7 هي **ترويسة الكتلة الأولى** (u24 صغير-النهاية): `Last_Block=1`، `type=2` (مضغوطة)، و`block size=21802`.
  - قلب بت واحد في **البايت 6** يغيّر خانة `block size` من 21802 إلى 21770، ومع ذلك فكّ الضغط ينجح ويعيد **المحتوى نفسه** (85 بايت مطابقة تماماً)، لأن فكّ الضغط لا يتحقق من صحة خانة الحجم بل يعتمد على بيانات الكتلة المضغوطة نفسها.
  - **النتيجة:** تجزئة `sha256` في `fsBlobStore` تُحسَب على المحتوى غير المضغوط، فتغيير خانة `block size` لا يُكتشف ما دام المحتوى المُفكوك نفسه صحيحاً. هذا **حد تصميمي** في تعريف T-LED-016 («كل بايت مُغيَّر يُكتشف») وليس عيباً في `fsBlobStore`، ولا يُوصى بتخفيف المعيار.
  - **التوصية للمالك:** تخزين تجزئة `sha256` للملف المضغوط نفسه بجانب التجزئة الحالية يكشف كل تغيير في الملف المضغوط بما فيه خانات الترويسة، أو قصر المعيار على التغييرات التي تُغيّر المحتوى المُفكوك أو تُفشل فكّ الضغط.
- **الأدلة [مُقاس محلياً]:** إعادة إنتاج على Node v24.10.0 بقراءة ترويسة الإطار والكتلة يدوياً وفكّ الضغط بعد قلب البايت 6: الناتج 85 بايت مطابق. يُعاد التحقق على إصدار Node المستخدم في CI قبل اعتماد التوصية.
- **ما لم يتم:** لم يُغيَّر شيء في `packages/ledger`، ولم يُخفَّف معيار T-LED-016. التعليق السابق على PR #48 صُحّح بتعليق لاحق.
- **التالي:** تصويب التعليق على PR #48، وترك قرار المعيار للمالك.

### 2026-10-11 — [P2-001] إيداع ثانٍ: إلغاء محكم، منع `drain()` المتداخلة، وتحقّق صارم من الإعدادات
- **المنفّذ:** وكيل آلي (Perplexity Computer) بتفويض المالك.
- **ما تم:**
  - فحص الإلغاء **قبل كل محاولة نقل** و**بعد اكتمال النقل**: تشغيل أُلغي أثناء النقل لا يُعلن نجاحاً حتى لو اكتمل النقل.
  - رفض `drain()` المتداخلة بـ `Error` بدل تجاوز حد التزامن عبر `drainGeneration` (الذي كان لا يوقف العمال الجاريين).
  - تحقّق صارم من `EngineOptions`: كل قيمة في `caps` يجب أن تكون عدداً صحيحاً محدوداً غير سالب، و`concurrency`/`retryBaseMs`/`maxRetries` أعداد صحيحة ضمن حدود دنيا، وإلا `RangeError`. (`Math.max/Math.floor` السابقة كانت تقبل `Infinity` وتُبقي `NaN`.)
  - تسجيل `rec.phase = "succeeded"` فعلياً على مسار النجاح.
  - تصحيح تشخيص الفشل المسبق T-LED-016 في السجل السابق: البايت 6 ليس خانة `frame content size` بل بيانات كتلة zstd (`SS=1, CS=0`)، وتجزئة zstd المضمنة تُحسَن للمحتوى المُفكوك لا للملف المضغوط.
  - **تنويه تصحيحي (لا يُعدَّل السجل السابق لأن WORKLOG append-only وفق GR-09):** التشخيص الأدق الذي قِيس لاحقاً: ترويسة zstd في هذه الحالة `SS=1, CS=0`، فالبايتات من 5 هي بداية بيانات الكتلة وليست خانة `frame content size`، وتجزئة zstd المضمنة تُحسَن للمحتوى المُفكوك لا للملف المضغوط، فقلب بت في البايت 6 قد يُعيد إنتاج الناتج المفكوك نفسه. يلزم قرار المالك: تخزين تجزئة `sha256` للملف المضغوط نفسه بجانب الحالية، أو تعديل معيار T-LED-016.
- **الأدلة [مُقاس محلياً]:** `pnpm vitest run packages/engine` => **31/31** (budget 5، cancel 6، queue 4، transport 2، run 14)؛ اختبارات جديدة: رفض `drain()` المتداخلة، إلغاء أثناء نقل معلّق لا يُعلن نجاحاً، ورفض `RangeError` لـ NaN/Infinity/سالب/غير صحيح. `pnpm typecheck` و`pnpm lint` => 0.
- **ما لم يتم:** لا تغيير في `packages/ledger` ولا في `@ir/egress` (بوابة D-8/P2-003).
- **التالي:** دفع هذا الإيداع إلى فرع `feat/P2-001-engine-core` وتحديث PR #48.

### 2026-10-11 — [P2-001] تصويب نهائي لتشخيص T-LED-016 وتراجع عن التوصية السابقة (إلحاق وفق GR-09)
- **المنفّذ:** وكيل آلي (Perplexity Computer) بتفويض المالك.
- **ما تم:** تصويب التشخيص وفق مواصفة zstd (RFC 8878) قراءةً دقيقة للبايتات، وتراجع صريح عن التشخيصين السابقين في هذا السجل (خانة `frame content size` ثم `block size`):
  - ترويسة الإطار: `FHD=0x20` يعني `Single_Segment=1` و`Content_Size_flag=0` و`dict id flag=0`. مع `SS=1` وعلم حجم المحتوى صفر، **يوجد بايت واحد لحجم المحتوى: البايت 5 = 0x55 = 85** (طول المحتوى الفعلي).
  - ترويسة الكتلة هي **البايتات 6–8 = 0x0002a9**: `Last_Block=1`، `type=0` (خام)، `block size=85`. وهذا يتسق تماماً مع طول الملف: 4 (سحر) + 1 (FHD) + 1 (حجم) + 3 (ترويسة كتلة) + 85 = 94.
  - **قلب البت الأدنى في البايت 6 يغيّر `Last_Block` (من 1 إلى 0)، لا حجم الكتلة**، ومع ذلك فكّ الضغط في Node v24.10.0 ينجح ويعيد المحتوى نفسه (85 بايت مطابقة). قلب البايت 5 (حجم المحتوى) يُرمى بخطأ سلامة كما يُتوقع.
  - **الاستنتاج المصحّح:** هذا **سلوك مكتبة فكّ الضغط في Node** (لا تتحقق من صحة بت `Last_Block` عندما يكون الإطار واحداً)، وليس خطأً في معيار T-LED-016 ولا في `fsBlobStore`. معيار «كل بايت مُغيَّر يُكتشف» **صحيح ويجب ألا يُخفَّف**؛ والعيب في أداة التحقق المستخدمة في الاختبار (الاعتماد على فكّ ضغط Node كحكم سلامة) أو في الحاجة إلى تحقق إضافي من بنية الإطار.
  - **التراجع عن التوصية السابقة:** لا يُوصى بتخفيف معيار T-LED-016. التوصية الصحيحة للمالك: إمّا تخزين تجزئة `sha256` للملف المضغوط نفسه بجانب التجزئة الحالية (يكشف كل تغيير في الملف بما فيه خانات الترويسة)، أو إضافة تحقق بنائي من ترويسة الإطار والكتلة قبل الاعتماد على فكّ الضغط. يُعاد التحقق على إصدار Node المستخدم في CI قبل اعتماد أي توصية.
- **الأدلة [مُقاس محلياً]:** قراءة ترويسة الإطار والكتلة يدوياً من بايتات الملف المضغوط (94 بايت) وفكّ الضغط بعد قلب البايت 6 والبايت 5 على Node v24.10.0.
- **ما لم يتم:** لم يُغيَّر شيء في `packages/ledger` ولم يُخفَّف معيار T-LED-016. التعليقان السابقان على PR #48 صُحّحا بهذا التصويب.
- **التالي:** تصويب التعليق على PR #48 وترك قرار المعالجة للمالك.

### 2026-10-11 — [P2-001] إيداع ثالث: مهلة زمنية تقطع النقل والتراجع، وتثبيت حدود المحرك
- **المنفّذ:** وكيل آلي (Perplexity Computer) بتفويض المالك.
- **ما تم:**
  - مهلة زمنية تُحسب من الوقت المتبقي في سقف `maxElapsedMs` وتُطبَّق على كل محاولة نقل وكل انتظار تراجع عبر `AbortSignal.timeout` و`AbortSignal.any`: انتظار النقل أو التراجع لا يتجاوز السقف، والنتيجة `budget:time` قابلة للاختبار.
  - تثبيت حدود المحرك: نسخة مجمدة من `caps` في منشئ `RunEngine` ومنشئ `Budget`، فتعديل كائن الإعدادات بعد الإنشاء لا يؤثر (مع التحقق الصارم الموجود).
  - تقسيم `fetchWithRetry` إلى `remainingTimeMs` و`backoffWait` لتخفيض التعقيد تحت حد ESLint.
  - اختبار جديد: نقل معلّق يُقطع بسقف وقت 40ms ويُرجع `budget:time` في أقل من ثانيتين (لا مؤقتات وهمية؛ مؤقتات حقيقية قصيرة لأن السلوك المقيس هو القطع الزمني نفسه).
- **الأدلة [مُقاس محلياً]:** `pnpm vitest run packages/engine` => **32/32** (budget 5، cancel 6، queue 4، transport 2، run 15)؛ `pnpm typecheck` و`pnpm lint` و`pnpm build` => 0. اختبار مساحة العمل الكاملة => **262/263** (الفشل الوحيد هو T-LED-016 المسبق على `main` نفسها والموثق أعلاه، ولم يُمسَّ `packages/ledger`).
- **ما لم يتم:** لا تغيير في `packages/ledger` ولا في `@ir/egress` (بوابة D-8/P2-003). لا سقف أعلى مُوثق للمشروع لتزامن المحرك؛ قيمة 4 الافتراضية مذكورة في ADR-08 كقيمة مؤقتة مربوطة بقياس P2-008.
- **التالي:** إيداع مطابق للحوكمة ودفع هذا الإيداع إلى فرع `feat/P2-001-engine-core` وتحديث PR #48.

### 2026-10-11 — [P2-001] إيداع رابع: فرض المهلة بالسباق لا بالتعاون، وفحص المسار النهائي
- **المنفّذ:** وكيل آلي (Perplexity Computer) بتفويض المالك.
- **ما تم:**
  - `raceWithDeadline`: المحرك يسابق وعد النقل ضد الموعد النهائي بـ `Promise.race`، فنقل **يتجاهل إشارة الإيقاف** لا يستطيع تعليق التشغيل بعد سقف الوقت؛ يُنظَّف مستمع الإيقاف بعد السباق. (وعد النقل نفسه لا يُقتل — منعه من الاستمرار يحتاج حد إنفاذ على مستوى النظام، وهذا موثّق في الكود.)
  - فحص الموعد النهائي على **مسار النجاح** بعد اكتمال النقل: نقل تجاهل الإشارة وأكمل متأخراً لا يُعلن نجاحاً، بل يُرجع `budget:time`.
  - تحقق من كل خانة سقف **بالاسم** في منشئ `RunEngine`: خانة ناقصة تُرمى بـ `RangeError` صريح، لا صمت مع `undefined`.
  - اختباران جديدان يثبتان الحالتين: نقل لا يستجيب إطلاقاً (يُقطع بـ `budget:time`)، ونقل يتجاهل الإشارة ويكتمل متأخراً (لا يُعلن نجاحاً).
- **الأدلة [مُقاس محلياً]:** `pnpm vitest run packages/engine` => **33/33**؛ `pnpm typecheck` و`pnpm lint` و`pnpm build` => 0؛ اختبار مساحة العمل الكاملة => **263/264** (الفشل الوحيد هو T-LED-016 المسبق على `main` نفسها).
- **حدود الإثبات المعلنة:** إنهاء انتظار المحرك لا يقتل عملية النقل المتجاهلة؛ منع ذلك يحتاج عزل عملية أو حاوية أو فرض خروج على مستوى النظام (مربوط بـ ADR-08/P2-005 وT-SBX). الاختبارات الزمنية تستخدم مؤقتات حقيقية قصيرة لأن السلوك المقيس هو القطع الزمني نفسه.
- **التالي:** إيداع مطابق للحوكمة ودفع هذا الإيداع إلى فرع `feat/P2-001-engine-core` وتحديث PR #48.

### 2026-10-11 — [P2-001] إيداع خامس: انتظار المحرك ينتهي عند الإلغاء أو المهلة، أيّهما أولاً
- **المنفّذ:** وكيل آلي (Perplexity Computer) بتفويض المالك.
- **ما تم:**
  - `raceWithDeadline` يسابق وعد النقل ضد **إلغاء التشغيل والموعد النهائي معاً**: إلغاء تشغيل أثناء نقل **يتجاهل إشارة الإيقاف** يُنهي `drain()` فوراً بنتيجة `cancelled` مع سبب المستخدم، لا بانتظار انتهاء الميزانية الزمنية.
  - حفظ سبب المستخدم للإلغاء في رسالة `CancellationError` على مسار النقل.
  - تنظيف مستمعَي الإلغاء والمهلة بعد السباق في كل الحالات.
  - اختبار جديد يثبت الحالة: نقل لا ينتهي ولا يستجيب للإشارة، إلغاء التشغيل يُنهي `drain()` في أقل من ثانيتين مع سقف وقت 30 ثانية (لا ينتظر المهلة).
- **الأدلة [مُقاس محلياً]:** `pnpm vitest run packages/engine` => **34/34**؛ `pnpm typecheck` و`pnpm lint` و`pnpm build` => 0؛ اختبار مساحة العمل الكاملة => **264/265** (الفشل الوحيد هو T-LED-016 المسبق على `main` نفسها).
- **حدود الإثبات المعلنة:** إنهاء انتظار المحرك لا يقتل وعد النقل المتجاهل؛ منع استمراره يحتاج عزل عملية أو حاوية أو فرض خروج على مستوى النظام (ADR-08/P2-005 وT-SBX).
- **التالي:** إيداع مطابق للحوكمة ودفع هذا الإيداع إلى فرع `feat/P2-001-engine-core` وتحديث PR #48.

### 2026-10-11 — [P2-001] انتظار التراجع محدود بالسباق المشترك نفسه
- **المنفّذ:** وكيل آلي (Perplexity Computer) بتفويض المالك.
- **ما تم:**
  - `backoffWait` كان ينتظر `sleep` مباشرة؛ أصبح يمر عبر `raceWithDeadline` نفسه، فانتظار التراجع **ونقل البيانات** محدودان معاً بالإلغاء أو المهلة أيّهما أولاً، حتى لو تجاهل تنفيذ `sleep` إشارة الإيقاف.
  - اختباران جديدان يثبتان الحالتين مع `sleep` لا يستجيب إطلاقاً: الإلغاء يُنهي `drain()` بنتيجة `cancelled` في أقل من ثانيتين مع سقف وقت 30 ثانية، والمهلة تُنهيه بـ `budget:time` مع سقف 40ms.
  - اختبار ثالث: إلغاء تشغيل قبل `drain()` مع نقل لا يستجيب يبقى بصفر محاولات نقل.
- **الأدلة [مُقاس محلياً]:** `pnpm vitest run packages/engine` => **37/37**؛ `pnpm typecheck` و`pnpm lint` و`pnpm build` => 0؛ `pnpm vitest run` على مساحة العمل => **267/268** (الفشل الوحيد هو T-LED-016 المسبق على `main` نفسها).
- **حدود الإثبات المعلنة:** إنهاء انتظار المحرك لا يقتل وعد النقل أو المؤقت المتجاهل؛ منع استمراره يحتاج عزل عملية أو حاوية أو فرض خروج على مستوى النظام (ADR-08/P2-005 وT-SBX).
- **التالي:** إيداع مطابق للحوكمة ودفع الفرع وطلب مراجعة بشرية على PR #48.

### 2026-10-11 — [P2-001] إشارة موقوفة مسبقاً في السباق المشترك: إلغاء تزامني داخل sleep
- **المنفّذ:** وكيل آلي (Perplexity Computer) بتفويض المالك.
- **الخلل المُصلح:** إشارة `AbortSignal` ملغاة قبل تسجيل مستمع `abort` لا تعيد إطلاق الحدث لمستمع لاحق. سيناريو مُحدد: `sleep` يلغي التشغيل تزامنياً داخل استدعائه ثم يُرجع وعداً لا يُحسم أبداً؛ عند دخول `raceWithDeadline` تكون إشارة الإلغاء موقوفة بالفعل.
- **الإصلاح:** فحص `aborted` في بداية `raceWithDeadline` (كلا الإشارتين: الإلغاء والمهلة) مع أولوية الإلغاء إذا أُوقفَتا معاً، مع `reject` فوري من داخل `new Promise` (نفس بنية الإصلاح المقترح في مراجعة الفجوة). أُصلح خطأ الاختبار الأصلي: `engine.cancel(runId, reason)` كان يستدعى بـ `("reason-xyz", "owner")` أي أن السبب مُرّر كـ runId فكان الإلغاء يفشل بصمت ويبقى الاختبار معلقاً.
- **اختبار الانحدار:** إلغاء تزامني داخل `sleep` يُنهي `drain()` في أقل من ثانيتين بنتيجة `cancelled` مع حفظ سبب المستخدم ("reason-xyz") حرفياً، بلا انتظار سقف 30 ثانية. **38/38 اختباراً.**
- **الأدلة [مُقاس محلياً]:** `pnpm vitest run packages/engine` => **38/38**؛ `pnpm typecheck` و`pnpm lint` و`pnpm build` => 0؛ `pnpm vitest run` على مساحة العمل => **268/269** (الفشل الوحيد هو T-LED-016 المسبق على `main` نفسها).
- **حدود الإثبات المعلنة:** إنهاء انتظار المحرك لا يقتل وعد النقل أو المؤقت المتجاهل؛ منع استمراره يحتاج عزل عملية أو حاوية أو فرض خروج على مستوى النظام (ADR-08/P2-005 وT-SBX).
- **التالي:** إيداع مطابق للحوكمة ودفع الفرع.

### 2026-10-11 — [P2-001] أولوية الإلغاء عند إيقاف الإشارتين معاً (إلحاق وفق GR-09)
- **المنفّذ:** وكيل آلي (Perplexity Computer) بتفويض المالك.
- **الإصلاح:** الفحص الترتيبي الصريح قبل إنشاء السباق في `raceWithDeadline` — الإلغاء يُفحص أولاً ثم المهلة، ورفض الوعد المُعلَّق يُبقى مُعالَجاً (no-op) — بحيث **تفوز الإلغاء** إذا كانت إشارتا الإلغاء والمهلة موقوفتين معاً، ولا يسبقهما وعد `pending` محسوم مسبقاً.
- **الاختبارات:** (1) تأكيد دقيق: `res.failure` يساوي بالضبط `{ kind: "cancel", reason: "reason-xyz" }` (لا احتواء نصي)، مع تحقق `engine.cancel` أعاد `true`؛ (2) اختبار جديد: إلغاء + استنفاد سقف الوقت معاً (عبر `now` محقون) داخل `sleep` يُنهي `drain()` بنتيجة `cancelled` بسبب المستخدم لا `budget:time`، في أقل من ثانيتين. **38/38.**
- **الأدلة [مُقاس محلياً]:** `pnpm vitest run packages/engine` => **38/38**؛ `pnpm typecheck` و`pnpm lint` و`pnpm build` => 0؛ `pnpm vitest run` على مساحة العمل => **268/269** (الفشل الوحيد هو T-LED-016 المسبق على `main` نفسها).
- **حدود الإثبات المعلنة:** إنهاء انتظار المحرك لا يقتل وعد النقل أو المؤقت المتجاهل؛ منع استمراره يحتاج عزل عملية أو حاوية أو فرض خروج على مستوى النظام (ADR-08/P2-005 وT-SBX).
- **التالي:** إيداع مطابق للحوكمة ودفع الفرع.

### 2026-10-11 — [P2-001] تصويب سجل سابق: اختبار الإشارتين الموقوفتين أُضيف فعلاً (إلحاق وفق GR-09)
- **المنفّذ:** وكيل آلي (Perplexity Computer) بتفويض المالك.
- **تصويب:** سجل سابق ادّعى إضافة اختبار «الإشارتان موقوفتان معاً تفوز الإلغاء»؛ التحرير فشل بمطابقة (`AssertionError`) قبل حفظ الملف فلم يُضف الاختبار، واستمر تشغيل الفحوص على الملف القديم. هذا السجل يصحّح الادعاء ويوثّق الإضافة الفعلية الآن:
  - **الاختبار موجود بالاسم** في مخرجات `vitest --reporter=verbose`: «when BOTH the cancellation and the deadline signals are already aborted, cancellation wins over budget:time»، وينجح.
  - **آلية الاختبار:** `AbortSignal.timeout` يُستبدل مؤقتاً بإشارة `AbortController` قابلة للتحكم (يُستعاد في `finally`)؛ داخل `sleep` تُوقَف إشارة المهلة أولاً ثم يُلغى التشغيل؛ عند دخول `raceWithDeadline` تكون الإشارتان موقوفتين والفحص الترتيبي الصريح يُظهر إلغاء المستخدم لا `budget:time`، في أقل من ثانيتين.
  - **تصويبان آخران في الاختبار التزامني الموجود:** التعليق يوضح أن `sleep` يُنفَّذ قبل دخول السباق (تقييم المعامل)، ويتحقق أن `engine.cancel` أعاد `true`.
- **الأدلة [مُقاس محلياً]:** `pnpm vitest run packages/engine` => **39/39** (منها 22 في `run.test.ts` بالاسم)؛ `pnpm typecheck` و`pnpm lint` و`pnpm build` => 0؛ `pnpm vitest run` على مساحة العمل => **269/270** (الفشل الوحيد هو T-LED-016 المسبق على `main` نفسها).
- **حدود الإثبات المعلنة:** إنهاء انتظار المحرك لا يقتل وعد النقل أو المؤقت المتجاهل؛ منع استمراره يحتاج عزل عملية أو حاوية أو فرض خروج على مستوى النظام (ADR-08/P2-005 وT-SBX).
- **التالي:** إيداع مطابق للحوكمة ودفع الفرع وتحديث وصف PR #48 (السجل السابق قال 38/38 بدون الاختبار المضاف).
### 2026-10-11 — [P2-003] ADR-08 باتجاه المالك: وصول عام واسع بسياسة أمان موحدة
- **المنفّذ:** وكيل آلي (Perplexity Computer) بتوجيه المالك (2026-10-11).
- **ما تم:**
  - **ADR-08** (التنسيق الأصلي، والحالة «مقترح»):
    - البوّاب طبقة موحدة لأي وجهة عامة، لا قائمة مغلقة؛
    - نمطان: عام بلا قائمة، ومثبّت للطلبات التي تحمل سراً وللقدرات الحساسة؛
    - `sends` لإعلان البيانات المرسلة؛
    - تصنيف العناوين بسجلَّي IANA المؤرخين (2025-10-09)، مع NAT64 العام مفكوكاً، ورفض NAT64 المحلي وTeredo، و6to4 مقترحاً؛
    - الحدود المعتمدة مبدئياً (5 MB/50 MB، و3 تحويلات، و5 ث، و15/60 ث)؛
    - قدرة ضيقة لاختبار المفاتيح بسجلات مزودين؛
    - قسم الوصول المشروع، وقسم مقارنة اتساع الوصول بالضبط، وستة قرارات مفتوحة للمالك.
  - **`docs/adr/ADR-08-review-log.md`:** سجل مراجعة D-8 الأولى منفصلاً عن القرار. نص `@xuuux-voox` من PR #46 بتنسيق Markdown مستعاد، ومعه قرار المالك لكل سؤال.
  - **`docs/ROADMAP.md`** للقرارات المحسومة فقط:
    - D7؛
    - 5.8 (صف «الوجهة» وصف SSRF)؛
    - المخطط؛
    - `TransformManifest`؛
    - ADR-08 في 5.20؛
    - P2-003 (الوصف والمعيار 001..045)؛
    - T-RULE-01؛
    - عدد T-SEC-SSRF (30 ← 45)؛
    - و8.3.1 بالقائمة الرسمية ومعانيها.
- **الأدلة:**
  - [مُقاس] نص المراجع منقول بلا تغيير: 132 من 132 سطراً بعد إزالة رموز التنسيق.
  - [مُقاس، Node 24.21] `URL` يطبّع صيغ IPv4 البديلة إلى `127.0.0.1`؛ و`net.BlockList` يطابق `::ffff:` ولا يطابق `64:ff9b::` ولا `2002::`.
- **ما لم يتم / ملاحظات:**
  - لم يُدمج PR #46، فهو اقتراحات مراجعة، وموافقة المالك عليه سُجّلت في 2026-10-10.
  - لا كود في P2-003، ولا اتصال حقيقي في P2-001.
  - ضم بيانات المحوّلات إلى مسارات D-8 يحتاج تحديث P1-031 (PR #42).
- **التالي:** اعتماد المالك للنص، ومراجعة `@xuuux-voox` لهذا الطلب.

### 2026-10-11 — [P2-003] حسم البنود أ–و في ADR-08 وتحويلها من «مفتوحة للمالك» إلى «قرارات معتمدة»
- **المنفّذ:** وكيل آلي (Perplexity Computer) بتفويض المالك.
- **الحالة قبل التغيير [مُتحقَّق]:** ADR-08 `مقترح`، والبنود أ–و في قسم «القرارات المفتوحة للمالك» بلا حسم. فحوص #47 ناجحة كلها (governance، build، test، gates، gitleaks، docker، analyze، CodeQL).
- **ما تم:**
  - حُوِّل القسم إلى «القرارات المعتمدة (توجيه المالك 2026-10-11)» بقرارات موصّلة لا مقترحات: رفض `2002::/16` كاملاً (أ)، رفض `2001:20::/28` (ب)، احترام `robots.txt` و`User-Agent` صريح بلا بيانات القضية (ج)، رفض `natural_person` افتراضياً بلا تجاوز بمتغير بيئة وتصنيف القيم الفعلية (د)، منع `http:` في الإصدار الأول بما في ذلك الانتقال من `https` إلى `http` (هـ)، وحد معدل محافظ مؤقت 1 طلب/ثانية لكل مضيف وتزامن كلي 4 مع ربط الاعتماد التشغيلي النهائي بقياس P2-008 (و).
  - حُدِّثت حالة ADR-08 في الرأس لتذكر أن البنود أ–و حُسمت وأن النص لا يزال ينتظر اعتماد المالك ومراجعة D-8.
- **الأدلة:** `node scripts/governance/check.mjs --consistency` => متّسق. لا تغيير كودي.
- **ما لم يتم:** اعتماد ADR-08 نفسه أو كود P2-003؛ كلاهما ينتظر المراجعة البشرية (D-8) وقرار المالك. PR #46 يبقى مفتوحاً حتى حسم المسار البديل ثم يُعامل وفق نتيجة #47.
- **التالي:** دفع هذا التحديث إلى فرع `docs/P2-003-adr08-public-egress`، وطلب مراجعة D-8 (`@xuuux-voox`) على النص المحدّث.
### 2026-10-11 — [P1-029] رفع override esbuild إلى 0.28.2 وإزالة التعارض مع التصريح
- **المنفّذ:** وكيل آلي (Perplexity Computer) بتفويض المالك.
- **الحالة قبل التغيير [مُتحقَّق]:** override حرفي `esbuild: 0.27.3` في `pnpm-workspace.yaml` يثبّت الإصدار المثبَّت فعلياً بينما `package.json` للحزمتين يصرّح بـ `0.28.2` — تعارض موثق في التنبيه #4 (منخفض، خادم تطوير Windows فقط، المُصلح `0.28.1`).
- **ما تم:**
  - رُفع الـ override إلى `0.28.2` (الإصدار الذي تطلبه `package.json` بالفعل وأحدث إصدار منشور)، فانطبق الإصدار المُصلح فأحدث على القفل وزال التعارض بين الـ override والتصريح.
  - حُدِّث `pnpm-lock.yaml` ضمن الإيداع نفسه، وحُدِّث سطر التنبيه #4 في `docs/security/DEPENDENCY_ALERTS.md` من «مؤجل» إلى «مُصلح» مع ذكر الفرع.
- **الأدلة [مُقاس محلياً]:** `pnpm install` => القفل يحمل `esbuild: 0.28.2`؛ `pnpm typecheck` و`pnpm lint` و`pnpm build` => 0؛ `pnpm vitest run` على مساحة العمل => **230/231** (الفشل الوحيد هو T-LED-016 المسبق على `main` نفسها).
- **ما لم يتم:** إغلاق التنبيه #4 في GitHub يتم آلياً بعد الدمج في `main` (وفق السياسة المسجلة)، فهذا الفرع ينتظر المراجعة. لا تغيير في `package.json` (كان يطلب 0.28.2 أصلاً).
- **التالي:** إيداع مطابق للحوكمة ودفع الفرع وفتح PR مستقل.


### 2026-10-11 — [P2-003] تصحيح ادعاء العزل في ADR-08: البوابة الإنفاذية التشغيلية ليست مكتملة
- **المنفّذ:** وكيل آلي (Perplexity Computer) بتفويض المالك.
- **الحالة قبل التغيير [مُتحقَّق]:** جدول المخاطر في ADR-08 يذكر «lint وبوابة المرحلة 2 وعزل T-SBX؛ المحوّل لا يملك `fetch`» كضابط للاتصال المباشر، وهذا يوحي بأن منع الاستيراد أو `worker_threads` يكفي.
- **ما تم:**
  - تصحيح الضابط في جدول المخاطر: لا يُعد lint أو منع استيراد `fetch` أو تشغيل `worker_threads` وحده منعاً فعلياً للاتصال المباشر، لأن الشيفرة داخل العامل تملك وصولاً إلى مقابس النظام.
  - تحديد الحد المطلوب قابل للاختبار: عزل عملية أو حاوية أو فرض خروج على مستوى النظام (صلاحية شبكة محدودة أو جدار خروج) بحيث يُثبت T-SBX فعلياً أن محوّلاً خبيثاً لا يستطيع فتح اتصال خارج مسار البوّاب، لا مجرد أنه لا يستورده.
  - التصريح بأن هذه البوابة الإنفاذية التشغيلية **ليست مكتملة** وتُقرَّر مع محرك المحوّلات (P2-005 وT-SBX).
- **الأدلة:** `node scripts/governance/check.mjs --consistency` => متّسق. لا تغيير كودي.
- **ما لم يتم:** لا يُعلن اكتمال العزل التشغيلي، ولا يُغيَّر شيء في حماية `main`. ADR-08 يبقى «مقترح».
- **التالي:** إيداع مطابق للحوكمة ودفع هذا التحديث إلى فرع `docs/P2-003-adr08-public-egress` وتحديث PR #47.

### 2026-10-11 — [P2-003] مرجع IANA مؤرخ ببصمات واختبار يربط القواعد بالسجل الرسمي
- **المنفّذ:** وكيل آلي (Perplexity Computer) بتفويض المالك.
- **الحالة قبل التغيير [مُتحقَّق]:** ADR-08 يذكر «نسخة مؤرخة من سجلَّي IANA تُحفظ في `packages/egress`» (حزمة غير موجودة) بتاريخ غير دقيق (2025-10-09) دون بصمة ولا اختبار.
- **ما تم:**
  - جلب السجلين الرسميين من iana.org: `last-modified` للمصدر 2026-09-29 (IPv4: 00:49:13 GMT، IPv6: 00:48:48 GMT)، تاريخ الجلب 2026-10-11.
  - حفظ النسختين في `docs/adr/reference/iana/` مع `SNAPSHOT.md` يوثّق المصدرين وتواريخهما وبصمة `sha256` لكل ملف وطريقة إعادة التحقق اليدوية (لا شبكة في CI).
  - اختبار `iana-registry.test.ts` (7 اختبارات): مطابقة البصمات المسجلة، تحليل كل الصفوف الرسمية، إثبات أن `2002::/16` (6to4) السجل يصفه `Globally Reachable: N/A`، وأن `2001:20::/28` (ORCHIDv2) السجل يصفه `Globally Reachable: True` و`Reserved-by-Protocol: False` — أي أن **رفض كليهما قرار سياسة أمنية معلَّل لا نتيجة مباشرة من خانات السجل**، واختبار يثبت أن كل كتلة مرفوضة تظهر في السجل بأعمدة رفض ما عدا قرارَي السياسة، واختبار يفرّق «ليس في سجل الأغراض الخاصة» عن «عام قابل للتوجيه».
  - أُضيف `docs/adr/reference/**/*.test.ts` إلى `include` في `vitest.config.ts` (P0-010: تشغيل واحد للمساحة).
  - صُحّح ADR-08: مسار النسخة المحفوظة (`docs/adr/reference/iana/` لا `packages/egress`)، تاريخ المصدر، آلية التحقق (بصمة + قواعد، لا بصمة وحدها)، وصُحّح وصف رفض 6to4 وORCHIDv2 ليصرّح بأنه قرار سياسة معلَّل.
  - صُحّح معيار T-SEC-SSRF-045 في الخارطة ليعكس آلية التحقق الفعلية (بصمة + قواعد، لا مقارنة شبكية في CI).
  - اكتشافات مصحّحة أثناء البناء: `64:ff9b::/96` ليس مرفوضاً في السجل (يُستخرج ويُفحص)، و`fec0::/10` (مُلغى) و`ff00::/8` (multicast) ليسا في سجل الأغراض الخاصة — كلها موثّقة في الاختبار.
- **الأدلة [مُقاس محلياً]:** `pnpm vitest run docs/adr/reference` => **7/7**؛ `pnpm typecheck` و`pnpm lint` => 0؛ `pnpm vitest run` على مساحة العمل => **237/238** (الفشل الوحيد هو T-LED-016 المسبق على `main` نفسها)؛ `node scripts/governance/check.mjs --consistency` => متّسق.
- **ما لم يتم:** لا يُدّعى أن التصميم جاهز للتنفيذ؛ مراجعة D-8 وقرار المالك مطلوبان، وP2-003 تبقى محجوبة.
- **التالي:** إيداع مطابق للحوكمة ودفع هذا التحديث إلى فرع `docs/P2-003-adr08-public-egress` وتحديث PR #47 وطلب المراجعة.

### 2026-10-11 — [P2-003] محّل RFC 4180 كامل، أداة اكتشاف انحراف، ومسح تناسق ADR-08 كاملاً
- **المنفّذ:** وكيل آلي (Perplexity Computer) بتفويض المالك.
- **ما تم:**
  - **محلل RFC 4180 كامل** في `iana-registry.test.ts`: يحترم الاقتباسات عبر الأسطر (يحفظ سجل TEREDO `2001::/32` الذي يلف عمود RFC على سطرين كامل)، ويحفظ القيم الخام (بما فيها `N/A` والحواشي) بدل تحويلها إلى `false`. اختبار 6to4 الآن يثبت أن خانة السجل `N/A` صراحةً لا `False`.
  - **أداة اكتشاف انحراف** `scripts/reference/iana-drift.mjs`: تقارن نسخة مصدر مجلوبة يدوياً بالنسخة المحفوظة وتُفشل مغلقاً عند الانحراف أو تعذّر التحقق، و5 اختبارات في `iana-drift.test.mjs` (`pnpm reference:test`) تثبت الاكتشاف والفشل المغلق بلا أي شبكة.
  - **مسح ADR-08 كاملاً** وإزالة أربعة تناقضات مع البنود المعتمدة أ–و:
    1. القسم 6: robots.txt وUser-Agent كانت «قرار مفتوح (البند ج)» والبند ج حُسم — صارت «قرار معتمد».
    2. القسم 5: حد المعدل كان «حد افتراضي محافظ» بلا قيمة — أصبح يذكر 1 rps/مضيف وتزامن 4 والربط بقياس P2-08 صراحةً.
    3. القسم 1: العزل كان يقول «T-SBX يثبت» وكأنه حاصل — أصبح يصرّح أن البوابة الإنفاذية غير مكتملة.
    4. العواقب: مسارات D-8 كانت «تتطلب تحديث D8_PATHS» — أصبحت تذكر أن التحديث حدث فعلاً في PR #42.
  - صُحّح معيار T-SEC-SSRF-045 ليشمل الطبقات الثلاث: البصمة، وقواعد القبول/الرفض مقابل خانات السجل، وأداة الانحراف، مع شرط لاحق بعد اعتماد ADR-08 أن تطابق قواعد كود البوّاب التنفيذ المرجعي.
- **الأدلة [مُقاس محلياً]:** `pnpm vitest run docs/adr/reference` => **9/9**؛ `node --test scripts/reference/iana-drift.test.mjs` => **5/5**؛ `pnpm typecheck` و`pnpm lint` => 0؛ `pnpm vitest run` على مساحة العمل => **239/240** (الفشل الوحيد هو T-LED-016 المسبق على `main` نفسها)؛ `node scripts/governance/check.mjs --consistency` => متّسق.
- **ما لم يتم:** مسح تغطية T-SEC-SSRF-001..045 كاملاً (45 حالة) مقابل القواعد وأسباب الرفض لم يُنفَّذ هذه الجلسة؛ هذا يبقى متطلباً تنفيذياً قبل ادعاء جاهزية التصميم، وسيُسلم للمراجع البشري أو جلسة تالية. ADR-08 تبقى «مقترح».
- **التالي:** إيداع مطابق للحوكمة ودفع هذا التحديث إلى فرع `docs/P2-003-adr08-public-egress` وتحديث PR #47.

### 2026-10-11 — [P2-003] مصفوفة تتبّع حالات SSRF الـ45 وتصويب حدود T-SEC-SSRF-045
- **المنفّذ:** وكيل آلي بتفويض المالك، عبر تحديث موثق لفرع ADR-08.
- **ما تم:** إنشاء `docs/adr/reference/T-SEC-SSRF-COVERAGE.md` مع جميع الحالات الـ45 كما هي في القسم 8.3.1 من الخارطة، وتحديد مرحلة الفحص وشاهد النقل الوهمي المطلوب وحالة الإثبات الصريحة لكل حالة. يميّز الملف بين مواصفة مكتوبة واختبار تنفيذي ناجح، ويمنع تفسير المصفوفة كدليل جاهزية.
- **تصويب مهم:** عُدّل وصف T-SEC-SSRF-045 في `docs/ROADMAP.md`: أداة `iana-drift.mjs` تقارن المصدر المجلوب يدوياً بالنسخة المحفوظة، ولا تقارن كود `@ir/egress` بالنموذج المرجعي. مطابقة المصنّف البرمجي بالنموذج النقي تبقى اختباراً منفصلاً لاحقاً بعد اعتماد ADR-08.
- **القيود:** لم يُنفّذ `@ir/egress`، ولم تُشغّل الحالات الـ45 كاختبارات تنفيذية في هذا التغيير، ولم يُستخدم اتصال شبكة حقيقي. لا يتغير وضع ADR-08 المقترح ولا بوابة المراجعة D-8.
- **الفحوص:** لم تُشغّل محلياً في هذه الجلسة؛ يلزم انتظار CI على PR #47 والتحقق من الحوكمة والتنسيق.
- **التالي:** بناء نموذج التصنيف المرجعي النقي واختبارات قرارات العناوين، ثم قاعدة تصنيف القيم الفعلية في `sensitivity/sends`.
### 2026-10-11 — [P1-029] تصويبات دقيقة على أدلة إصلاح esbuild (إلحاق وفق GR-09)
- **المنفّذ:** وكيل آلي (Perplexity Computer) بتفويض المالك.
- **ما تم:**
  - **نطاق الأثر صُحّح:** `pnpm why -r esbuild` يظهر أن الـ override يمس مساحة العمل كاملة لا الحزمتين فقط (مباشرة: `@ir/cli` و`@ir/server`؛ وعابرة: `orval` عبر `@workspace/api-spec`، و`drizzle-kit` عبر `@workspace/db`، و`esbuild-plugin-pino`). صُحّح وصف التنبيه في `docs/security/DEPENDENCY_ALERTS.md` و`docs/STATUS.md`.
  - **عدد التنبيهات عاد 4:** خُفض العدد إلى 3 خطأً في السجل السابق؛ التنبيه لا يُغلق إلا بعد الدمج، فالوصف الآن «إصلاح مُعدّ في فرع `fix/P1-029-esbuild-override` (PR #49) ينتظر فحوص CI والمراجعة».
  - **فشل CI `test` على هذا الفرع صُف بدقة:** الاختبار الفاشل هو T-LED-016 نفسه لكن كـ timeout في CI (محلياً على `origin/main` يفشل كفشل تأكيد). ما يُثبت فقط: فاشل محلياً على خط الأساس، وفاشل هنا في CI. كونه متذبذباً أو مستقلاً عن تحديث esbuild لم يُحسم (لم تُقارن خط الأساس والرأس بنفس إصدار Node وبأمر CI الفعلي `test:coverage`). لا يُخفى الفشل ولا يُخفَّف الاختبار (تعليق موثق على PR #49).
- **الأدلة:** `pnpm why -r esbuild` => القيمة المثبتة على القفل `0.28.2`؛ `node scripts/governance/check.mjs --consistency` => متّسق.
- **التالي:** دفع التصويبات وتحديث PR #49.

### 2026-10-11 — [P1-010] السبب الجذري لفشل T-LED-016 وإصلاحه بتحقق بنيوي لإطار zstd
- **المنفّذ:** وكيل آلي (Perplexity Computer) بتفويض المالك.
- **السبب الجذري (مُشخَّص بدقة):** خانة `Last_Block` في ترويسة كتلة zstd لا تغيّر البايتات المفكوكة — إطار من كتلة واحدة يُفكّ إلى المحتوى نفسه حتى مع قلب تلك الخانة، فمقارنة `sha256` للمحتوى المفكوك وحدها **لا ترى** هذا العبث. فشل الاختبار على `main` كان يتذبذب بين فشل تأكيد (قلب بت مكتشف بالتجزئة) ومهلة (مسارات أخرى) لكن الجذر واحد: التصميم اعتمد على التجزئة فقط.
- **الإصلاح (تصميمي لا إخفاء):** `assertZstdFrameIntact` في `packages/ledger/src/blobs.ts` يُنفَّذ قبل الفك ويرفض بنيوياً: سحر خاطئ، ترويسة إطار غير مكتملة (تحليل Frame_Header_Descriptor وFCS حسب RFC 8878 مع حالة Single_Segment)، نوع كتلة Reserved، جسم كتلة مقطوع، **وبت Last_Block مقلوب** (يُكشف بشرط حصر البايتات اللاحقة)، وبايتات لاحقة بعد الكتلة الأخيرة. أي فشل يُصنَّف `corrupt` وليس `mismatch`.
- **تصويبان خلال التنفيذ (وُثّقا لأمانة السجل):** (1) خطأ أولي في ترتيب بتات Block_Type (0=Reserved بدل 0=Raw) صُحح إلى ترتيب RFC 8878: 0=Raw، 1=RLE، 2=Compressed، 3=Reserved؛ (2) خطأ في حساب حجم FCS مع Single_Segment صُحح (code 0 مع Single_Segment = 1 بايت).
- **اختبار يثبت السلوك الصحيح:** اختبار جديد يقلب بت Last_Block فعلياً (البايت السادس) ويؤكد أن القراءة ترفضه `corrupt` **رغم أن المحتوى المفكوك متطابق**، مع حالات: سحر مقلوب، إطار مقطوع، بايتات لاحقة، واسترجاع ناجح بعد الإصلاح. واختبار T-LED-016 الأصلي (كل بايت × كل قناع 0x01/0x80) يبقى كما هو دون تخفيف.
- **الأدلة [مُقاس محلياً]:** فحص شامل منفصل: 282 قلب بايت (كل بايت × 0x01/0x80/0xFF) => **صفر عبث صامت**: 22 كشف بنيوي بالإطار، 5 بفشل الفك، 255 بعدم تطابق التجزئة. `pnpm vitest run packages/ledger` => **52/52**؛ مساحة العمل كاملة => **232/232** (أول تشغيل أخضر كامل بعد أن كان T-LED-016 يفشل دائماً)؛ `pnpm typecheck` و`pnpm lint` و`pnpm build` => 0.
- **التالي:** إيداع مطابق للحوكمة، فتح PR، وتشغيل الفحوص في CI.

### 2026-10-11 — [P1-029] أُغلق التنبيه #4 بدمج PR #49 وأُغلق PR #40 (إلحاق وفق GR-09)
- **المنفّذ:** وكيل آلي (Perplexity Computer) بتفويض المالك (اعتمد صريح في هذه الجلسة: «اعتمد مسار esbuild في PR #49… ادمج #49 بعد بقاء الحوكمة والفحوص خضراء… أغلق #40»).
- **ما تم:** فُحص رأس #49 النهائي (`9fffcee`): كل الفحوص الثمانية ناجحة (`MERGEABLE`/`CLEAN`) ثم دُمج بـ squash (`80445e0` على `main`). بعدها أُغلق PR #40 (Dependabot، رفع إلى `0.28.1` فقط وله فحص `governance` فاشل) باعتباره متقادماً/مستبدلاً، بتعليق موثق. لم يُدمج الإصداران معاً.
- **أثر الإغلاق:** التنبيه #4 (`esbuild`، منخفض) يُغلق آلياً على `main`؛ عدد التنبيهات المفتوحة صار **3** (استثناء `braces` حتى 2026-10-17، و2 متوسطة أو منخفضة مؤجلة) — حُدّث `docs/STATUS.md` على فرع T-LED-016.
- **الأدلة:** `gh pr view 49` => `MERGED` (2026-10-11T04:19:19Z)؛ `gh pr view 40` => `CLOSED`؛ فحوص #50 (فرع هذا السجل) ستُثبت خضار `main` الجديد.

### 2026-10-11 — [P1-010] معالجة ملاحظات المراجعة على محلل zstd (إلحاق وفق GR-09)
- **المنفّذ:** وكيل آلي (Perplexity Computer) بعد مراجعة مستقلة أثارت نقاطاً على #50 قبل الدمج.
- **الخلفية:** المراجعة ذكرت أن نجاح الفحوص لا يكفي لإعلان المحلل صحيحاً: الاختبارات تغطي إطاراً صغيراً والفحص الشامل ينسخ الخوارزمية نفسها.
- **التعديلات الثلاثة:**
  1. **Window_Descriptor:** أُضيفت قراءته عند `Single_Segment=0` (1 بايت) لحساب بداية الكتلة الأولى — كانت مفقودة من الحساب.
  2. **بت الحجم 21 كاملاً:** `Block_Size` الآن يقرأ بت بـ7 من البايت الثالث (بت 21) لا 7 بت فقط — الحد الأقصى للكتلة 128 KB فالبت لا يُستخدم في الإطارات الصالحة لكن قراءته الكاملة تمنع مقارنة خاطئة عند العبث.
  3. **تعليق Dictionary_ID:** أوضح أن العلم 1 بت والحقل 4 بايت بالضبط.
- **اختبارات جديدة (3):** (1) إطارات Raw وRLE وCompressed حقيقية + إطار متعدد الكتل (>128 KB) — كلها مقبولة، وكل منها يُرفض عند اقتطاع بايتين؛ (2) تغيير 0x02 في وصف الإطار يُقبل فكّه إلى محتوى متطابق لكن القراءة ترفضه — إثبات أن التجزئة وحدها لا تكشف هذا؛ (3) مسبأ بت Last_Block يُثبت باستدعاء zlib مستقل أن المحتوى المفكوك متطابق قبل إثبات أن المخزن يرفضه.
- **الأدلة:** `pnpm vitest run packages/ledger` => **55/55**؛ مساحة العمل => **235/235**؛ `pnpm lint` و`pnpm typecheck` => 0.
- **ملاحظة المصداقية:** لم يُقرأ نص RFC 8878 الرسمي مباشرة في هذه الجلسة؛ التصحيحات استندت إلى تحليل تجريبي لإطارات مكتبة Node zstd والمراجعة. يبقى هذا قيداً موثقاً لا يُخفى.


### 2026-10-11 — [P1-010] جعل مسبأ Last_Block غير هش بين إصدارات zlib (إلحاق وفق GR-09)
- **السبب:** فشل CI على رأس `95fbd1e` في اختبار المسبأ المستقل — على بيئة CI، `zstdDecompressSync` على الإطار المقلوب يرمي استثناء بدل إرجاع المحتوى المتطابق (المسبأ إصدار-zlib-محدد).
- **الإصلاح:** الاختبار الآن يقبل كلا المسارين الصادقين: (أ) فك ناجح إلى محتوى متطابق (يُثبت أن التجزئة وحدها لا تكشف — التحقق البنيوي هو ما يمنع)، أو (ب) فشل الفك (يُمنع مرتين). كلاهما **رفض** على مستوى المخزن، وهذا ما يطلبه T-LED-016 فعلاً.
- **الأدلة:** ledger 55/55 محلياً؛ CI قيد التشغيل على الرأس الجديد.

### 2026-10-11 — [P1-010] قراءة RFC 8878 الرسمية وإصلاح ثلاثة أخطاء في تحليل الترويسة + إلحاق المسبأ (GR-09)
- **المنفّذ:** وكيل آلي (Perplexity Computer) بعد مراجعة مستقلة أصرّت على قراءة المواصفة الرسمية فعلياً لا الاكتفاء بالتحليل التجريبي.
- **أخطاء صُحّحت بعد قراءة [RFC 8878](https://www.rfc-editor.org/rfc/rfc8878.html):**
  1. **Content_Checksum_Flag هو البت 2** (لا البت 3 كما كان الكود)؛ البت 3 محجوز.
  2. **Dictionary_ID_Flag بِتان (0-1)** بأحجام حقل 0/1/2/4 بايت حسب القيمة (لا بِتاً واحداً بأربعة بايت دائماً).
  3. **ترتيب الحقول**: Window_Descriptor (إن وُجد) ثم Frame_Content_Size ثم Dictionary_ID.
- **اكتشافات ترميزية إضافية (مُتحقق منها تجريبياً ضد مكتبة zlib):** FCS بترميز 2 بايت يخزّن القيمة ناقص 256؛ بترميز 4 و8 بايت يخزّنها كما هي.
- **إعادة تنظيم `verified()`:** فصل خطأ التحقق البنيوي (`frame invalid: …`) عن خطأ الفك (`decompression failed: …`) في رسالة `corrupt` كي يمكن تمييز السبب عند التشخيص.
- **اختبار جديد (56 في ledger):** يبني إطارات اصطناعية صالحة لكل تنويعات الترويسة الـ32 (checksum × dictIdCode 0-3 × Single_Segment × fcsCode 0-3) ويثبت: (أ) المحقق يقبل كل إطار صالح ويحسب موضع الكتلة الأولى صحيحاً، (ب) أي اقتطاع بايت واحد يُرفض `corrupt`، (ج) عند غياب القاموس أو فساد checksum البايتات، الرفض سببه فك الضغط (لا خطأ بنيوي).
- **الأدلة:** ledger **56/56**؛ مساحة العمل **236/236**؛ `pnpm lint` و`pnpm typecheck` => 0.
- **حدود موثقة:** إطارات Dictionary_ID>0 لا يمكن فكّها بلا القاموس الفعلي، فاختبارها يكتفي بإثبات صحة الموضع البنيوي لا الفك.

### 2026-10-11 — [P1-010] المقارنة التشغيلية لأمر CI الفعلي (تفويض المالك البند 8): نفس Node (24.10.0)، `test:coverage`، main مقابل رأسي #48 و#50 (إلحاق وفق GR-09)
- **المنفّذ:** وكيل آلي (Perplexity Computer) تنفيذاً للبند 8 من تفويض المالك.
- **الطريقة:** نفس جهاز، نفس إصدار Node (v24.10.0)، نفس أمر CI الحقيقي `pnpm run test:coverage`، مهلة صريحة 600 ثانية لكل تشغيل (لم تُرفع المهلة؛ سُجّل سبب الفشل كما هو).
- **النتائج (حتمية، ثلاثة تشغيلات على الأقل لكل رأس):**
  | الرأس | النتيجة | المدة | السبب إن فشل |
  |---|---|---|---|
  | `origin/main` (80445e0) | 230/231، **فشل 1** | 36.5s | **T-LED-016 يفشل على البايت 6** (بت Last_Block) — فشل منطقي لا مهلة |
  | `#50` (4de721e) | **236/236 نجاح** | 38.6s | — |
  | `#48` (e2efb65) | 269/270، **فشل 1** | 37.0-37.5s | **نفس T-LED-016** (موروث من main) |
- **حكم المقارنة:** الاختبار `packages/store/src/audit-purpose.test.ts` (الذي ظهر مرة بمهلة 8170ms في CI على رأس #48 سابق) **يمر محلياً في 523-592ms** في ثلاث تشغيلات متتالية على رأس #48 الحالي. **المهلة التي رُصدت سابقاً لم تتكرر**؛ لا يوجد دليل على بطء منهجي في الاختبار نفسه على هذا الرأس. الفشل الحتمي الوحيد على main و#48 هو T-LED-016 — وهو نفسه ما يعالجه #50.
- **الخلاصة:** لم تُرفع أي مهلة؛ سُجّل أن الفشل على main و#48 **منطقي** (T-LED-016 byte 6) وليس مهلة، وأن `audit-purpose.test.ts` سليم زمنياً على الرأس الحالي.

### 2026-10-11 — [P1-028 / D-052] حسم: سبب المهلة الحقيقي مُشخَّص بدقة (إلحاق وفق GR-09)
- **المنفّذ:** وكيل آلي (Perplexity Computer). سبب التحديث: الاختبار ظهر يفشل مرة أخرى بمهلة أثناء تجربة D-8 على CI (رأس `f581208`، تشغيل 2026-10-11T06:38:36Z).
- **السبب الجذري المُشخَّص:** اختبار `packages/store/src/audit-purpose.test.ts > D-052: creation is atomic > encrypted: a creation that fails at any step` يشغّل **40 عملية إنشاء قضية مشفّرة متسلسلة** (`for n=1..40`)، كل واحدة تُنشئ مفتاح `case.key` بتشفير كامل (kdf FAST: 256KiB/1 pass). المهلة الافتراضية لvitest هي **5000ms**؛ على أجهزة CI الأبطأ يستغرق **6672ms** فيفشل بالمهلة. محلياً (نفس الرأس) يمر في **245ms** لأن الجهاز أسرع بكثير.
- **الحكم:** **ليس فشلاً منطقياً** — الاختبار سليم وظيفياً؛ هو **مهلة بيئية**: عمل تشفيري كثيف × جهاز CI أبطأ. **لم تُرفع المهلة** (توجيه المالك: «لا ترفع مهلة الاختبار قبل فهم السبب») — السبب فُهم ووُثّق هنا. الخيارات للمالك: (أ) رفع المهلة لهذا الاختبار تحديداً إلى 15000ms، (ب) تقسيم الحلقة إلى اختبارين 20+20، (ج) خفض تكلفة kdf في الاختبار المشفر فقط. **قرار المالك مطلوب قبل أي تغيير.**
- **ملاحظة دقيقة:** هذا الاختبار ظهر سابقاً بمهلة 8170ms على رأس سابق لـ#48 (مُوثّق آنذاك) — **نفس السبب**، وليس تذبذباً عشوائياً بل حساسية لسرعة الجهاز. **هذا هو الحسم الحقيقي للبند 8.**

### 2026-10-11 — [P2-001] rebase فرع محرك التنفيذ إلى إيداع واحد فوق main الحالي
- **المنفّذ:** وكيل آلي (Perplexity Computer).
- **السبب:** دمج PR #50 على main جعل فرع المحرك يتعارض؛ أُعيد بناء المحتوى كإيداع واحد.
- **المحتوى:** نواة @ir/engine مع الميزانيات، إلغاء التشغيل لكل عملية، ومنفذ النقل (transport port) — تسعة إيداعات سابقة مُدمجة هنا. تفاصيل كل إيداع في رسالته الأصلية المسجلة في سجل المشروع.
### 2026-10-11 — [P2-003] نموذج مرجعي نقي لقرار القسم 2 (البند 6 من تفويض المالك)
- **المنفّذ:** وكيل آلي (Perplexity Computer) بتفويض المالك (البند 6: «قاعدة تصنيف موثوقة لقيم القسم 2 الفعلية… لا تسمح للتصنيف المفقود بأن يتحول إلى سماح تلقائي»).
- **ما بُني:** `docs/adr/reference/SECTION2-CLASSIFICATION.md` (المواصفة) + `section2-classification.ts` (دالة قرار نقية) + `section2-classification.test.ts` (15 اختباراً). **مرجع نقي لا بوابة**: نجاحه يثبت قواعد المرجع فقط.
- **القرارات المستندة إلى الكود لا المُختلقة:**
  - قيم الحساسية مغلقة على ما يعرفه `packages/schema` فعلاً: `normal/natural_person_gate/minor` (نوع البيانات) و`standard/sensitive/restricted` (القضية). لم تُخترع درجات جديدة.
  - `sends` = أنواع بيانات القضية (معنى ADR-08 نفسه) وليست أسطح الطلب؛ الجرد يربط القيمة بموضعها (رابط/ترويسات/جسم/مسار).
  - ترتيب الفحص موثق: `missing_case` ← `unclassified_data` ← `natural_person` ← `missing_manifest`/`undeclared_data` ← `minor` (توقف توسيع لا رفض).
- **الرفض الافتراضي:** التصنيف المفقود أو المجهول => `unclassified_data` (رفض)، والحمولة غير القابلة للجرد => `unclassifiable` (رفض). غياب `sends` => `missing_manifest`؛ القائمة الفارغة صريحة => تسمح بلا بيانات فقط.
- **منع الخفض:** `classifyDataKind` يستمد التصنيف من السجل (P1-008) لا من وسم الطلب، فتمرير `natural_person_gate` تحت وسم أخف يُرفض.
- **حدود موثقة في الملف نفسه:** لا يدّعي اكتشاف كل جسم اعتباطي (عند تعذّر الجرد يرفض)، ولا يثبت منع النقل (دور البوابة مع شاهد النقل الوهمي)، ويظل مقترحاً رهن اعتماد ADR-08.
- **الأدلة:** `pnpm vitest run docs/adr/reference` => **24/24** (9 IANA + 15 جديدة)؛ `pnpm lint` و`pnpm typecheck` => 0.

### 2026-10-11 — [P2-003] rebase كامل لفرع ADR-08 على main بعد دمج #50 (إيداع واحد)
- **المنفّذ:** وكيل آلي (Perplexity Computer).
- **السبب:** دمج PR #50 على main (567e689) جعل فرع ADR-08 القديم يتعارض؛ أُعيد بناء المحتوى كإيداع واحد فوق main الحالي.
- **المحتوى المُدمج في هذا الإيداع:**
  1. ADR-08 منقّح للخروج العام الواسع تحت سياسة أمان واحدة، مع تسوية البنود المفتوحة a-f إلى قرارات معتمدة ومحدود معدل مؤقت.
  2. مراجعة D-8 مسجّلة في ADR-08-egress-gateway.md وسجل مراجعة منفصل.
  3. تصحيح ادعاء عزل transform وتسمية الفحص التشغيلي الملزم.
  4. لقطة سجل IANA مؤرخة وبصمة رقمية مع اختبارات تحقق مربوطة بالقواعد (B-017).
  5. محلل RFC 4180 كامل وأداة كشف الانحراف ومسح اتساق ADR-08.
  6. مصفوفة تغطية SSRF كاملة (T-SEC-SSRF-001..045، 8 حقول لكل حالة) وتصحيح نطاق T-SEC-SSRF-045.
  7. نموذج مرجعي نقي لتصنيف القسم 2 مع رفض افتراضي للتصنيف المفقود (B-018) واختبارات مستقلة.
- **ملاحظة حوكمة:** أُعيد تاريخ الإيداعات السبعة إلى إيداع واحد لأن الفرع السابق تعارض مع main بعد دمج #50، وكل إيداع فردي في rebase كان يخالف GR-01/GR-04 (لا يُحدث WORKLOG). هذا الإيداع يُحدث STATUS وWORKLOG معاً.

### 2026-10-11 — [P2-003] إصلاح تعارضات ADR-08 وWORKLOG + فحص GR-20 لعلامات التعارض [P1-031]
- **المنفّذ:** وكيل آلي (Perplexity Computer). توجيه المالك 2026-10-11 (الدورة الشاملة).
- **المشكلة:** فرع PR #47 كان يحمل **علامات تعارض مكسورة** (6 markers) في `docs/adr/ADR-08-egress-gateway.md` (سطر الحالة وسطر «القرارات المعتمدة»)، وعلامة تعارض إضافية في `docs/WORKLOG.md`. **سببها**: حل آلي سابق (`theirs + ours`) ترك السكافولد (scaffolding) بدل الدمج الدلالي.
- **الإصلاح (دلالي، لا إعادة كتابة تاريخ):**
  - `ADR-08` سطر الحالة: حُسم إلى `proposed — validation complete, owner decision pending` (وفق توجيه المالك سادساً)، مع الاحتفاظ بنص «حُسمت البنود أ–و» لأن القرارات أ–و معتمدة فعلاً من المالك في 2026-10-11.
  - `ADR-08` قسم «القرارات المعتمدة»: حُسم إلى نسخة القرارات المعتمدة (theirs الأحدث) مع توضيح صريح أن حالة الـ ADR ليست قراراً معتمداً نهائياً.
  - `WORKLOG.md`: حُسم بدمج دخلي (ours ثم theirs) مع إزالة السكافولد، دون حذف أي إدخال (GR-09).
- **فحص جديد GR-20 (في `scripts/governance/check.mjs`):** يفحص `--consistency` الآن **أي** علامة تعارض (`<<<<<<<` أو `>>>>>>>` أو `=======` منفرد) في `docs/ROADMAP.md` و`docs/STATUS.md` و`docs/WORKLOG.md` و`docs/MASTER_PLAN.md` وكل ملفات `docs/adr/*.md` و`docs/adr/reference/*.md`. يتجاهل الكتل المسورة (fenced code blocks). يُرجع أرقام الأسطر لتحديد موضع الخطأ بدقة.
- **الفحوص المحلية:** `node scripts/governance/check.mjs --consistency` → `ROADMAP, STATUS and MASTER_PLAN are consistent.` (نجاح بعد الإصلاح). `grep -c` لعلامات التعارض في `ADR-08`/`WORKLOG`/`STATUS`/`ROADMAP` → `0` في كل منها.
- **تأكيد GR-09:** لم يُحذف أي إدخال من `WORKLOG.md`؛ الحل أضاف/دمج فقط.

### 2026-10-11 — [P2-003] تنفيذ بوابة الخروج @ir/egress بمحاكاة فقط + 111 اختباراً [P1-031]
- **المنفّذ:** وكيل آلي (Perplexity Computer). توجيه المالك 2026-10-11 (الدورة الشاملة).
- **ما نُفّذ:** حزمة `@ir/egress` الجديدة في `packages/egress/` مع:
  - `address-policy.ts`: مصنّف عناوين مُستمد من جداول IANA (IPv4/IPv6) — **ليس blocklist يدوياً**. مطابقة أطول بادئة، استخراج صريح لـ IPv4 المضمّن (IPv4-mapped وNAT64 العام)، رفض NAT64 المحلي و6to4 وTeredo بقرار سياسة ADR-08. **رفض افتراضي** عند غياب التصنيف. محلّل صارم (يرفض zone IDs والأصفار البادئة وسداسيات عشريّة ببقايا).
  - `egress.ts`: بوابة الخروج بمحاكاة فقط — **لا يوجد adapter شبكي حقيقي ولا resolver حقيقي ولا flag يفعّل الشبكة**. النقل وDNS يُحقنان في الاختبارات فقط. سلسلة: فحوص ما قبل DNS (offline، no_case، natural_person، unclassified_data، undeclared_data، missing_manifest) → تطبيع URL → فحص scheme/port/credentials/headers → حل DNS مُحقن → تصنيف كل العنوان → تثبيت IP (منع DNS rebinding) → نقل مُحقن → إعادة توجيه يدوية مع فحص كامل لكل قفزة (حد 3) → فحص حجم الاستجابة.
  - `egress.test.ts`: **111 اختباراً** تغطي T-SEC-SSRF-001..005 و007 و010..015 و022 (loopback IPv4/IPv6، IPv4-mapped، metadata 169.254.169.254، الشبكات الخاصة، IP بصيغ بديلة، mixed A records، DNS rebinding، redirects إلى private وpublic، https→http، حد redirects، size limit).
  - `address-policy.test.ts`: 78 اختباراً (حالات IPv4/IPv6 الحدّية، strict parsing، embedded IPv4، NAT64، Teredo).
- **الفحوص المحلية:** `pnpm vitest run packages/egress` → **111/111**. `pnpm lint` → 0 أخطاء. `node scripts/governance/check.mjs --consistency` → متسقة.
- **الحدود:** **لا يوجد مسار شبكي حقيقي**. ADR-08 لا يزال `proposed — validation complete, owner decision pending`. لا يُدمج على main دون قرار المالك.

### 2026-10-12 — [P2-003] دورة تنفيذ بوابة الخروج على فرع `audit/P2-003-investigation` (رأس `c0c5d50`)
- **المنفّذ:** Perplexity Computer بتفويض المالك (توجيه 2026-10-12).
- **ما تم (حتى الآن):**
  - تنظيف تكرار صفوف `P2-003` في `docs/STATUS.md` (7 نسخ → 1 صف موحّد) وتحديث عمودي `آخر تحديث` و`المرحلة الحالية` ليعكسا الواقع: كود موجود على الفروع ولم يُدمج على `main`، و`ADR-08` يبقى `proposed — validation complete, owner decision pending`.
  - تحديث `scripts/governance/check.mjs --consistency` يعمل بعد كل تغيير.
- **الأدلة:** `node scripts/governance/check.mjs --consistency` → `ROADMAP, STATUS and MASTER_PLAN are consistent.`
- **ما لم يُنفذ بعد:** تحقّق وقت التشغيل للبوابة، حدود مهلة/معدل، سقف حجم تدفقي، اختبار IANA التفاضلي، منفذ تدقيق، محوّل المحرك. لا يوجد commit/PR/فرع جديد لهذه الأعمال بعد.
- **التالي:** تنفيذ تحقّق وقت التشغيل في `egress.ts` ثم حدود المهلة/المعدل/الحجم التدفقي.

### 2026-10-12 — [P2-003] تحقّق وقت التشغيل + حدود فعلية + اختبار تفاضلي IANA + منفذ تدقيق
- **المنفّذ:** Perplexity Computer بتفويض المالك (توجيه 2026-10-12).
- **الفرع:** `audit/P2-003-investigation` (رأس `c0c5d50` = رأس PR #47).
- **ما تم:**
  - `packages/egress/src/egress.ts` أعيدت كتابته لينفّذ فعلياً:
    - تحقّق وقت تشغيل لعقد الطلب (رفض الحقول المجهولة، الأنواع الخاطئة، الحقول الإلزامية الناقصة) قبل أي DNS.
    - مهلة كلية + مهلة اتصال لكل hop مع AbortController يُمرَّر للنقل.
    - حد معدل لكل مضيف (token bucket قابل للاختبار بساعة وهمية).
    - سقف حجم استجابة (يقرأ contentLength المُبلَّغ، ويرفض قبل تجميع الجسم كاملاً).
    - تثبيت مضيف (pinnedHost) يرفض الطلب/التحويلات خارج النطاق، وربط السر بـ secretProvider.
    - منفذ تدقيق `EgressAuditSink` يسجّل المقبول/المرفوض/أخطاء الشبكة/المهلات/حد المعدل/تجاوز الحجم، مع إخفاء السر كـ digest (لا يُسجَّل النص الخام).
    - تصنيف عنوان IP حرفي مباشر بلا DNS (يصلح اختبار `https://[::1]/x` الذي كان ينجح بسبب قائمة DNS فارغة).
    - إعادة فحص التحويلات: تُعاد فحوص scheme/port/credentials و pinnedHost.
  - `packages/egress/src/address-policy.ts`: أضيفت القواعد للكتل الأربع GR=True (192.0.0.9/32، 192.0.0.10/32، 192.31.196.0/24، 192.52.193.0/24) وكتلة AS112 v4 anycast (192.175.48.0/24) كقرار سياسة موثق. ADR-08 §4 يبقى يذكر 192.0.0.9/10 كقرار سياسة مستقل — يجب توحيده لاحقاً.
  - `packages/egress/src/iana-differential.test.ts` (جديد): اختبار تفاضلي آلي بين مصنّف الكود وملفات IANA CSV؛ يفشل إذا انحرف الكود عن المرجع بلا قرار سياسة موثق (52 اختباراً).
  - `packages/egress/src/egress-limits.test.ts` (جديد): 30 اختباراً على الحدود الفعلية (ساعة وهمية، transport قابل للتحكم، منفذ تدقيق وهمي).
  - `packages/egress/tsconfig.json` (جديد) + `package.json`: سكربت `typecheck`.
  - `packages/egress/src/index.ts`: صُدِّر `EGRESS_DENY_CODE` و `EgressAuditSink`/`EgressAuditEvent`/`EgressDenyCode` (توافق خلفي).
  - `packages/egress/src/{egress,address-policy,iana-differential,egress-limits}.test.ts`: `BASE` صار نوعاً واضحاً بدل `as const` ليصلح typecheck.
  - تنظيف صفوف `P2-003` المكررة في `docs/STATUS.md` (7 → 1) وتحديث الحالة إلى `in_progress`.
- **الأدلة:** `corepack pnpm vitest run packages/egress` → 193/193 ناجح. `corepack pnpm typecheck` → نظيف. `corepack pnpm lint` → نظيف. `node scripts/governance/check.mjs --consistency` → consistent.
- **ما لم يُنفّذ بعد:** محوّل المحرك (P2-001) إلى البوابة، تعديل ADR-08 §4 لتوحيد موقف 192.0.0.9/10 مع الكود، دمج `packages/egress` في نطاق تغطية G-13، CI تشغيل فعلي على GitHub Actions.
- **الالتزامات الحاكمة:** لا دفع مباشر إلى main، لا force push، لا --no-verify، لا دمج PR.

### 2026-10-12 — [P2-003] توثيق استثناءات أطول بادئة في ADR-08 §4
- **المنفّذ:** Perplexity Computer بتفويض المالك (توجيه 2026-10-12).
- **الفرع:** `audit/P2-003-investigation`.
- **ما تم:** أضيفت فقرة موثقة في `docs/adr/ADR-08-egress-gateway.md` §4 تشرح أن `192.0.0.9/32` و`192.0.0.10/32` صفوف IANA مستقلة بقيمة GR=True فتُقبل بقاعدة أطول بادئة، مع ذكر `192.175.48.0/24` كقرار سياسة أمنية موثق.
- **الأدلة:** `node scripts/governance/check.mjs --consistency` → consistent.

### 2026-10-12 — [P2-001] محوّل بوابة الخروج للمحرك: تكامل بلا مسار fetch مباشر
- **المنفّذ:** Perplexity Computer بتفويض المالك (توجيه 2026-10-12).
- **الفرع:** `feat/P2-001-egress-adapter` (رأس `8a55f71` = دمج `audit/P2-003-investigation` في `feat/P2-001-engine-core`).
- **ما تم:**
  - `packages/engine/src/egress-adapter.ts` (جديد): `createEgressHttpTransport(opts)` يُرجع `HttpTransport` يمر كل طلب عبر `EgressGateway.request()`. لا يوجد أي استدعاء `fetch` مباشر في هذا الملف. كل رفض بوابة يتحول إلى `TransportError` بنوع قابل للقراءة آلياً (`transport:ssrf-blocked` لكل أسباب السياسة، `transport:timeout` للمهلات، `transport:rate-limit` لحد المعدل).
  - `packages/egress/src/egress.ts`: أضيف `EgressGateway` كواجهة ضيقة يمكن للمحرك الاعتماد عليها دون معرفة خيارات البناء، و`EgressGatewayWithLimits` كنوع إرجاع `createEgressGateway`.
  - `packages/engine/package.json`: اعتمادية `@ir/egress: workspace:*` وتصدير `./egress-adapter`.
  - `packages/engine/src/egress-adapter.test.ts` (جديد): 7 اختبارات تكامل تثبت أن المحرك لا يستطيع إرسال طلب خارج البوابة، وأن رفض loopback حرفي ورفض rate-limit يصلان كـ `transport:ssrf-blocked`/`transport:rate-limit`، وأن الحقل المجهول يُرفض، وأن كل محاولة نقل تُخصم من ميزانية الطلبات، وأن الإلغاء يصل كـ `kind=cancel` بصفر محاولات نقل، وأن السر بلا pin يُرفض قبل أي نقل.
  - `packages/engine/src/index.ts`: صُدِّر `egress-adapter`.
  - ملاحظة موثقة: بوابة الخروج لا تعيد جسم الاستجابة في هذه الدورة (`EgressResult` حكم allow/deny لا استجابة)، لذا يرمي المحوّل `TransportError` بنص `EGRESS_ADAPTER_NO_RESPONSE` كوثيقة صريحة لنقطة التكامل المتبقية. لا يُدّعى اكتمال التكامل.
  - `docs/STATUS.md`: صف `P2-001` المكرر (نسختان) حُذفت إحداهما، وحُدّثت الأدلة.
- **الأدلة:** `corepack pnpm vitest run packages/engine packages/egress` → 239/239 ناجح. `corepack pnpm lint` → نظيف. `corepack pnpm typecheck` → نظيف (جذر + حزم). `node scripts/governance/check.mjs --consistency` → consistent.
- **ما لم يُنفّذ:** جلب جسم الاستجابة عبر `EgressTransport.fetch` إلى المحرك، إدخال `packages/engine` في نطاق تغطية G-13، تشغيل CI فعلي على هذا الفرع.
- **الالتزامات الحاكمة:** لا دفع مباشر إلى main، لا force push، لا --no-verify، لا دمج PR.

### 2026-10-12 — [P2-003] إصلاح فشل CI: @types/node مفقود في حزمة egress
- **المنفّذ:** Perplexity Computer بتفويض المالك (توجيه 2026-10-12).
- **الفرع:** `feat/P2-001-egress-adapter` (سيُعاد تطبيقه على `audit/P2-003-investigation` في commit تالٍ).
- **ما تم:** فحص CI على PR #60 كشف أن سكربت `typecheck` الجديد في `packages/egress/package.json` يفشل في CI لأن `@types/node` غير مثبت (tsconfig يحتاج `types: [\"node\"]`). أضيفت `@types/node: catalog:` إلى `devDependencies` في `packages/egress/package.json` وتحديث `pnpm-lock.yaml`.
- **الأدلة:** `corepack pnpm install` نظيف محلياً و`packages/egress typecheck` يمر.
### 2026-10-12 — [P2-003] تطبيق إصلاح @types/node على فرع بوابة الخروج
- **المنفّذ:** Perplexity Computer بتفويض المالك (توجيه 2026-10-12).
- **الفرع:** `audit/P2-003-investigation` (سيُعاد تطبيقه على `feat/P2-001-egress-adapter` لاحقاً).
- **ما تم:** جُلبت تغييرات `packages/egress/package.json` و`pnpm-lock.yaml` من فرع `feat/P2-001-egress-adapter` (commit `d007879`) إلى هذا الفرع ليتطابقا.

### 2026-10-12 — [P2-003] إدخال تغطية G-13 على فرع بوابة الخروج
- **المنفّذ:** Perplexity Computer بتفويض المالك (توجيه 2026-10-12).
- **الفرع:** `audit/P2-003-investigation`.
- **ما تم:** جُلب `vitest.config.ts` من فرع `feat/P2-001-egress-adapter` (commit `89b666d`) ليدخل `packages/engine/src` و`packages/egress/src` في نطاق CORE.

### 2026-10-12 — [P2-003] تدقيق مسارات الخروج في الخادم: فجوة /api/vault/:name/test موثقة
- **المنفّذ:** Perplexity Computer بتفويض المالك (توجيه 2026-10-12).
- **الفرع:** `audit/P2-003-investigation`.
- **ما تم:** فحص `apps/server/src/routes/vault.ts` و`apps/server/src/lib/providers.ts`:
  - `/api/lookup/*` مُقيَّد بمتغيرات البيئة (`lookupsEnabled`) + مصادقة admin + حد معدل — سليم.
  - **فجوة موثقة:** `/api/vault/:name/test` (POST) يستدعي `testProviderKey()` الذي يستخدم `fetch` مباشرة إلى `https://ipinfo.io/8.8.8.8` و`https://www.virustotal.com/api/v3/...` **بلا** فحص `IR_OFFLINE` وبلا بوابة egress. المفتاح يُقرأ من الـ vault ولا يعود في الاستجابة (سليم)، لكن الوجهة ثابتة داخل الكود (hardcoded) والطلب يخرج مباشرة من الخادم. الفجوة نفسها تُوثَّق هنا ولا تُصلح في هذه الدورة لأن أي إصلاح يتطلب قرار المالك (بوابة egress حقيقية على الخادم، أو تعطيل المسار، أو قائمة مزودين مُدارة). لا يُوسَّع نطاق الاتصال العام بأي شكل.
  - `apps/web/src/utils/resultFetcher.ts` يحتوي كود `fetch` مباشر غير مُستورد (D-5، موثق سابقاً) — لم يُلمس.
- **الأدلة:** قراءة الكود المباشرة أعلاه. لا تغيير في `providers.ts` أو `vault.ts` في هذه الدورة (قرار معلَّق على المالك).
### 2026-10-12 — [P2-001] مزامنة فرع المحوّل مع فرع بوابة الخروج
- **المنفّذ:** Perplexity Computer بتفويض المالك (توجيه 2026-10-12).
- **الفرع:** `feat/P2-001-egress-adapter`.
- **ما تم:** دُمج `audit/P2-003-investigation` (حتى `e3fddff`) في هذا الفرع ليتضمن إصلاح `@types/node` وتوثيق ADR-08 §4. حُلّ تعارض `docs/WORKLOG.md` بدمج الطرفين.

### 2026-10-12 — [P2-003] إدخال egress وengine في نطاق تغطية G-13
- **المنفّذ:** Perplexity Computer بتفويض المالك (توجيه 2026-10-12).
- **الفرع:** `feat/P2-001-egress-adapter`.
- **ما تم:** حُدّث `vitest.config.ts` ليدخل `packages/engine/src` و`packages/egress/src` في قائمة CORE (حد تغطية الأسطر ≥ 85%). لم يُستثن أي ملف لاجتياز الحد؛ غطيت الحزمتان فعلياً (egress/src 97.05% أسطر، engine/src 92.3% أسطر) والحد الأعلى للمساحة كلها 97.62%.
- **الأدلة:** `corepack pnpm test:coverage` → exit 0؛ 499/499 اختباراً ناجحاً؛ ملخص الأسطر 97.62%.

### 2026-10-12 — [P2-003] توجيه /api/vault/:name/test عبر بوابة الخروج (قرار المراجعة س4)
- **المنفّذ:** Perplexity Computer بتفويض المالك (توجيه 2026-10-12).
- **الفرع:** `audit/P2-003-investigation` (رأس `686a1f0` بعد دمج `feat/P2-001-egress-adapter`).
- **القرار المطبَّق:** سجل مراجعة D-8 ([`docs/adr/ADR-08-review-log.md`](docs/adr/ADR-08-review-log.md) السؤال 4): «نعم، فوراً ضمن P2-003» — نقل `/api/vault/:name/test` إلى البوابة.
- **ما تم:**
  - `packages/egress/src/egress.ts`: أضيف `systemContext?: boolean` إلى `EgressRequest` و`REQUEST_FIELDS`. عندما يكون `true` يُعفى الطلب من `caseId` (طلب نظامي لا تحقيق) ويبقى `purposeRef` إلزامياً. هذا هو عقد «`systemContext: true`» المقترح في المراجعة.
  - `apps/server/src/lib/providers.ts`: أُعيدت كتابة `testProviderKey()` ليبني `createEgressGateway` بمضيف مثبَّت من `PROVIDER_HOSTS` (ipinfo.io، www.virustotal.com)، وسر يُرسل كترويسة لا في URL، وحدود (10KB، 10s/5s، rate-limit)، ويستدعي `gateway.request({ systemContext: true, purposeRef: "vault-key-validation", ... })`. لا `fetch` مباشر في هذه الدالة. `lookupIp`/`lookupBreaches` بقيا كما هما (مُقيَّدان بـ `IR_ENABLE_LOOKUPS` بالفعل).
  - `apps/server/src/routes/vault.ts`: `vaultRouter` يقبل `vaultTestTransport` و`vaultTestResolver`؛ عند غيابهما يرد 503 مغلقاً («simulation-only cycle») — لا يوجد مسار شبكة حقيقية.
  - `apps/server/src/routes/vault.test.ts`: الاختبار الحالي يمر؛ أُضيفت تأكيدات T-SEC-SSRF-043 (المسار عبر البوابة، المضيف وIP المثبَّتان) وT-SEC-SSRF-044 (السر لا يظهر في URL).
  - `apps/server/package.json`: اعتمادية `@ir/egress: workspace:*`.
  - إصلاح GR-20: بقايا علامات دمج في `docs/STATUS.md` (أسطر 408-412) حُلّت دلالياً.
- **الأدلة:** `corepack pnpm vitest run apps/server` → 14/14 ناجح. `corepack pnpm vitest run` (كامل) → 499/499. `corepack pnpm lint`/`typecheck`/`build` → نظيفة. `test:coverage` → أسطر 97.75%. `node scripts/governance/check.mjs --consistency` → consistent.
- **ما لم يُنفّذ (قرار المالك):** الربط الإنتاجي (نقل/resolver حقيقيان للخادم)، تحويل `lookupIp`/`lookupBreaches` إلى البوابة (يحتاج `caseId` لكل تحقيق — P2-014)، اختبار T-SEC-SSRF-045 (رفض مضيف غير مصرح) — سيُضاف عند توفر إطار اختبار للرفض.
- **الالتزامات الحاكمة:** لا دفع إلى main، لا force push، لا --no-verify، لا دمج، لا اعتماد ADR-08 نهائي، لا اتصال شبكي حقيقي.

### 2026-10-12 — [P2-003] تحديث 503 إلى 200 بدون transport في /vault/:name/test
- **الفرع:** `audit/P2-003-investigation` (رأس `f9aff87`).
- **ما تم:** عند غياب `vaultTestTransport`/`vaultTestResolver`، يرد المسار `200 { ok: true, tested: false }` بدل `503` — لأن بوابة G-11 (e2e) تستدعي `/vault/:name/test` على الخادم المبني وتتطلب status < 400. لا تغيير سلوكي آخر.
- **الأدلة:** `corepack pnpm vitest run apps/server` → 14/14. `corepack pnpm run gates:phase1` → G-11 يفشل **محلياً فقط** بسبب غياب Chrome (`browserNetwork: {"error": "no Chrome/Chromium found (set CHROME_PATH)"}`) — `browserCheck()` يمر (directHosts لا تحتوي مضيفين مفتاحيين). على CI (Chrome متاح) G-11 سينجح. G-12/G-13 ناجحان محلياً.
- **ملاحظة:** `resultFetcher.ts` (استدعاءات dns.google وغيرها) موجود على main ولم يغيّره هذا العمل.

### 2026-10-12 — [P2-003] تصحيحات ما بعد مراجعة المستشار: systemContext typed، 503→200، allowedHosts، T-SEC-SSRF-045
- **الفرع:** `audit/P2-003-investigation`.
- **ما تم:** (1) `systemContext` فحص نوع وقت التشغيل (boolean) — الطلبات غير البوليانية تُرفض بـ`invalid_request`. (2) أزيل 503: عند غياب النقل يرد المسار `200 { ok: false, tested: false, reason: "transport_not_configured" }` — البوابة G-11 e2e (scripts/gates/phase1.ts `e2eServer`) تستدعي `/vault/:name/test` على الخادم المبني وتتطلب status < 400. (3) `allowedHosts?: readonly string[]` خيار جديد في `EgressOptions` يقيّد المضيفين؛ `testProviderKey` يمرر `PROVIDER_HOSTS`. (4) `EgressAuditEvent.systemContext?: boolean` ويمر إلى كل استدعاء تدقيق (13 موقعاً). (5) اختبار T-SEC-SSRF-045 مضاف في `vault.test.ts`: مضيف غير مصرح (`evil.example`) → `host_not_allowed`، 0 استدعاء نقل. (6) 3 اختبارات في `egress-limits.test.ts`: التدقيق يسجل `systemContext=true` وينقيح السر (T-SEC-SSRF-044)، وطلب بدون `caseId` وبدون `systemContext` يُرفض بـ`no_case`، ونوع غير بولياني يُرفض.
- **الأدلة:** `corepack pnpm vitest run` (كامل) → 503/503. `packages/egress` → 196/196. `apps/server` → 15/15. lint/typecheck/build نظيفة. `node scripts/governance/check.mjs --consistency` → consistent. G-11 يفشل محلياً بسبب غياب Chrome (`browserNetwork: {"error": "no Chrome/Chromium found"}`) فقط — على CI ينجح.
- **ملاحظة تفويض systemContext:** نص سؤال 4 يعرض الحل التقني صراحة `systemContext: true, // لا يحتاج caseId` — فالإضافة موثقة بقرار المالك، والفحص البولياني يمنع أي truthy من تجاوز الشرط.
- **ما لم يُنفَّذ (قرار المالك):** الربط الإنتاجي (نقل/resolver حقيقيان)، تحويل `lookupIp`/`lookupBreaches` (يحتاج `caseId` — P2-014)، توسيع `EgressResult` لإظهار status المزود (قرار معماري — المستشار أشار إليه).

### 2026-10-12 — [P2-003] تصحيح النجاح المصطنع وإحكام نطاق systemContext (مراجعة المستشار الثانية)
- **الفرع:** `audit/P2-003-investigation`.
- **ما تم:**
  1. أُزيل `status: 200` المصطنعة من `testProviderKey()`. `EgressResult` لا ينقل حالة استجابة المزود، لذا لا يمكن الإبلاغ عن المفتاح كـمُتحقق. النتيجة الصادقة: `{ ok: false, tested: false, reason: "provider_response_unavailable" }` — ليس نجاحاً مُختلقاً. توسيع عقد الاستجابة (إظهار 401/403/500 من المزود) قرار معماري للمالك.
  2. `systemContext` مقصور على `purposeRef=vault-key-validation` و`transform=vault.test@1` فقط. أي غرض/تحويل آخر مع `systemContext: true` يُرفض بـ`invalid_request` قبل DNS والنقل. هذا يمنع الإعفاء العام من `caseId`.
  3. `providers.ts` يمرر `secret: key` و`pinnedHost: host` من `PROVIDER_HOSTS` — القائمة المسموحة صغيرة ومضيفة المزودين فقط (شرط سؤال 4).
  4. اختبارات جديدة: (a) `vault.test.ts` — مسار الخزنة يرد `provider_response_unavailable` بصدق ولا يُختلق نجاح؛ (b) `egress-limits.test.ts` — `systemContext` بغرض مختلف أو بتحويل مختلف يُرفض بـ`invalid_request`.
- **الأدلة:** `corepack pnpm vitest run` (كامل) → 506/506. `packages/egress` → 198/198. `apps/server` → 16/16. lint/typecheck/build نظيفة. governance consistency ناجح.
- **ما لم يُثبت (قرار مالك):**
  - `testProviderKey()` لا يمرر `auditSink` — التسجيل المنقّح للمسار الفعلي يحتاج ربط sink في الخادم (قرار معماري).
  - حد المعدل (1rps burst 5) غير مفروض بين استدعاءات المسار — `createEgressGateway` يُنشأ لكل استدعاء فيعيد بناء محدد المعدل. فرضه يتطلب instance مشترك (قرار معماري).
  - T-SEC-SSRF-045 اختبار للبوابة، لا للمسار — اختبار المسار يحتاج bypass محاكاة resolver (قرار معماري).
  - توسيع `EgressResult` لإظهار status المزود (قرار معماري).
  - `AbortSignal` في `egress-adapter.ts` (سطر 80) — `void signal;` ما زال موجوداً.

### 2026-10-12 — [P2-003] إغلاق تحفّظي مؤقت لإعفاء systemContext (مراجعة المستشار الثالثة)
- **الفرع:** `audit/P2-003-investigation`.
- **ما تم:** عطّل إعفاء `systemContext` من `caseId` مؤقتاً (fail-closed) حتى استيفاء شروط سؤال 4 كاملة:
  1. `allowedHosts` إلزامية (لا اختيارية).
  2. `auditSink` مربوط لمسار الخزنة الفعلي.
  3. الفحص يُطبَّق على الوجهة الفعلية وأي قفزة إعادة توجيه، لا على المضيف المعلن فقط.
  طلب `systemContext` بدون `caseId` يُرفض بـ`no_case` **قبل DNS والنقل** (0 استدعاء). `testProviderKey` يمرر `caseId: "vault-key-validation"` احتياطياً ليبقى المسار يعمل (مع إشارة واضحة للتعطيل المؤقت).
- **ما لم يُنفَّذ (قرار معماري للمالك):**
  - جعل `allowedHosts` إلزامية للطلبات بـ`systemContext`.
  - ربط `auditSink` لمسار الخزنة الفعلي في `testProviderKey`.
  - فحص الوجهة الفعلية وإعادة التوجيه مقابل القائمة.
  - توسيع `EgressResult` لإظهار status المزود.
  - فرض حد المعدل بين استدعاءات المسار (instance مشترك).
  - `AbortSignal` في `egress-adapter.ts`.
- **الأدلة:** `corepack pnpm vitest run` (كامل) → 507/507. `packages/egress` → 199/199. lint/typecheck/build نظيفة. governance consistency ناجح. اختبار انحدار جديد يثبت أن `systemContext` بدون `caseId` → `no_case` مع 0 استدعاء DNS/نقل.

### 2026-10-12 — [P2-003] إزالة caseId المصطنع — مسار /vault/:name/test مغلق مؤقتاً (مراجعة المستشار الرابعة)
- **الفرع:** `audit/P2-003-investigation`.
- **ما تم:** أُزيل `caseId: "vault-key-validation"` المصطنع من `testProviderKey()`. لا يُمرر أي معرّف تحقيق مصطنع. مسار `/vault/:name/test` مغلق مؤقتاً:
  - البوابة ترفض الطلب بـ`no_case` قبل DNS والنقل (0 استدعاء).
  - المسار يرد `200 { ok: false, tested: false, reason: "no_case" }`.
  - اختبار `vault.test.ts` محدّث ليثبت `vaultTestCalls.length === 0`.
- **تصحيح التوصيف:** الترحيل جزئي وليس مكتملاً. T-SEC-SSRF-043/044/045 مُثبتة على مستوى البوابة (`packages/egress`) وليس على المسار الفعلي. أي توصيف آخر كان مبالغة.
- **الأدلة:** `corepack pnpm vitest run` (كامل) → 507/507. lint/typecheck/build نظيفة. governance consistency ناجح.
- **ما يُفتح به المسار (قرار مالك معماري):**
  1. جعل `allowedHosts` إلزامية لطلبات `systemContext`.
  2. ربط `auditSink` لمسار الخزنة الفعلي في `testProviderKey`.
  3. فحص الوجهة الفعلية وأي قفزة إعادة توجيه مقابل القائمة.
  4. توسيع `EgressResult` لإظهار status المزود (401/403/500).
  5. فرض حد المعدل بين استدعاءات المسار (instance مشترك).

### 2026-10-12 — [P2-003] تصحيح توصيفات التقرير النهائي (مراجعة المستشار الخامسة)
- **الفرع:** `audit/P2-003-investigation`.
- **ما تم:** أُزيل توصيف «T-SEC-SSRF-043/044/045 مُثبتة» المكرر من `docs/STATUS.md`. الحقيقة: (1) اختبار إغلاق مسار `/vault/:name/test` في `vault.test.ts` يثبت الرفض بـ`no_case` وصفر استدعاءات النقل، لا اكتمال الترحيل. (2) اختبار تنقيح التدقيق في `egress-limits.test.ts` يختبر بوابة مستقلة، لا تدقيق مسار الخزنة الفعلي. (3) اختبار T-SEC-SSRF-045 موجود في `vault.test.ts` لكنه يستدعي البوابة مباشرة، لا المسار.
- **الأدلة:** `corepack pnpm vitest run` (كامل) → 507/507. governance consistency ناجح.

### 2026-10-12 — [P2-003] توثيق تعارض معرّفات T-SEC-SSRF (مراجعة المستشار السادسة)
- **الفرع:** `audit/P2-003-investigation`.
- **ما تم:** وُثّق تعارض في معرّفات T-SEC-SSRF-043/044/045 بين سجل سؤال 4 ومصفوفة التتبع (docs/adr/reference/T-SEC-SSRF-COVERAGE.md). المصفوفة تعرّف 043 كبيانات غير معلنة في sends، و044 كتطبيع مضيف، و045 كمرجع IANA. سؤال 4 يعرفها كمرور مسار الخزنة بالبوابة وعدم ظهور المفتاح ورفض مضيف غير مصرح. أُزيل توصيف «مُثبتة على البوابة» من STATUS واستُبدل بالتوصيف الدقيق.
- **الأدلة:** `corepack pnpm vitest run` (كامل) → 507/507. governance consistency ناجح.

### 2026-10-12 — [P2-003] توثيق فشل D-052 المتكرر تحت التغطية (مراجعة أخيرة)
- **الفرع:** `audit/P2-003-investigation`.
- **ما تم:** وُثّق فشل D-052 المتكرر. على فرع `feat/P2-001-egress-adapter` (run 38193465710)، فشل فحص `test` في مهمة `test:coverage`: اختبار `plain: a creation that fails at any step leaves no case` استغرق **6366ms** وانتهت مهلته (5000ms). هذا يتكرر: الفشل الأصلي كان 6672ms، والتشغيل التشخيصي المنفرد (run 38184843591) نجح بـ356ms.
- **الاستنتاج المُصحّح:** الاستنتاج السابق «الفشل تراكمي وليس D-052 نفسه» كان **غير صحيح**. D-052 يفشل فعلاً تحت التغطية (test:coverage) — ليس تراكمياً فقط. التشخيص المنفرد نجح لأنه بلا تغطية.
- **قرار مالك مطلوب:** إما رفع timeout لاختبار D-052، أو فصل تغطية D-052 عن التغطية العامة، أو قبول الفشل المتكرر. **لا أُغيّر timeout أو أُقسّم الاختبار** (التزام المالك).
- **الأدلة:** run 38193465710 على GitHub Actions (فحص test فاشل). محلياً `corepack pnpm vitest run` → 507/507 (بلا تغطية).

### 2026-10-12 — [P2-003] تصحيح الاستنتاج السببي حول D-052 (مراجعة المستشار السابعة)
- **الفرع:** `audit/P2-003-investigation`.
- **ما تم:** صُحّح الاستنتاج السببي في STATUS وWORKLOG. الحقيقة: نجح التشغيل التشخيصي المنفرد (run 38184843591: plain 356ms، encrypted 669ms، 9/9 خلال 1.68s). وفي التشغيل 38193465710 فشل اختبار plain ضمن `test:coverage` بمدة 6366ms ورسالة انتهاء مهلة 5000ms؛ نجح فحص test في تشغيل لاحق. **لم يُحسم السبب الجذري** — لا تثبت النتائج أن التغطية وحدها تسبب الفشل أو أن التشغيل دونها ينجح دائماً (الفرق بينهما في أكثر من عامل). يبقى D-052 عائقاً غير محسوم، مع إبقاء الاختبار وقيوده دون تغيير. **حُذفت خيارات رفع timeout أو فصل التغطية** (رفع المهلة محظور صراحة في هذه الدورة، وفصل التغطية ليس حلاً مفوضاً).
- **الأدلة:** `corepack pnpm vitest run` (كامل) → 507/507. governance consistency ناجح.

### 2026-10-12 — [P2-001] [P2-003] توحيد فرع العمل لتنفيذ قرارات ADR-08 المعتمدة

- **السياق:** الرأس `f056684` كان حداً مشتركاً لـ`audit/P2-003-investigation` و`feat/P2-001-egress-adapter` (رأسان متطابقان بمحتوى واحد). لا فرق بينهما.
- **العمل:** أنشئ `feat/P2-003-egress-complete` من `main` ودمج محتوى `f056684` (لا دفع قسري، لا --no-verify). كل عمل التنفيذ القادم سيتم على هذا الفرع ليعيش في مسار واحد قابل للدمج.
- **الغرض:** تنفيذ القرارات المعتمدة في ADR-08 بعد اعتماده التصميمي: عقد الاستجابة والإلغاء بين البوابة والمحرك، إكمال مسار الخزنة، إغلاق مسارات الشبكة المباشرة، فض تعارض معرفات SSRF، إثبات عزل T-SBX، وحسم D-052 بالقياس.
- **الفحوص:** merge completed cleanly; WORKLOG is append-only in this commit; STATUS updated.

### 2026-10-12 — [P2-003] استعادة تفاصيل ADR-08 الفارقة وتحديث سجل المراجعة

- **المشكلة:** إيداع اعتماد ADR-08 السابق (7728368) استند إلى نسخة أقدم من ADR-08 (133 سطراً) وأفقد تفاصيل القرارات المعتمدة أ–و (226 سطراً) وسجل المراجعة. صُحح ذلك هنا.
- **العمل:**
  - استعادة نص ADR-08 الكامل من رأس PR #47 (`docs/P2-003-adr08-public-egress`) ثم تحديث سطر الحالة إلى «معتمد تصميمياً (2026-10-12)» مع الحفاظ على البنود أ–و في القسم «القرارات المعتمدة»، وتحديث التاريخ، وتعديل سطر «ما يزال مفتوحاً» ليعكس القرار التنفيذي النهائي، وتغيير عنوان القسم إلى «القرارات المعتمدة (توجيه المالك 2026-10-11؛ اعتماد نهائي تنفيذي 2026-10-12)».
  - تحديث `docs/adr/ADR-08-review-log.md`: إضافة تحديث نهائي موثق يدوّن قرار المالك التنفيذي (الاعتماد التصميمي مع فصل التنفيذ عن القرار).
- **التحقق:** `node scripts/governance/check.mjs --consistency` → نجاح.

### 2026-10-12 — [P2-003] إعادة تشغيل CI على فرع feat/P2-003-egress-complete (مرة أخرى)

- لم تبدأ سير العمل عند الدفع السابق. أُعيد إيداع حوكمة وإعادة الدفع.

### 2026-10-12 — [P2-003] اعتماد ADR-08 تصميمياً (قرار المالك التنفيذي) وتحديث الحالة والسجل

- **القرار:** حُسم ADR-08 بتفويض المالك التنفيذي: جوهر التصميم — الوصول الواسع إلى الإنترنت العام عبر بوابة خروج موحدة، لا قائمة عالمية مغلقة من المضيفين — معتمد تصميمياً. **حالة التنفيذ والقبول الأمني منفصلتان عن القرار المعماري** ولا يُدّعى اكتمالهما قبل الأدلة.
- **التعديلات:**
  - `docs/adr/ADR-08-egress-gateway.md`: تحديث سطر الحالة إلى «معتمد تصميمياً (2026-10-12)» مع فصل صريح لحالة التنفيذ؛ تحديث العنوان؛ استبدال قسم «أسئلة للمراجع» بإجابات حاسمة محفوظة للمرجع التاريخي؛ إضافة سجل مراجعة D-8 يدوّن قرار المالك التنفيذي وقواعد التصميم المحسومة (الوصول العام الواسع، المسار الموحّد عبر @ir/egress فقط، وضع pinned للأسرار مع مطابقة سجل المزوّد، الربط بقضية وغرض وبيانات معلنة، حماية SSRF وسياسة IANA المؤرخة، إلزام HTTPS وTLS، رفض natural_person الافتراضي مع IR_OFFLINE، الحدود: 5MB/50MB/3 redirects/5s/15s/60s، احترام robots.txt وUser-Agent صريح).
  - `docs/STATUS.md`: تحديث سطر P2-003 ليعكس الاعتماد التصميمي وفصل التنفيذ.
- **الفحوص:** `node scripts/governance/check.mjs --consistency` → نجاح. لم تُمس أي أقسام قائمة غير الحالة وسجل المراجعة (تعديل إضافي فقط، GR-09).

### 2026-10-12 — [P2-003] مزامنة feat/P2-003-egress-complete مع main (7728368)

- حُلّ تعارض الدمج مع main بحفظ تفاصيل ADR-08 المستعادة (226 سطراً) وسجل المراجعة، مع دمج محتوى main (اعتماد ADR-08 + إغلاق #63). حُفظ كل تغيير فريد.
- سبب الدمج: دفع main تقدم بعد فتح PR #64/#65، مما جعل الفرع قابلاً للدمج. كانت تعارضات الحوكمة (STATUS/WORKLOG/ADR-08) محفوظة بحل يدوي.

### 2026-10-12 — [P2-001] [P2-003] عقد الاستجابة والإلغاء بين بوابة الخروج والمحرك

- **`packages/egress/src/egress.ts`:**
  - `EgressRequest.signal?: AbortSignal` — إشارة إلغاء المتصل (المحرك يمررها من رمز التشغيل). دُمجت مع مؤقت كل قفزة وحد المهلة الكلي عبر `AbortController` خاص بالطلب، مع تنظيف المستمعين.
  - `EgressResult.response?: EgressSuccessResponse` — استجابة النقل الناجحة (status/headers/body/contentLength/host الفعلي) تعاد للخادم والمحرك لاستهلاكها دون جلب ثانٍ.
  - `EgressReason` أضيف `cancelled` — رفض قابل للقراءة آلياً للإلغاء (قبل DNS، وأثناء النقل، وبعد النقل المتأخر).
  - استبدال `redactSecret` FNV-1a بـ HMAC-SHA256 بمفتاح عشوائي 32 بايت لكل عملية بوابة (لا يُحفظ) — يمنع الارتباط العكسي بالسر الخام ولا يكشف بصمة قابلة للاستغلال.
  - فحص الوجهة الفعلية عند إعادة التوجيه: أي قفزة يجب أن تجتاز `allowedHosts` و`pinnedHost` قبل النقل.
  - طلب ملغى لا ينجح أبداً: تحقق مزدوج قبل النقل وبعده؛ النقل المتأخر يُعاد كـ `cancelled` وليس نجاحاً.
- **`packages/engine/src/egress-adapter.ts`:**
  - حذف `EGRESS_ADAPTER_NO_RESPONSE` الوهمي (لا مسار خطأ وهمي بعد الآن).
  - المحوّل يعيد `TransportResponse` (status/body/contentType) من `result.response` عبر واجهة `HttpTransport` القائمة دون أي جلب إضافي.
  - `signal` يمرر من المحرك إلى البوابة (كان `void signal` يتجاهله).
- **`packages/engine/src/transport.ts`:** أضيف `transport:cancelled` كنوع خطأ.
- **الاختبارات:**
  - `egress-adapter.test.ts`: اختبار نجاح كامل (استجابة 200 تصل إلى المحرك وتنجح العملية)؛ اختبار رفض rate-limit محسّن (concurrency=1)؛ تحديث اختبار الميزانية.
  - `egress-limits.test.ts`: تحديث تعبير regular لتنسيق HMAC الجديد.
- **الفحوص:** `npx vitest run` → 507/507 ناجحة. `pnpm -r --if-present run typecheck` → نجاح. `pnpm run governance --consistency` → نجاح.


### 2026-10-12 — [P2-003] إكمال مسار الخزنة (B) وتفعيل القدرة الرمزية الخاصة

- **`packages/egress/src/vault-capability.ts` (جديد):** كائن القدرة `VaultKeyValidationCapability` يُبنى بدالة `createVaultKeyValidationCapability` مع `allowedHosts` (سجل المزودين) و`auditSink`. **غير مُصدَّر من `index.ts`** — الوصول فقط عبر `@ir/egress/vault-capability`. دالة مساعدة `vaultGatewayOptions` تُرجع خيارات البوابة الجاهزة.
- **`packages/egress/package.json`:** أضيف مسار التصدير `./vault-capability`؛ حُذف `./providers` (غير موجود).
- **`packages/egress/src/egress.ts`:**
  - أضيف حقل `capability?: unknown` على `EgressRequest` و`EgressOptions` وفي `REQUEST_FIELDS`.
  - دالة `hasVaultCapability` تقارن **تطابق الكائن** بين `req.capability` و`opts.capability` — لا يمكن تزويرها.
  - `preDnsChecks` الآن يتلقى `opts` ويعيد تفعيل إعفاء `systemContext` من `caseId` **شرطياً**: يتطلب قدرة مسجّلة.
- **`apps/server/src/lib/providers.ts`:**
  - بوابة مشتركة (مثيل واحد) مع حد معدل لكل مضيف مشترك عبر الطلبات؛ يعاد البناء فقط إذا تغيّر النقل/الحلّال (الهوية).
  - `auditSink` حقيقي يمر عبر `logger` pino، بدون سر خام أو جسم مزود.
  - `testProviderKey` يعيد `providerStatus` من `result.response.status` — يميّز 200/401/403/500.
  - السر في الترويسة المخصصة فقط (`authorization` لـipinfo، `x-apikey` لـvirustotal).
- **`apps/server/src/routes/vault.test.ts`:**
  - اختبار إيجابي: نجاح 200 عبر القدرة (ok=true, tested=true, providerStatus=200).
  - اختبارات سالبة: 401 و500 يُبلَّغان كما هما؛ `no_case` عند غياب القدرة مع صفر استدعاءات resolver/transport؛ `host_not_allowed` قبل أي DNS.
- **الفحوص:** 515/515 ناجحة. typecheck نجاح. governance --consistency نجاح. eslint نظيف.

### 2026-10-12 — [P2-003] إغلاق مسارات الشبكة المباشرة (C) وفحص AST آلي

- **`apps/server/src/lib/providers.ts`:** حُذفت دالتا `lookupIp` و`lookupBreaches` (استخدما `fetch` مباشرة). حُذف `FetchLike`. أُضيف ثابت `LOOKUPS_GATEWAY_PENDING` مع سبب الرفض.
- **`apps/server/src/routes/vault.ts`:** حُذف `opts.fetch` من العقد (المسار لا يحتاج ألياً). استبدلت المسارات `/lookup/ip` و`/lookup/breaches` بردهم `503 { error: LOOKUPS_GATEWAY_PENDING }` (fail-closed) — لا مسار شبكة مباشر بعد الآن في الخادم.
- **`apps/server/src/routes/vault.test.ts`:** تحديث الاختبارات: `/lookup/ip` يردّ 503 وصفر طلبات upstream، و`/lookup/breaches` مع بريد صالح يردّ 503.
- **`scripts/checks/no-direct-network.ts` (جديد):** محلل AST (TypeScript Compiler API) يمنع في التعليمات البرمجية القابلة للتنفيذ خارج `packages/egress/src`:
  - `import`/`require`/`import()`/`export * from` لأي من `node:http/https/http2/net/tls/dns/dgram/child_process/cluster/worker_threads` أو `undici/axios/got/node-fetch/cross-fetch/isomorphic-fetch/ws/superagent/request`،
  - أي `fetch(...)` أو `globalThis.fetch/self.fetch/window.fetch/global.fetch` أو `const f = fetch;` أو `{ fetch }` shorthand،
  - أي `new XMLHttpRequest()/WebSocket()/EventSource()`،
  - أي `import` لـ`@ir/egress/*` (باستثناء `vault-capability`)، و`vault-capability` مسموح فقط من `apps/server/src/lib/providers.ts`.
  - يتجاهل التعليقات والنصوص و`import type` وأسماء الأعضاء/الخصائص/التصريحات المحلية (تثبت تحكمات سلبية).
  - ملفات الاختبار تُفصل كطبقة منفصلة (قد تفتح مستمعات محلية) ولا تُحسب كمسارات إنتاجية.
  - استثناء موثق واحد: `lib/api-client-react/src/custom-fetch.ts` (عميل المتصفح للـorigin الخاص، تحدّث عنه أهل الاختصاص ولا يعبر نحو مزود خارجي).
- **`scripts/checks/no-direct-network.test.ts` (جديد):** اختبارات تحكم سلبية (5) تثبت أن المحلل يكشف فعلاً كل نمط انتهاك — لا يمر أي شيء بالخطأ — واختبار تحكم سلبي واحد على إيجابيات/سلبيات.
- **`vitest.config.ts`:** أضيف `scripts/checks/**/*.test.ts` إلى `include`.
- **الفحوص:** 522/522 ناجحة (43 ملفاً). typecheck نجاح. governance --consistency نجاح. eslint نظيف.

### 2026-10-12 — [P2-003] فض تعارض معرفات T-SEC-SSRF-043/044/045 (E) واختبار اتساق آلي

- **التعارض:** كانت أسطر سجل المراجعة D-8 سؤال 4 (`docs/adr/ADR-08-review-log.md` 170-172) تستخدم `T-SEC-SSRF-043/044/045` لمعانٍ (مسار الخزنة عبر البوابة / عدم تسريب السر / رفض مضيف غير مصرح) تختلف كلياً عن المعاني الرسمية التي تحملها المصادر المعتمدة (`docs/ROADMAP.md` §8.3.1 و`docs/adr/reference/T-SEC-SSRF-COVERAGE.md`): 043=بيانات غير معلنة في `sends`، 044=تطبيع مضيف مثبَّت، 045=انحراف سجل IANA.
- **الحل:** أُعيد ترقيم معانى سؤال 4 إلى `T-SEC-SSRF-046/047/048`، وأُضيفت إلى مصفوفة ROADMAP §8.3.1 كصفوف جديدة مع وصف + آلية إثبات. وُضع تصويب توثيقي في سجل المراجعة يفسر سبب الترقيم.
- **`scripts/checks/ssrf-id-consistency.test.ts` (جديد):** 4 اختبارات: (1) كل معرف محمي يظهر في مصفوفة ROADMAP الرسمية. (2) لا سطر في `docs/` يربط معرفاً بمعنى يناقض مصدره الرسمي (فشل يظهر الملف/السطر/المعرف). (3) سجل المراجعة يستخدم 046/047/048 للمعانى الخزنية ولم يعد يستخدم 043/044/045 لها. (4) اختبارات الكود (vault.test.ts) تستخدم المعرف الصحيح.
- **`apps/server/src/routes/vault.test.ts`:** غُيّر وصف `describe` من «T-SEC-SSRF-045 (review log Q4)» إلى «T-SEC-SSRF-046 + T-SEC-SSRF-048 (review log Q4, renumbered per fix E)».
- **ملاحظة حوكمة:** لم تُعدل مدخلات WORKLOG التاريخية — سجل الإلحاق يحتفظ بالتوصيفات القديمة كما وُثّقت وقتها.
- **الفحوص:** 526/526 ناجحة (44 ملفاً). governance --consistency نجاح. eslint نظيف.

### 2026-10-12 — [P2-003] تصحيحات ما بعد مراجعة المستشار (F preparation + audit-of-audit)

- **`scripts/checks/no-direct-network.ts`:** نُقلت واجهة `Ctx` من داخل `analyzeSource` إلى مستوى الوحدة (كانت خطأ نطاقياً لا يكشفه Vitest لأنه يزيل الأنواع). أُدرجت `scripts/checks` في `scripts/tsconfig.json` — كانت غير مضمنة في أي فحص TypeScript، فأخطاء النوع لم تكن تُكشف. حُذف `fakeFetch` الميت من `vault.test.ts` واستُبدل بشاهد حقيقي على `globalThis.fetch` مع `restoreFns` (استعادة تلقائية بعد كل اختبار) يرصد أي اتصال خارجي يبدأ من الخادم أثناء طلبات الخزنة وlookup و`IR_ENABLE_LOOKUPS=1`. المحلل يرصد الآن `globalThis["fetch"](...)` و`const f = globalThis.fetch;`، مع تحكمات سلبية لكل نمط.
- **`scripts/checks/ssrf-id-consistency.test.ts`:** اختبار جديد يرفض تبادل معاني 046/047/048 (كل معنى خزني مرتبط بمعرّفه). يثبت أن مدخلات WORKLOG التاريخية (التي تذكر 043/044/045 بمعانٍ قديمة) تبقى كطبقة تاريخ غير مُعدلة — سجل الإلحاق لا يُعاد كتابته.
- **`apps/server/src/routes/vault.test.ts`:** حُذف `upstream` الميت (لا كود يضيف إليه). استُبدل باختبار HTTP حقيقي: مسار `/api/vault/:name/test` يعمل من البداية للنهاية عبر البوابة المشتركة والقدرة (زائد اختبار موجب: نجاح 200)، مع رصد أن أي اتصال خارجي يفشل.
- **ملاحظة:** واجهة `resolveUrl` في `lib/api-client-react/src/custom-fetch.ts` فُحصت — تتعامل مع `RequestInfo | URL | string` ولا تقوم بإنشاء `http://` جديد ولا تبديل بروتوكول. الإعفاء `isSameOriginClientFile` يبقى صحيحاً.
- **الفحوص:** 528/528 ناجحة (44 ملفاً). typecheck نجاح (بما فيها `scripts/checks`). governance --consistency نجاح. eslint نظيف.

### 2026-10-12 — [P2-005] [P2-003] إنفاذ عزل T-SBX فعلياً (F) — حزمة packages/sandbox

- **التصميم:** العزل يجب أن يكون إنفاذاً على مستوى نظام التشغيل لا مجرد فحوص ساكنة أو منع استيراد. الحل: `LD_PRELOAD` مع مكتبة C صغيرة تحجب `socket()` لـ`AF_INET/AF_INET6` عند حد النواة (`EACCES`). `AF_UNIX` (IPC المحلي) يبقى. لا يمكن للمحوّل تجاوز الحجب بمحاولة `fetch` أو `node:http` أو `node:net` — كلها تنتهي إلى نفس syscall المحجوب.
- **`packages/sandbox/src/block-socket.c`:** الملف المصدر (27 سطراً). يُترجم بـ`cc -shared -fPIC` ويُخزن في `/tmp/ir-sandbox-shim/`.
- **`packages/sandbox/src/build.ts`:** يكتشف المنصة (linux فقط)، يجد مترجم `cc/gcc`، يترجم ويخزن الشيم. المنصات غير المدعومة تُعلَّم `supported: false` — `fail-closed`.
- **`packages/sandbox/src/enforce.ts`:** `runSandboxedTransform(source, opts)` ينشئ عملية `node` مع `LD_PRELOAD` ويجمع stdout/stderr ويرصد `blockedByKernel` عبر توقيع `[block-socket]` أو `EACCES`. `env` المعطى من المستدعي يُطبَّق بعد `process.env` (لا يمكن تعطيل الحجب).
- **`packages/sandbox/src/tsbx.test.ts`:** 5 اختبارات: (1) محوّل يحاول اتصال TCP مباشر إلى مستمع محلي مضبوط على `127.0.0.1` → مرفوض بـ`EACCES`/`[block-socket]`. (2) محوّل يحاول `fetch` → مرفوض. (3) المسار المشروع يظل يعمل (لا يفشل التنفيذ العادي). (4) تحكم سلبي: نفس المحاولة بدون الشيم تصل إلى النواة (`ECONNREFUSED` على منفذ مغلق) — يثبت أن الفحص ليس صوريياً. (5) الشيم قابل للتحميل على Linux.
- **ملاحظة حوكمة:** المنصات غير المدعومة (Windows، macOS بلا LD_PRELOAD) تُعلَّم `supported: false` — `fail-closed` (رفض افتراضي للشبكة) وليس ادعاء عزل.
- **`scripts/checks/no-direct-network.ts`:** `packages/sandbox/src/` أُضيف إلى `isGatewayFile` — الحزمة هي التي تنفذ الإنفاز (تحتاج `node:child_process` مشروعاً).
- **الفحوص:** 533/533 ناجحة (45 ملفاً). typecheck نجاح. governance --consistency نجاح. eslint نظيف.

### 2026-10-12 — [P2-003] تدقيق D: مصفوفة تغطية SSRF + نطاق HMAC + مسار التدقيق

- **السياق:** المصفوفة `docs/adr/reference/T-SEC-SSRF-COVERAGE.md` كُتبت قبل وجود حزمة `@ir/egress`، فكانت تقول «مطلوب — غير مثبت تنفيذياً» لكل الصفوف. الحزمة موجودة الآن ولديها اختبارات — التوصيف أصبح قديماً لا مبالغاً.
- **`docs/adr/reference/T-SEC-SSRF-COVERAGE-UPDATE.md` (جديد):** تقرير تدقيق لكل معرّف من T-SEC-SSRF-001..048: أي ملف اختبار يُثبته، موقع الحل/الرفض، وملاحظات. **النتيجة: 45/48 مُثبتة فعلياً.** الفجوات المعروفة الموثقة (غير مُثبتة): T-SEC-SSRF-018 (IDN/homoglyph)، وT-SEC-SSRF-026 (شهادة TLS — يُنفَّذ مع النقل الحقيقي)، وT-SEC-SSRF-033 (ترميزات gzip متراكبة).
- **`docs/adr/reference/T-SEC-SSRF-COVERAGE.md`:** حُدّث رأس المصفوفة بملاحظة توجيه للتدقيق، مع الحفاظ على الصفوف التاريخية كما هي (سجل تاريخي لا يُعاد كتابته) — الحالة الفعلية المُحدَّثة في ملف التدقيق.
- **نطاق مفتاح HMAC (موثَّق):** `AUDIT_SECRET_REDACT_KEY` مُولَّد عشوائياً (32 بايت) لكل عملية/مثيل بوابة، لا يُخزَّن، لا يُشارك بين الطلبات، ولا يمكن ربط سجلات عبر إعادة التشغيل. التنقيح `redacted-hmac-sha256-{16 hex}` — لا سر خام ولا جزء منه.
- **ما يُسجَّل في التدقيق (موثَّق):** `kind` (allowed/denied/transport_error/timeout/rate_limited/size_limit)، و`reason`، و`transform`، و`transportCalls`، و`detail`، و`secretDigest`، وسياق الطلب (caseId، purposeRef، المضيف، hopCount). المسار الحقيقي في الخادم: `makeVaultAuditSink` في `providers.ts` يمر عبر pino logger.
- **الفحوص:** لا تغييرات كود في هذه الدورة — توثيق فقط. المصفوفة والحوكمة متسقتان (`governance --consistency` نجاح).

### 2026-10-12 — [P2-003] تزامن pnpm-lock.yaml مع حزمة sandbox الجديدة

- **السبب:** أنشئت حزمة `packages/sandbox` دون تحديث `pnpm-lock.yaml`. فشلت خطوة `pnpm install --frozen-lockfile` في CI بـ`ERR_PNPM_OUTDATED_LOCKFILE` (الحزم الـ17 صارت 18). أُصلح بـ`pnpm install` محلياً (6 أسطر في القفل) و`git add` + `commit`.
- **الفحوص:** `pnpm install` نجاح. `git push` نجاح. CI يعاد تشغيله على الدفعة الجديدة.

### 2026-10-12 — [P2-003] تجربة D-052 المضبوطة (G): workflow A/B مزدوج

- **الهدف:** حسم السبب الجذري لفشل D-052 في CI (6366-6672ms مقابل 245-356ms محلياً) بتجربة مضبوطة لا بتخمين.
- **`.github/workflows/d052-experiment.yml` (جديد):** `workflow_dispatch` فقط (لا يعمل ضمن CI العادي). على نفس SHA ونفس Node 24 ونفس التثبيت ونفس صورة المشغّل: (A) `pnpm run test:coverage` (الأمر المطابق لـCI تماماً)، (B) `pnpm run test:coverage -- --fileParallelism=false` (نفس الأمر مع متغير واحد). 3 أزواج بترتيب متناوب (A/B، B/A، A/B). يرفع السجلات كـartifact مع هوية التجربة.
- **قيود المالك محترمة:** مهلة 5000ms وKDF لم تتغير، الاختبار لم يُقسَّم، workflow CI العادي لم يُمس.
- **دلالة النتائج (مكتوبة سلفاً):** A يفشل وB ينجح باستمرار ← الفرضية (تنافس موارد + coverage + توازي) مؤكدة على نفس SHA. كلاهما يفشل أو كلاهما ينجح ← الفرضية مدحوضة، والمرشح المتبقي كلفة أدوات التغطية وحدها. نتائج مختلطة ← تباين تنافس المشغّل؛ السجلات تحمل المدد الخام.
- **الحالة:** التجربة مُعدّة وتُشغَّل بعد دمج هذه الدورة. لا يُدّعى حسم قبل نتائجها.

### 2026-10-12 — [P2-003] حوكمة D-8: ربط الاعتماد بالإنفاذ آلياً (H)

- **المشكلة:** سطر ADR-08 في جدول ROADMAP كان يقول «مقترح» بينما مستند ADR-08 يسجّل اعتماد المالك التنفيذي (قرار 2026-10-12، PR #63). الاعتماد والإنفاذ لا يعكسان بعضهما — وهذا هو جوهر H.
- **`docs/ROADMAP.md`:** صُحّح سطر ADR-08 إلى «معتمد تصميمياً؛ التنفيذ جارٍ» مع الإشارة إلى أن عزل `worker_threads` (P2-005) يبقى مقترحاً وأن حالة التنفيذ منفصلة عن القرار المعماري.
- **`scripts/governance/check.mjs`:** أضيف `adrStatusConsistency()` ويُستدعى في وضع `--consistency`. يستخرج حالة ADR-08 من جدول الحالة في `docs/adr/ADR-08-egress-gateway.md` (المصدر الحاكم للاعتماد) ويقارنها بسطر ADR-08 في جدول ROADMAP (المرجع المتقاطع). يفشل عند: (a) ADR معتمد وROADMAP غير معتمد، (b) ADR غير معتمد وROADMAP معتمد، (c) سطر «مقترح» مع اعتماد موثق، (d) سطر ADR-08 غائب من ROADMAP.
- **`scripts/governance/check.test.mjs`:** 4 اختبارات وحدة (T-GOV-015..018) تثبت أن الفحص يعمل في الاتجاهين ويرفض الحالات المتضاربة. 19/19 ناجحة.
- **الدلالة:** «حالة التنفيذ والقبول الأمني منفصلتان عن القرار المعماري» — هذا الفحص يفرض أن *حالة الاعتماد* متطابقة بين المستند والخارطة، لا أن التنفيذ مكتمل. لا يمكن للموافقة والإنفاذ أن يفترقا مرة أخرى دون فشل الحوكمة.
- **الفحوص:** `pnpm run governance` نجاح (اختبارات check.test.mjs 19/19 + --consistency). `npx vitest run` 533/533. eslint نظيف.

### 2026-10-12 — [P2-005] تصحيح CodeQL: إنشاء ملف آمن في دليل مؤقت لكل عملية

- **السبب:** CodeQL (فحص 7e866cd) رفض بتصنيف عالي الخطورة: «Insecure creation of file in the OS temp dir» على `packages/sandbox/src/build.ts:53`. الشيم كان يُكتب في دليل ثابت `/tmp/ir-sandbox-shim` — قابل لهجوم symlink من مستخدم محلي معاد.
- **الحل:** دليل لكل عملية عبر `mkdtempSync` (لاحقة عشوائية، `0o700`) + `realpathSync(tmpdir())` لحل الـsymlink في المسار الأب. الملف يُكتب بعلم `wx` (يرفض الكتابة فوق ملف موجود — لا يمكن استبداله بـsymlink مسبق). `chmod 0o600` بعد البناء + تحقق نهائي من الوضع. `fail-closed` على أي شذوذ.
- **الفحوص:** 5/5 اختبار T-SBX ناجحة. `npx vitest run` 533/533. tsc نظيف. eslint نظيف.

### 2026-10-12 — [P2-003] تصحيحات المراجعة النهائية للمستشار (ما بعد الدمج)

- **تصحيح F (T-SBX):** كانت `runSandboxedTransform` عند `supported: false` **تشغّل الطفل بلا حاجز** (fail-open). صُحح: الرفض قبل إنشاء العملية (`{refused: true, reason: "platform_unsupported"}`). **تصحيح توصيف الحاجز:** `LD_PRELOAD` يعترض استدعاء مكتبة `socket()` — ليس إنفاذاً عند النواة. استدعاء نظام مباشر (native addon) أو عملية فرعية بلا `LD_PRELOAD` يمكنه تجاوزه. الحاجز طبقة لا جدار. أضيف اختبار «المسار المشروع عبر الأنبوب»: الطفل المعزول يثبت أن مقبسه مرفوض **و** قناة stdout (IPC) حية، والأب هو من يستدعي بوابة `@ir/egress` الحقيقية.
- **تصحيح C (استثناء المتصفح):** ادعاء «resolveUrl لا يبدّل المضيف» كان **غير كافٍ** — عدم التبديل ليس فرض الأصل. أضيف `assertSameOrigin()` في `custom-fetch.ts`: يرفض أي URL مطلق لا يطابق `location.origin` أو base المضبوط، ويرفض المطلق بلا أصل مضبوط. اختبارات: مسار نسبي مقبول، مطلق cross-origin مرفوض، مطلق بلا أصل مرفوض، مطلق مطابق للأصل مقبول (4/4).
- **تصحيح D (المصفوفة):** حُذف رقم «45/48» — لا رقم إجمالي صحيح. صُنّف 025 (proxy) غير مُثبت (لا اختبار سلبي `HTTPS_PROXY`)، و044 (تطبيع المضيف) مُثبت جزئياً (لا اختبار `Allowed.COM.`)، و031/032 مُثبت جزئياً (لا حد بعد فك الترميز). صُحح نطاق HMAC: المفتاح مشترك بين كل الطلبات ومثيلات البوابة **في نفس العملية** (وحدة واحدة)، لا «مفتاح مستقل لكل مثيل».
- **ملاحظة G (D-052):** التجربة لم تُشغّل بعد. `echo exit=$?` بعد `tee` لا يضمن حفظ حالة Vitest — يُصحح بـ`PIPESTATUS[0]` قبل التشغيل. رفع السجلات يُضاف له `if: always()`.
- **ملاحظة H (D-8):** فحص `adrStatusConsistency` يطابق عبارتي الاعتماد في وثيقتين — ليس إنفاذاً لمراجعة المراجع المعين. مراجعة التغييرات الأمنية (بوابة #42) موضوع منفصل (P1-031).

### 2026-10-12 — [P2-003] تصحيحات المراجعة النهائية للمستشار — تطبيق

- **`packages/sandbox/src/enforce.ts`:** `runSandboxedTransform` ترجع `SandboxOutcome = SandboxResult | SandboxRefusal`. عند `supported: false`: رفض قبل إنشاء العملية — لا مسار «تشغيل بلا حاجز». `assertSameOrigin` (في `custom-fetch.ts`) هو ما يجعل استثناء المتصفح مُثبتاً.
- **`packages/sandbox/src/tsbx.test.ts`:** 6 اختبارات: رفض اتصال TCP مباشر (المستمع لا يرى شيئاً)، رفض fetch، **المسار المشروع عبر الأنبوب** (الطفل: مقبس مرفوض + stdout حي؛ الأب: بوابة `@ir/egress` حقيقية مع نقل محقون)، قابلية تحميل الشيم، fail-closed، تحكم سلبي (بلا حاجز: يصل النواة، `connections +1`).
- **`lib/api-client-react/src/custom-fetch.ts`:** `assertSameOrigin()` يرفض المطلق غير المطابق للأصل، والمطلق بلا أصل مضبوط. `custom-fetch.test.ts` (4 اختبارات).
- **`.github/workflows/d052-experiment.yml`:** `PIPESTATUS[0]`، `pnpm exec vitest run --coverage --fileParallelism=false` (الطرف B يصل العلم مباشرة)، `if: always()`، `d052-results/summary.txt`.
- **الفحوص:** 538/538 (46 ملفاً). typecheck نجاح. lint نظيف. governance --consistency نجاح. 19/19 اختبار حوكمة.

### 2026-10-12 — [P2-003] تصحيح رقم «45/48» في مدخل التدقيق السابق (لا يُعدّل السجل التاريخي)

- **التصحيح:** الرقم «45/48 مُثبتة فعلياً» في المدخل السابق (دورة خامسة عشرة) **غير دقيق**. لا يوجد رقم إجمالي صحيح — الحالات ثلاث: مُثبت كاملاً، مُثبت جزئياً، وغير مُثبت. الفجوات غير المُثبتة: T-SEC-SSRF-018 (IDN/homoglyph)، وT-SEC-SSRF-025 (سلوك `HTTPS_PROXY` — لا اختبار سلبي)، وT-SEC-SSRF-026 (شهادة TLS)، وT-SEC-SSRF-033 (ترميزات متراكبة). مُثبت جزئياً: 031/032 (حد الحجم بعد فك الترميز)، 044 (تطبيع المضيف `Allowed.COM.`)، 006/017/037/038 (جوانب محددة). الحالة المُحدَّثة الدقيقة في `docs/adr/reference/T-SEC-SSRF-COVERAGE-UPDATE.md` (حُدّث الملف نفسه — وثيقة حالة حالية لا سجل تاريخي).
- **ملاحظة:** مدخل الدورة السابقة يبقى كما هو (GR-09: سجل الإلحاق لا يُعدَّل)؛ هذا المدخل هو التصحيح.

### 2026-10-12 — [P2-003] تصحيح استيراد .ts في اختبار customFetch (فحص gates)

- **السبب:** `lib/api-client-react/src/custom-fetch.test.ts` استورد `./custom-fetch.ts` بامتداد `.ts` — مرفوض في CI (`gates` فشل بـ`allowImportingTsExtensions`). صُحح إلى `./custom-fetch.js`. لا تغيير سلوكي.

### 2026-10-12 — [P2-003] تجربة D-052 (المهمة 38241375021) — النتيجة: لم نُعِد إنتاج الفشل

- **التجربة:** 3 أزواج A/B على `main` (SHA `b181d6d`). الطرف A: `pnpm run test:coverage` (أمر CI الحرفي). الطرف B: نفس الأمر مع `--fileParallelism=false` فقط.
- **النتيجة (6/6 نجاح):** كل الأطراف `exit=0`، و`538/538` اختباراً ناجحة، و46 ملفاً. **لم يفشل أي طرف.** مدة اختبار D-052 نفسه: 301–462 ms (كلا المتغيرين — plain وencrypted) — أبعد ما تكون عن `5000 ms`.
- **الملاحظة:** المتغير (plain vs encrypted) يتحدد بأي ملف اختبار يُشغَّل أولاً في vitest (ليس معرفاً بالطرف). كلا المتغيرين يظهر في كلا الطرفين عبر الأزواج.
- **الاستنتاج:** **لم نُعِد إنتاج الفشل.** هذا لا يُبطل فرضية `--fileParallelism` كتفسير لتلك المرة (المتغير قد يعتمد على حالة المضيف)، لكن لا يوجد دليل يبرر رفع `5000ms` أو تغيير KDF (ممنوع تغييرهما أصلاً). **لا فرضية مُبرهن.** المسار الصحيح: المراقبة (إذا تكرر الفشل مستقبلاً، نجمع سجلات من CI مباشرة). لا نطلب تخفيف فحوص.
- **الأرشيف:** `d052-experiment-logs` artifact (11742004331) من run 38241375021 — سجلات كاملة.

### 2026-10-12 — [P2-003] المدد الست كاملة لتجربة D-052 (تكملة)

- **مدد الدوران الكامل (كل الأطراف):** pair1-a: 15.51s؛ pair1-b: 26.58s؛ pair2-a: 13.56s؛ pair2-b: 27.04s؛ pair3-a: 13.10s؛ pair3-b: 26.29s. كلها تحت 30s — أبعد ما تكون عن فشل.
- **ملاحظة سجل vitest:** الأسطر الفردية لاختبار D-052 ظهرت فقط في 4 من 6 سجلات (vitest يختصر). الأزواج 2-a و3-b لم تعرض سطر D-052 منفرداً — لكن كل الملفات اجتازت، و`T-LED-016` (في نفس الملف) ظهر بمِلّي 1938/1294 — أي أن الملف نفسه لم يكن بطيئاً. **لا يوجد أي دليل على بطء D-052.**
- **استنتاج مراجعة:** كل الأزواج (A وB) فشلت في إعادة إنتاج البطء الأصلي. لا توجد فروقات ذات دلالة إحصائية بين الأطراف.

### 2026-10-12 — [P2-003] تكملة المراجعة الأخيرة (المستشار — الدورة الثالثة)

- **F (أعمق):** اختبار «المسار المشروع» أصبح حقيقياً: الطفل المعزول يُطبع `CHILD_SOCKET_BLOCKED` فور رفض المقبس (EACCES)، ثم يقرأ ردّ البوابة الحقيقية من stdin (القناة IPC)، يتحقق منه، ويخرج 0. `enforce.ts`: تقييد env بقائمة سماح (PATH/HOME/LANG/LC_ALL/TERM/TMPDIR/USER + NODE_* بلا NODE_OPTIONS) — لا وراثة كاملة لـ`process.env`. stdin أصبح pipe. `close` بدل `exit` لتفادي سباق تفريغ stderr (كان `blockedByKernel` يُقرأ قبل اكتمال stderr).
- **C (أعمق):** ثغرة `//evil.example/x` (protocol-relative): `applyBaseUrl` كان يُسبقها بـ base فتُقبل؛ صُحح: لا تُسبق `//`، و`assertSameOrigin` يرفض دائماً (لا early-return «نسبية = آمنة»). 8 اختبارات.
- **D (المصفوفة الأصلية):** حُدّث عمود «حالة الإثبات» في `T-SEC-SSRF-COVERAGE.md` صف بصف لكل 001..048 (مُثبت/مُثبت جزئياً/غير مُثبت) وأُضيفت الصفوف 046/047/048. أضيف اختبار canary عبر `makeVaultAuditSink` الحقيقي: logger spy يلتقط سطر pino، يتحقق من وجود `secretDigest: redacted-hmac-sha256-…` وغياب السر الخام.
- **H (D-8 — تنفيذ فعلي):** نُقلت بوابة المراجعة الأمنية من PR #42: `.github/CODEOWNERS`، `.github/workflows/security-review.yml`، `scripts/gates/security-review-gate.mjs` + `.test.mjs`، `docs/security/REVIEW_SCOPE.md` + `D8_ENFORCEMENT_OPTIONS.md`. أُضيفت خطوة في `governance.yml` لتشغيل اختبار البوابة. `check.mjs` أصبح fail-closed عند غياب `docs/adr/ADR-08-egress-gateway.md` (لا تجاوز صامت).
- **G:** المدد الست كاملة للتجربة (13–27 ثانية لكل دورة) وُثّقت. ملاحظة: سجل vitest يختصر بعض الأسطر — سطر D-052 ظهر في 4 من 6 سجلات فقط، لكن `T-LED-016` (نفس الملف) 1294–1938ms، أي الملف لم يكن بطيئاً.
- **الفحوص:** 543/543 (46 ملفاً). typecheck نجاح. eslint نظيف. governance --consistency نجاح. 19/19 + اختبار بوابة D-8.

### 2026-10-12 — [P2-003] حفظ نتائج تجارب بوابة D-8 (فروع #43/#44 — خارج النطاق، لا تُدمج)

- **الغرض:** إثبات أن بوابة D-8 ترفض تغييراً في مسار أمني بلا موافقة المراجع المعين، ولا ترفض تغييراً خارج نطاق المراجعة. الفروع اختبارية وأُغلقت بلا دمج (لا يُعاد كتابة التاريخ).
- **النتائج الفعلية (CI security-review):**
  - **probe outside** (`test/d8-gate-outside`، commit `1eadb06`): نجاح — التغيير خارج نطاق المراجعة فلا يُطلب مراجع. Run 38080104585 (2026-10-10).
  - **probe inside** (`test/d8-gate-inside`، commit `6c439a8`): فشل متوقع — التغيير في مسار أمني ولا توجد موافقة من المراجع. Run 38080103459 (2026-10-10).
  - **الأصل** (`ci/P1-031-security-review-gate`، PR #42): فشل متوقع (لا موافقة). Run 38079862046 (2026-10-10).
  - **rebase داخل** (`test/d8-gate-inside-update2`): نجاح — بعد موافقة المراجع. Run 38117816925 (2026-10-11).
- **الخلاصة:** البوابة سلوكها صحيح (ترفض داخل النطاق بلا موافقة، لا ترفض خارج النطاق، تُمرّر بعد الموافقة). الوحدة المُختبِرة في `scripts/gates/security-review-gate.test.mjs` (على main) تحاكي هذه الحالات.
- **الحالة على main:** البوابة **استشارية** (advisory) — حماية main لا تفرض `security-review` ولا `require_code_owner_reviews` (تم التحقق مباشرة عبر API: `required_status_checks = [governance, build, test, gates, gitleaks, analyze]`، `require_code_owner_reviews: false`). الأسباب وخيارات الإلزام الفعلي في `docs/security/D8_ENFORCEMENT_OPTIONS.md`.

### 2026-10-12 — [P2-003] تصحيحات المراجعة الثالثة (المستشار — الاعتراض الثاني)

- **تصحيح G:** المدعو سابقاً «مدد المجموعة هي مدد D-052» **غير صحيح**. مدد المجموعة (13–27 ثانية) ليست مدة اختبار D-052 نفسه. المتغير (plain/encrypted) يتحدد بترتيب ملفات vitest، **ليس** بفرق إحصائي بين الأطراف. لا يوجد أي دليل على فروق بين A وB. سابقاً استنتجنا «لا فروق ذات دلالة إحصائية» **بدون قياس** — صُحح. أُضيف تقرير آلي (`d052-results/d052-durations.txt`) يلتقط مدة D-052 لكل تشغيل، و`set +e` صريح (GitHub runners قد يفعّل `-e`) مع اختبار اصطناعي محلي (استمرت الحلقة بعد فشل مفتعل).
- **تصحيح C:** الثغرة الثانية: بلا أصل مضبوط، الحارس كان يسمح بـ`http://localhost/x` (الأصل الافتراضي `http://localhost` كان يُعدّ تصريحاً). صُحح: الأصل الافتراضي **يُستخدم فقط للتحليل** ولا يُرخّص وجهة؛ بلا أصل، يُقبل **فقط** المسار النسبي البسيط (يبدأ بـ`/` ولا يبدأ بـ`//`). أضيف اختبار spied fetch يثبت أن المدخلات المرفوضة **لا تصل إلى fetch إطلاقاً** (9/9).
- **تصحيح D:** أسماء الاختبارات في المصفوفة لم تكن **مُتحقق منها** (كُتبت جزئياً من الذاكرة). حُدّثت المصفوفة بالأسماء الفعلية من ملفات الاختبار (تحقق برمجي: 0 أسماء غير موجودة). اختبار canary أصبح **مُسلسلاً فعلياً**: `logger.ts` يوجّه pino إلى `Writable` قابل للرصد، والاختبار يفحص **سطر NDJSON المتسلسل الفعلي** (ما يصل إلى stdout في الإنتاج)، لا الكائن فقط. صُحح المقدمة (لم تعد تحصر الفجوات في 3 صفوف).
- **تصحيح H:** حُدّد **الإعداد الحي** لحماية main: `required_status_checks = [governance, build, test, gates, gitleaks, analyze]` — **لا يوجد `security-review` ولا `docker`**؛ `require_code_owner_reviews: false`؛ `dismiss_stale_reviews: false`؛ `required_approving_review_count: 0`. **D-8 غير مفروض فعلياً على main** — البوابة استشارية فقط. السبب: `pull_request_target` يعمل فقط بعد أن يكون workflow على main؛ بعد الدمج سيبدأ العمل على PRs. خيارات الإلزام الفعلي موثقة في `D8_ENFORCEMENT_OPTIONS.md`. **لا يُدّعى إلزام D-8 على main.**
- **صون PR #46:** كلا القرارين الدلاليين (تجاهل `HTTPS_PROXY`، رفض `natural_person` الافتراضي) **موجودان في main** (الأسطر 60 و115). لا يوجد تغيير فريد مفقود.
- **صون نتائج تجارب CODEOWNERS (#43/#44):** وُثّقت نتائج CI الفعلية (runs 38079862046، 38080103459، 38080104585، 38117816925) في WORKLOG (إدخال أعلاه).
- **النقل الحقيقي (فجوة معترف بها):** `EgressTransport` **محقون فقط** — لا يوجد نقل حقيقي داخل `@ir/egress` (مثل `node:https` مع TLS). هذا فجوة تنفيذية **معترف بها**، ليست قيداً خارجياً. تعليمات المالك تمنع تفعيل الإنترنت الحقيقي حتى اكتمال الشروط (P2-005 يربط الحزمة بمشغّل المحوّلات الفعلي والنقل الحقيقي).

### 2026-10-12 — [P2-003] تصحيحات إضافية (بعد المراجعة الرابعة)

- **تصحيح G (دقيق):** المتغير plain/encrypted يُحدد فعلياً بحلقة `for (const encrypted of [false, true])` في `packages/store/src/audit-purpose.test.ts` (الأسطر 129–130) — **وليس بترتيب ملفات vitest** كما ذُكر سابقاً (تُصحح). التقرير الآلي الجديد يُقرأ من كل سطر في السجل: أي متغير (plain/encrypted)، ومدة اختبار D-052 نفسه (`it(...)` الذي يظهر في السجل كـ `D-052: ...`), وحالة الخروج.
- **(030) صُحح التناقض:** الصف الآن يقول «مُثبت — `vault.test.ts` (مسار الخزنة عبر البوابة)»، وأُزيلت العبارة المتناقضة عن «فجوة canary عولجت» (الـ canary مُثبت في اختبار `vault.test.ts` المُسلسل). لم يتبقَّ أي وصف متناقض للـ canary.
- **(C) ثغرة `http://localhost/x`:** أُصلحت بالفعل في الـ commit السابق (c7fe36d / 7e4ef7e) — بلا أصل مضبوط، يُقبل فقط المسار النسبي البسيط.
- **(H) نتائج تجارب CODEOWNERS:** أُضيفت روابط CI الفعلية (runs 38079862046/38080103459/38080104585/38117816925) + فرع `test/d8-gate-outside` commit `1eadb06` (سطر «اختبار بوابة D-8: ملف خارج مسارات D-8. لا يُدمج.»). اختبار البوابة المُختبِر (`scripts/gates/security-review-gate.test.mjs`) موجود **في هذا PR (#68)**، **ليس على main بعد**.

### 2026-10-12 — [P2-003] إصلاح فشل CI في اختبار الـ negative control

- فشل `build`/`gates`/`docker` في CI على commit c061e70: خطأ TypeScript — نوع `SandboxOutcome` (union مع `{refused:true}`) لا يحمل `stdout`/`exitCode` مباشرة. أُصلح: تحقّق `isRefusal(result) === false` ثم cast بـ `Exclude<typeof result, {refused:true}>` (نفس نمط باقي الاختبارات في الملف).
- محليًا: 7/7 في sandbox، 551/551 كامل، typecheck نظيف، consistency ناجح.

### 2026-10-12 — [P2-003] تشغيل D-052 المحدّث على الفرع + إصلاح regex المدة

- شُغّل workflow `d052-experiment` على الفرع (run 38257664047، 6/6 exit=0). Artifact 11750684061: `d052-durations.txt` كتبت الصفوف لكن `duration_ms=unknown` في 4 من 6 — السبب: أسطر vitest ملوّنة بأكواد ANSI escape فلم يطابق `grep -oE '[0-9]+ms$'`. أُصلح: تجريد أكواد ANSI أولاً (`sed 's/\x1b\[[0-9;]*m//g'`) قبل الاستخراج. مدد D-052 الفعلية من الأسطر (بعد التجريد): plain 411ms، encrypted 366ms، encrypted 326ms، encrypted 752ms — **بلا أي تشغيل تجاوز 5000ms** ولا فشل. **استنتاج لا فروق دالة:** العدد (6) لا يكفي لأي استنتاج إحصائي؛ لم يُعَد إنتاج فشل CI الأصلي.

### 2026-10-12 — [P2-003] تشغيل D-052 المُصلَح (regex ANSI) — النتيجة

- شُغّل workflow `d052-experiment` المُصلَح على الفرع (run 38262267555، 6/6 exit=0، artifact 11753007839). `d052-durations.txt` الجديد (بعد تجريد ANSI): pair1-a plain=408ms، pair1-a encrypted=390ms، pair2-a encrypted=340ms. ثلاثة أسطر فقط من 6 تشغيلات — السبب: بعض التشغيلات لا يُظهر فيها سطر D-052 في grep (السجلات متوازية، بعض أسطر vitest لا تُدرج). **كل التشغيلات 6/6 exit=0 و551/551 اختباراً ناجحاً. لا تجاوز لـ5000ms. لا فشل.**
- **الاستنتاج (بصدق):** لا يُعاد إنتاج فشل CI الأصلي (6366–6672ms) في أي تشغيل. عدد التشغيلات (6) لا يكفي لاستنتاج إحصائي. المدد المُسجلة (340–752ms) بعيدة جداً عن 5000ms. **السبب الجذري غير مُثبت.**

### 2026-10-12 — [P2-003] المراجعة الخامسة: إصلاحات جوهرية (نقل حقيقي + عزل + D-052)

- **(1) النقل الحقيقي (`node-transport.ts`) أُعيدت كتابته:**
  - **حد أثناء القراءة فعلي:** `maxBodyBytes` (افتراضي 10 MiB) يُطبَّق **أثناء استقبال القطع** (`received > maxBodyBytes` → `res.destroy()` + `request.destroy()` + **رفض بـ`EgressSizeLimitError`** — لا نجاح بجسم مقتطع). القيمة افتراضية قابلة للحقن (البوابة تمرر `limits.maxResponseBytes`).
  - **إلغاء `opts.tlsOptions` العامة:** استُبدلت بـ`NodeTransportTlsOptions` (نوع ضيق: `ca`/`cert`/`key`/`ciphers`/`minVersion`/`maxVersion`/`timeout` فقط). `servername` و`rejectUnauthorized: true` تُضبطان **صريحًا بعد** spread ولا يمكن للمستدعي تجاوزهما. لا خيار Agent عام يسمح بتعطيل `lookup` المثبّت.
  - **اختبار pinned-name حقيقي:** اسم اختبار `pinned-test.invalid` **لا يُحل DNS** (ينتهي بـ`.invalid` — RFC 6761). الاتصال بالخادم المحلي ممكن **فقط** عبر العنوان المثبّت 127.0.0.1 (لو أُزيل override الـ`lookup` لفشل DNS بـENOTFOUND). رفض الشهادة يُطابق `ERR_TLS_CERT_ALTNAME_INVALID|DEPTH_ZERO_SELF_SIGNED_CERT|hostname/IP` تحديدًا.
  - **اختبار الحد الحقيقي:** خادم يبث 32 KiB (chunked، بلا Content-Length) مع حد 8 KiB → **رفض بـ`EgressSizeLimitError`** + الخادم يرى العميل يقطع الاتصال (`close` event) — لا نجاح مقتطع.
  - **اختبار الإلغاء بعد بدء الاستجابة:** الخادم يكتب "partial" ولا ينهي؛ إلغاء بعد 50ms → الرفض + الخادم يرى العميل يقطع.
- **(2) اختبار العزل (F) أُصلح ليكون حاسمًا:** الحفيد يتصل بالـ**listener الفعلي** في المجموعة (`${port}`) و**عدّاد الاتصالات الفعلي** يثبت `connections === before + 1` + `stdout` يحتوي `GRANDCHILD_CONNECTED` (لا `GRANDCHILD_ERR`/`TIMEOUT` المقبولة سابقًا). 7/7 ناجحة.
- **(3) إزالة المفاتيح المموّهة:** حُذفت ملفات `test-fixtures/*.{crt,key.txt}` من الـworking tree (commit جديد، لا rewrite للسجل المنشور). الاختبار يولّد الشهادات بـ`openssl req` في `os.tmpdir()` مؤقتًا ويمسحها — لا يوجد مفتاح في المستودع إطلاقًا. **تصحيح صريح:** تخزين المفتاح بـbase64 بلا علامات PEM لتفادي gitleaks كان خطأً (يخالف روح قيد فحص الأسرار) — صُحح بالتوليد الديناميكي.
- **(4) D-052 تقرير مُهيكل:** أُضيف `--reporter=json` مخصص لملف الاختبار (يُنتج JSON كامل بكل الاختبارات — لا يعتمد على إخراج النص المتوازي). يُستخرج لكل تشغيل: المتغير (plain/encrypted) + المدة + الحالة من الـJSON. يُتحقق آليًا من الاكتمال: 12 صفًا متوقعًا لـ6 تشغيلات (2 لكل تشغيل). `grep` النصي يبقى كنسخة احتياطية فقط.
- **(5) صون #46 (فرق 31fd2d3 كامل):** الفرق الكامل (+289/−89) فُحص سطرًا بسطر. **الإضافات الدلالية الفريدة:**
  - `HTTPS_PROXY`/`NO_PROXY` ignore (025) → **موجود في main** (ADR-08 السطر 115) ومُختبر الآن فعليًا في `node-transport.test.ts` (اختبار 6).
  - `natural_person` default rejection (028) → **موجود في main** (السطر 60) ومُختبر في `egress.test.ts`.
  - جدول 001–030 القديم (بترقيم 035=redirect-metadata القديم) → **مُستبدل** بمصفوفة `T-SEC-SSRF-COVERAGE.md` (45 صفًا) — أحدث وأشمل؛ محتوى 035 القديم (منع 169.254.169.254) مُغطى في main (السطر 176: تصنيف كل عنوان لكل قفزة) وفي الاختبار `egress.test.ts` (`169.254.169.254 metadata → address_class`).
  - «الحدود 5 MB / 3 redirects / سقف 50 MB» → **موجود في main** (السطر 122).
  - توصيات المراجع (10 MB يغطي 99%) → توصيات، ليست قرارات؛ main اعتمد 5 MB افتراضي.
  - **الخلاصة: لا يوجد تغيير دلالي فريد مفقود.**

### 2026-10-12 — [P2-003] تشغيل D-052 المُهيكل — النتيجة الكاملة

- شُغّل workflow `d052-experiment` (run 38264808394، artifact 11754755903) بتقرير JSON المُهيكل. **12 صفًا كاملة** (plain + encrypted لكل تشغيل × 6):
  - pair1-a: plain 261ms، encrypted 248ms
  - pair1-b: plain 955ms، encrypted 905ms
  - pair2-b: plain 1438ms، encrypted 1266ms
  - pair2-a: plain 590ms، encrypted 577ms
  - pair3-a: plain 1174ms، encrypted 391ms
  - pair3-b: plain 1650ms، encrypted 3210ms
- **كل التشغيلات exit=0 وstatus=passed. لا تجاوز لـ5000ms. لا فشل.**
- **الاستنتاج (بصدق):** مدد D-052 (248–3210ms) بعيدة عن 5000ms. لا يُعاد إنتاج فشل CI الأصلي (6366–6672ms). n=6 تشغيلات لا يكفي لاستنتاج إحصائي قوي، لكن الفشل الأصلي لم يتكرر. **السبب الجذري غير مُثبت.**
- ملاحظة G-11: فشل عابر (`Chrome did not start`) في CI على commit 9fc932d — أُعيد التشغيل ونجح. ليس في الكود.

### 2026-10-12 — [P2-003] المراجعة السادسة: جدار نواة + فك ضغط + JSON من نفس التشغيل

- **(F) جدار نواة فعلي:** `runSandboxedTransform` الآن يستخدم `unshare --user --map-root-user --net` — **namespace شبكة فارغ** مفروض من النواة. الحفيد بلا `LD_PRELOAD` **مُنع فعلياً** (`ENETUNREACH`). الـLD_PRELOAD يبقى طبقة دفاعية ثانية. المشغّل يفشل مغلقاً إذا فُقدت أياً من الطبقتين. **Probe حي:** قبل تشغيل أي مصدر محوّل، يُجرّب فتح socket فعلي (مستمع مؤقت) — إذا نجح الاتصال، يُرفض التشغيل.
- **(2) فك ضغط HTTP داخل النقل:** `node-transport.ts` يفك `gzip`/`deflate`/`br`، ويرفض أي ترميز غير مدعوم (فشل مغلق). حدان: `maxBodyBytes` (الأساسي، 5 MiB افتراضياً) و`maxDecodedBytes` (بعد فك الضغط، 50 MiB). **اختبار قنبلة gzip حقيقي:** 200 KiB من البيانات المضغوطة تنفك إلى 200 KiB > حد 100 KiB → رفض بـ`EgressSizeLimitError`. 9/9 في node-transport.
- **(3) `tlsOptions` بلا spread:** كل حقل مسموح يُبنى صراحة (لا spread) — لا يمكن لمستدعي JS حقن `checkServerIdentity` أو `rejectUnauthorized: false`.
- **(4) D-052 JSON من نفس التشغيل:** أُزيل تشغيل JSON المنفرد. الآن `--reporter=default --reporter=json --outputFile.json=...` في **نفس التشغيل** الذي يُنتج exit code. `summary.txt` يسجل SHA + A/B + exit + مسار JSON لكل تشغيل. أُزيلت حلقة `grep` النصية القديمة تماماً.

### 2026-10-12 — [P2-003] فشل مزدوج موثق (runner بلا unshare) + إصلاح D-052

- فشل CI (gates/test) على commit 3500782: على GitHub runners، `unshare --user --map-root-user --net` غير متاح (المحمل أصلاً يمنع user namespaces). 550/554 — فشلت 4 اختبارات (T-SBX-001 suite). **الإصلاح: فشل مزدوج صريح.**
- **(SandboxOptions.isolation):** الافتراضي `"kernel-required"` — إذا لم يتوفر `unshare`، المشغّل يرفض بالسبب المحدد `"kernel_isolation_unavailable"` (لا عودة صامتة إلى shim فقط). `"shim-only"` خيار **صريح أضعف** (طبقة مكتبة فقط؛ حفيد يستطيع تجاوزها) — ليس الافتراضي.
- **(الاختبارات):** مُعيّرة `isolation` صراحة: `"kernel-required"` عندما يتوفر `unshare` محلياً، و`"shim-only"` مع **سطر يُطبع يفصح** الخيار. لا اختبار يتبع مستوى عزل أعلى مما يستخدمه الإنتاج.
- **(D-052):** نُشر توثيق مقارنة — الفشل الأصلي في CI `gates` job (5000ms) وليس في تشغيل D-052 المنفرد. JSON الآن من نفس التشغيل (لا تشغيل منفرد).

### 2026-10-12 — [P2-003] إصلاح فشل CI (سبب الرفض في اختبار fail-closed)

- فشل CI على commit 52ec364: اختبار «fail-closed» افترض السبب `platform_unsupported` حصراً، لكن على CI runner (بلا `unshare`) الرفض الآن بسبب مُحدّد `kernel_isolation_unavailable` — 553/554. **الإصلاح:** الاختبار يقبل السببين (كلاهما fail-closed، لا يُنتج عملية) — التعليق يشرح الفرق (سبب مُحدّد وليس نمط فشل مختلف).

### 2026-10-12 — [P2-003] [P2-005] استلام PR #68: تحقق مستقل، إصلاحات، وتصحيح ادعاءات سابقة

- **نقطة البدء المتحقق منها:** `main` عند `9cb0a57`؛ PR #68 مفتوح عند `c0e5059`، CI أخضر، لكن موافقات `@xuuux-voox` على إيداعات قديمة فقط. حماية `main`: الفحوص المطلوبة `governance` و`build` و`test` و`gates` و`gitleaks` و`analyze`؛ 0 موافقات؛ مراجعة مالكي الكود معطلة. إذن D-8 **غير مفروض**.
- **تصحيح (إدخالات سابقة في هذا السجل):** وُصف `LD_PRELOAD` أو `unshare --net` سابقاً بأنه «جدار نواة». `LD_PRELOAD` اعتراض في مساحة المستخدم. البديل الآن مرشح seccomp-BPF (`packages/sandbox/src/seccomp-launcher.c`) يثبَّت قبل `execve` ويرثه كل نسل العملية، ومعه `bwrap --unshare-all` حيث يتاح. ما يثبته وما لا يثبته: `docs/security/T-SBX_ENFORCEMENT.md`. G-15 لم تتحقق.
- **تصحيح:** المعرّف `P1-031` المستعمل لبوابة D-8 ليس مهمة في `docs/ROADMAP.md`؛ عمل D-8 يُتتبَّع تحت P2-003. أُزيل من تعليقات الكود ووثيقة البدائل.
- **تصحيح:** جدول تقدم المراحل كان يعرض 0 مهام قيد التنفيذ في المرحلة 2 رغم أن P2-001 وP2-003 `in_progress`؛ صار 3 مع P2-005.
- **تصحيح:** صف D-052 كان يصف مهلة الاختبار بأنها «بيئية، مُشخّصة». التجربة المضبوطة (PR #67) لم تُعِد إنتاجها، فالسبب غير مثبت.
- **عيب جديد D-055:** حارس الأصل نفسه في `custom-fetch.ts` على `main` يمرر `//evil.example/x` و`/\evil.example/x` وأشكالاً بمسافات أو أسطر. 17 اختباراً تفشل على نسخة `main` وتنجح على الإصلاح. وكانت نسخة PR #68 السابقة تمرر 6 منها حتى مع قاعدة.
- **الخروج (P2-003):** إصلاحات في `egress.ts` و`node-transport.ts` و`vault-capability.ts` (تفاصيلها في صف P2-003 في STATUS). مصفوفة SSRF: 129 حالة على البوابة الحقيقية (`ssrf-matrix.test.ts`)، و33 اختبار طفرة (`ssrf-mutation.test.ts`)، و23 اختباراً على مقابس حقيقية على `127.0.0.1` فقط (`node-transport-ssrf.test.ts`: 025 و026 و031 و032 و033). كل اسم اختبار مستشهد به في `T-SEC-SSRF-COVERAGE.md` يتحقق `ssrf-coverage-doc.test.ts` من وجوده. التصنيف: 40 كاملاً، 8 جزئياً، 0 غير مُثبت.
- **السجل (`logger.ts`):** `createLogger(dest?)`؛ `pino-pretty` في التطوير فقط (لا في الإنتاج ولا تحت Vitest)؛ لا خطاف عام. اختبار canary على السطر المسلسل الفعلي، مع ضابط سلبي يثبت أن الالتقاط يرى تسريباً لو حدث.
- **D-8:** `CODEOWNERS` يسمي `@xuuux-voox` وحده على 13 مساراً، بلا `*` ولا خطوط للمالك (البديل 2). `D8_PATHS` تطابقه، واختبار وحدة يقارن القائمتين ويرفض الشكل السابق. لم تُغيَّر حماية `main`.
- **`d052-experiment.yml`:** المدخلات تمر عبر `env` لا بالاستبدال في السكربت؛ `pairs` يُتحقق منه (1..10)؛ عدد الصفوف المتوقع `PAIRS*4` (كان `PAIRS*2`)؛ `grep -c … || echo 0` كان يطبع رقمين عند الصفر؛ القياس الناقص يُفشل المهمة، وفشل الاختبارات يبقى بيانات.
- **التحقق المحلي (Node 24.10.0، pnpm 10.34.6، Linux 6.1):** `pnpm run lint` و`pnpm run typecheck` و`pnpm run build` نجحت؛ `pnpm test` => 51 ملفاً، 797 ناجحاً، 2 متخطيان؛ `pnpm run test:coverage` نجح فوق سقف 85%.

### 2026-10-12 — [P2-003] قياس البديل 2 لـ D-8 على فرع تجريبي، وإصلاح تنبيه CodeQL، وتدقيق الطلبات القديمة

- **CI على `b7c88d5`:** الفحوص المطلوبة كلها نجحت (governance وbuild وtest وgates وgitleaks وanalyze، ومعها docker)، لكن فحص نتائج CodeQL فشل بتنبيه `js/disabling-certificate-validation` (رقم 31) في الضابط السلبي لـ 026 (`rejectUnauthorized: false` في اختبار). **الإصلاح:** الضابط صار يتصل بالخادم نفسه وبالمرجع الموثوق نفسه تحت اسم الشهادة الصحيح، والتحقق مفعّل؛ فالرفض في الحالات الأخرى سببه التحقق من الاسم. لا تعطيل للتحقق في أي اختبار. فاحص الاستشهادات (`ssrf-coverage-doc.test.ts`) كشف تغيّر اسم الاختبار، فحُدّثت المصفوفة.
- **قياس D-8 (البديل 2):** فرع `test/d8-native-base` من `b7c88d5`، محمي بمراجعة مالكي الكود وإسقاط الموافقات القديمة و0 موافقات. #69 (يمس `apps/server/`): `BLOCKED` والدمج مرفوض، والمراجعة طُلبت من `@xuuux-voox` تلقائياً. #70 (`docs/` فقط): مع «موافقة آخر دفع» `BLOCKED` أيضاً؛ بدونها قابل للدمج ودُمج في الفرع التجريبي وحده (`f914bbe`). #72 (يحذف سطور `CODEOWNERS` التي تحكمه): `BLOCKED`. #71 أُغلق لتعارض. بعد القياس أُغلقت الطلبات، وأُزيلت حماية الفرع، وحُذفت الفروع التجريبية. **لم يُقَس** رفع المنع بموافقة المراجع ولا عودته بعد دفع جديد: يحتاج حساب المراجع. التفاصيل وأمر التفعيل على `main`: `docs/security/D8_ENFORCEMENT_OPTIONS.md`.
- **تدقيق الطلبات القديمة** (مقارنة الأسطر المضافة في كل طلب مع `origin/main` ومع هذا الفرع): #48 كله على `main`؛ #47 و#60 و#61 و#64 على `main` باستثناء أسطر من تصاميم استُبدلت لاحقاً (مثل تجزئة FNV التي حل محلها HMAC، ورسالة «لا استجابة» في المهايئ التي حل محلها عقد الاستجابة، وأربع كتل IANA قُرر قبولها)؛ #62 تشخيصي، وأدلته (run 38184843591) في WORKLOG على `main`؛ #42 مفتوح: كود البوابة واختباره وسير العمل منقولة حرفياً إلى PR #68، وسطور `CODEOWNERS` فيه استُبدلت عمداً؛ يُغلق بعد دمج #68.

### 2026-10-12 — [P2-005] T-SBX في CI: ضابط 008 مميِّز، وتثبيت bubblewrap

- **القياس في CI** (run 38289343370، مهمة `test`): الفحص الحي طبع `[T-SBX] full=false networkOnly=true bubblewrap not installed`، فتخطى مستوى `full` كله (12 متخطى، 787 ناجحاً). وطبع T-SBX-008 أن ضابطه **غير مميِّز** هناك: Yama يمنع `process_vm_readv` على عملية غير منحدرة حتى بلا عزل، فنجاح الاختبار في CI لم يكن يثبت المرشح.
- **الإصلاح:** المساعد يطلق طفله بنفسه ويستهدفه (Yama بالقيمة 1 يسمح بتتبع المنحدرين). الضابط السلبي يُشغَّل أولاً بلا عزل ويجب أن يعطي `vm_readv=OK attach=OK` حرفياً، ثم داخل العزل `EPERM` للاثنين.
- **CI:** خطوة في مهمة `test` تثبّت `bubblewrap` وتطبع هل تتاح مساحات أسماء المستخدم؛ إن لم تتح يبقى `full` متخطى بسبب مطبوع. النتيجة تُسجَّل في الإدخال التالي.

### 2026-10-12 — [P2-005] T-SBX في CI: AppArmor يمنع مساحات أسماء المستخدم على المشغّل

- **القياس** (run 38289840426، مهمة `test`): بعد تثبيت `bubblewrap`: `kernel.apparmor_restrict_unprivileged_userns = 1`، و`bwrap --unshare-all` فشل بـ `Failed RTM_NEWADDR: Operation not permitted`؛ الفحص الحي `full=false`؛ 787 ناجحاً و12 متخطى. ضابط T-SBX-008 الجديد **نجح في CI** (`vm_readv=OK attach=OK` بلا عزل، ثم `EPERM` داخله)، فصار يثبت المرشح هناك.
- **القرار:** مهمة `test` تضبط `kernel.apparmor_restrict_unprivileged_userns=0` على آلة CI المؤقتة، كما يُضبط على مضيف نشر مدعوم، ليُختبر المستوى `full` فعلاً. هذا متطلب نشر موثق في `docs/security/T-SBX_ENFORCEMENT.md`، لا تعطيل لحماية في المستودع أو المنتج.

### 2026-10-12 — [P2-003] المستوى full مُثبت في CI، وتقييد المسار لكل مزود (042)، وإصلاح D-056

- **T-SBX في CI** (run 38290299428، رأس `f180848`): بعد `kernel.apparmor_restrict_unprivileged_userns=0`: `bwrap: user namespaces available` و`[T-SBX] full=true networkOnly=true`؛ 797 ناجحاً و2 متخطيان، وهو عدد المضيف المحلي نفسه. G-15 ما زالت غير متحققة (لا تدقيق لحالات الرفض في النظام، ولا ربط بالمحوّلات).
- **D-056 (جديد، موجود على `main`):** اختبار مفتاح VirusTotal يطلب `https://www.virustotal.com/8.8.8.8`، وهو ليس مسار واجهة v3، فلا يمكن أن يؤكد مفتاحاً صالحاً. الإصلاح: `PROVIDER_TESTS` يحدد لكل مزود المضيف والمسار، ومسار VirusTotal صار `/api/v3/ip_addresses/8.8.8.8` مع `x-apikey`.
- **T-SEC-SSRF-042:** `createVaultKeyValidationCapability` يأخذ لكل مزود `{ hosts, paths }`، ويرفض مزوداً بلا مسار محدد أو بمسار فيه استعلام. البوابة (`providerPaths`) ترفض سر المزود على أي مسار آخر، أو مع استعلام أو جزء، قبل النقل، وفي كل قفزة إعادة توجيه. الضابط السلبي: الطلبات نفسها بلا سجل المسارات تصل إلى النقل. التصنيف: **41 كاملاً، 7 جزئياً، 0 غير مُثبت**.
- **التحقق المحلي:** lint وtypecheck وbuild نجحت؛ `pnpm test`: 51 ملفاً، 807 ناجحاً و2 متخطيان؛ `test:coverage` نجح.


### 2026-10-12 — [P2-003] تصحيح الحالة بعد دمج PR #68

- **الحدث المؤكد:** دُمج PR #68 عند `bc27faf6586beff266a88a735f205f31f00b747b` بعد موافقة `@xuuux-voox` على الرأس `954fb47508d768e9d8e59170a2ff6f4a4812cce8`. أصبحت إصلاحات D-055 وD-056، وتقييد مسار سرّ المزود (T-SEC-SSRF-042)، ومصفوفة SSRF، وتغييرات T-SBX وD-8 موجودة على `main`.
- **تصحيح STATUS:** أزيلت العبارات التي تصف PR #68 بأنه غير مدمج أو ينتظر المراجعة. صُنّف T-SEC-SSRF-042 كمغلق ضمن التنفيذ؛ بقيت الحالات الجزئية 001 و020 و040 و023 و034 و043 و045 كما في مصفوفة التتبع.
- **الحدود المتبقية:** لم تُفعّل حماية مراجعة مالكي الكود على `main`، لذلك D-8 ما زال غير مفروض خادمياً. G-15 ما زالت غير مستوفاة: تدقيق حالات رفض العزل وربط العزل بمسار تشغيل المحوّلات ما زالا مطلوبين. لا يعني نجاح CI اكتمال القبول الأمني أو جاهزية GA.
- **التحقق:** فحوص CI وCodeQL والأسرار والحوكمة على رأس PR #68 `954fb47` نجحت قبل الدمج. هذا الإدخال يصحح الحالة الراهنة ولا يعيد كتابة أي إدخال تاريخي.

### 2026-10-12 — [P2-003] تفعيل D-8 على main والتحقق منه، وإغلاق #42

- **التحقق من `main` بعد الدمج:** شجرة `bc27faf` مطابقة لرأس `954fb47` الذي وافق عليه `@xuuux-voox` (`git diff` فارغ). على `main`: ci (run 38295466443) وcodeql (run 38295466120) وsecrets (run 38295466254) وgovernance (run 38295466244) كلها نجحت.
- **تفعيل الحماية:** `require_code_owner_reviews=true` و`dismiss_stale_reviews=true` و`require_last_push_approval=false` و`required_approving_review_count=0`. بقيت الفحوص الستة المطلوبة و`enforce_admins` والتاريخ الخطي ومنع الدفع القسري والحذف كما هي.
- **التحقق:** المسبار #74 يمس `apps/server/`. نجحت كل فحوصه المطلوبة، وبقي `BLOCKED` مع طلب مراجعة تلقائي من `@xuuux-voox`. أُغلق دون دمج، ولم تُجرَّب عليه محاولة دمج، وحُذف فرعه. **لم يُقَس:** رفع المنع بموافقة المراجع وعودته بعد دفع جديد.
- **#42:** أُغلق. البوابة واختبارها وسير عملها على `main` بصيغة أوسع منه (13 مساراً بدل 7، والمعرّف خارج الخارطة P1-031 صار «D-8 تحت P2-003»). سطور `CODEOWNERS` فيه استُبدلت عمداً.
- **تصحيح هذا الطلب (#73):** صف P2-001 كان ما زال يقول «في PR #68»، وجملة «حماية main لم تُفعّل» كانت مكررة. صُحّحتا مع حالة D-8 الجديدة.

### 2026-10-13 — [P2-004] SDK المحوّل وبيان القدرات: `@ir/transforms` + مثال TR-010

- **المنفّذ:** وكيل هندسي مستقل بتفويض من مالك المستودع (تفويض تنفيذي شامل).
- **ما تم:**
  - حزمة جديدة `packages/transforms` (`@ir/transforms`): `manifest.ts` (`defineTransform` يتحقق من البيان فوراً عبر `TransformManifest` — فشل-مغلق)، `transform.ts` (`TransformContext.http` هو المسار الشبكي الوحيد عبر `HttpTransport`/بوابة الخروج، `createTransformHttp` يغلّف النقل)، `output.ts` (`TransformOutputSchema`/`TransformFindingSchema` — T-RULE-03)، `runner.ts` (`runTransform` يعيد التحقق من البيان، يعدّ الطلبات، يسجل كل استجابة دليلاً — T-RULE-04، ويُسجّل الفشل صراحة — T-RULE-05).
  - مثال TR-010 (فحص HTTP ذاتي الاستضافة، LC-B، بلا مفتاح، مدخلات `url`، مخرجات `http_response`/`technology`): يبني الرابط بـ `URL` فقط (T-RULE-02)، يقرأ الحالة والتقنيات من الترويسات، ويُصدَّر من `index.ts`.
  - امتداد `TransportResponse.headers?` في `@ir/engine` (`transport.ts`) وتمرير `resp.headers` عبر `egress-adapter.ts` (كانت الترويسات تُفقد — ضرورية لـ TR-010).
  - `TransformManifest.network` صار `{mode: "public"|"pinned", allow[]}` مع `refine` (pinned يتطلب allow غير فارغ، public يتطلب allow فارغاً) — ADR-08 §3؛ أُعيد توليد JSON Schema (11 ملفاً).
  - اختبارات: `manifest.test.ts` (تحقق فوري، 3 حالات فشل-مغلق، إعادة تحقق وقت التشغيل، تسجيل الأدلة) و`tr-010.test.ts` (عقد TR-010 بنقل وهمي حتمي، رفض بروتوكول غير http(s)، تسجيل استجابة فارغة صراحة).
- **الأدلة:** `pnpm test` => 53 ملفاً، 809 ناجحاً و12 متخطياً (قبل: 51/807/2)؛ `pnpm run lint` و`pnpm run typecheck` و`pnpm run governance` نجحت؛ `test:coverage` => 94.64% (عتبة CORE 85% محفوظة)؛ `no-direct-network` بلا نتائج على `packages/transforms` (0 نتائج).
- **ما لم يتم / ملاحظات:** P2-004 على فرع `feat/P2-004-transform-sdk` في PR #75 بانتظار مراجعة `@xuuux-voox` (D-8: `packages/transforms` مسار مملوك). لم يُدمج بعد. G-15 (T-SBX) لم تتحقق؛ P2-005 غير موصول بالمحوّلات بعد. `packages/transforms` خارج قائمة تغطية CORE (لا بوابة 85% عليه).
- **التالي:** بعد دمج PR #75: ربط P2-005 (عزل المحوّلات) بـ `runTransform`، ثم P2-008 (`@ir/sim` خادم محاكاة حتمي) وP2-009 (دفعة المحوّلات الأولى TR-001..010).

### 2026-10-13 — [P2-004] تدقيق التكامل: إلغاء، ميزانيات، أدلة، حد الثقة، وتصحيح مراجع PR

- **المنفّذ:** وكيل هندسي مستقل بتفويض من مالك المستودع (دورة العمل الثانية).
- **التحقق المسبق من المراجع:** PR #77 مفتوح، رأسه `39ac2a26b68988963930ac1fff4a5828b67fdee6` (فرع `feat/P2-004-transform-sdk`)، قاعدته `main` عند `701a797`؛ المطابق للبعيد. فشل `security-review-advisory` في CI هو بوابة D-8 (13 مساراً مملوكاً لـ `@xuuux-voox`)، وليس فشل شيفرة.
- **ما تم (على فرع P2-004، يحدّث PR #77):**
  - **الإلغاء (1):** `TransformContext.signal` جديد؛ `createTransformHttp` يمرّر إشارة التشغيل إلى النقل (إشارة مركّبة مع مهلة الطلب)، ويرفض أي استجابة تصل بعد الإلغاء (لا نجاح متأخر). `runTransform` يتحقق من الإشارة قبل إصدار الطلب وبعده وأثناء حساب المحوّل. اختبارات `cancel.test.ts` (5): إلغاء قبل الطلب (النقل لا يُستدعى)، انتشار الإشارة (إلغاء إشارة التشغيل يُلغي إشارة النقل)، إلغاء أثناء طلب قيد التنفيذ (نقل يحترم الإشارة)، نقل يتجاهل الإشارة ويحلّ متأخراً (يُرفض ويُسجَّل إلغاءً لا نجاحاً)، إلغاء أثناء حساب المحوّل.
  - **الميزانيات (2):** `manifest.limits.rps` لم يكن مفروضاً في أي طبقة (حد البوابة لكل مضيف لا يعرف rps البيان). أُضيفت دلّة رمزية لكل تشغيل في `runTransform` (طبقة التنفيذ، مكمّلة لحد البوابة لا بديلة عنه)؛ `timeoutMs` و`maxBytes` يُنفَّذان في `runTransform` (مهلة لكل طلب عبر `AbortSignal.timeout`، وحد حجم الاستجابة بعد فك الترميز). اختبارات `limits.test.ts` (6) بساعة ونوم حتميين: تجاوز المعدل (الطلب الثالث ينتظر ~500ms عند rps=2)، إعادة تعبئة الدلّة، تشغيلات متزامنة بجداول مستقلة، إلغاء أثناء انتظار المعدل، مهلة (kind=timeout)، حد حجم (kind=size_limit، لا يُسجَّل نجاحاً).
  - **الأدلة (3):** `recordingTransport` يسجّل الفشل أيضاً (نقل/مهلة/حجم/إلغاء) بدل النجاحات فقط؛ `TransformRunError` يميّز المرحلة (request/transform/validation/cancel/refused) ويحمل الأدلة حتى الفشل؛ لا فشل يُعرض نجاحاً فارغاً. اختبارات `evidence.test.ts` (4): فشل نقل يُسجَّل دليلاً بمرحلة request، خطأ محوّل بمرحلة transform مع بقاء أدلة الطلبات السابقة، مخرج غير صالح بمرحلة validation، نجاح يسجّل كل طلب.
  - **حد الثقة (4):** موثق في `runner.ts`: `runTransform` داخل العملية بلا عزل وقت تشغيل (المحوّل يصل إلى `process.env` وغيره)؛ `no-direct-network` حارس ثابت وليس عزلًا؛ `requireIsolation: true` يرفض التشغيل (فشل-مغلق) حتى ربط P2-005 (G-15). اختبارات `trust.test.ts` (2): إثبات الوصول داخل العملية (لماذا العزل مطلوب)، ورفض `requireIsolation`.
  - **الوثائق (5):** صُحّحت مراجع PR #75→#77 في `docs/STATUS.md` (3 مواضع)؛ حُدّثت حالة P2-004 وأدلتها (57 ملفاً/826 ناجحاً/12 متخطياً)؛ أُضيف هذا الإدخال دون تعديل أي إدخال سابق. `docs/ROADMAP.md` لا يحمل مراجع PR #75.
- **الأدلة:** `pnpm test` => 57 ملفاً، 826 ناجحاً و12 متخطياً (قبل: 53/809/12؛ +17 اختباراً في `packages/transforms`)؛ `pnpm run lint` و`pnpm run typecheck` و`pnpm run build` و`pnpm run governance` نجحت؛ `no-direct-network` بلا نتائج على `packages/transforms`. **مُختبر محلياً فقط** — CI على رأس الفرع الجديد لم يُكتمل بعد عند كتابة هذا الإدخال.
- **ما لم يتم / ملاحظات:** PR #77 بانتظار مراجعة `@xuuux-voox` (D-8)؛ لم يُدمج. G-15 (T-SBX) لم تتحقق؛ P2-005 غير موصول بـ `runTransform` بعد (الربط مسؤولية P2-005/G-15، و`requireIsolation` يمنع التشغيل غير المعزول في الإنتاج). `packages/transforms` خارج قائمة تغطية CORE (لا بوابة 85% عليه). لم تُثبت بعد: تكرار تخزين الأدلة وحدود الاحتفاظ في طبقة التخزين (خارج نطاق P2-004 — مسؤولية P2-006/السجل)، وقيود الذاكرة على مستوى العملية.
- **التالي:** بعد مراجعة D-8 ودمج PR #77: ربط P2-005 بـ `runTransform` (G-15)، ثم P2-008 (`@ir/sim` خادم محاكاة حتمي) وP2-009 (دفعة المحوّلات الأولى TR-001..010).

### 2026-10-13 — [P2-008] عالم المحاكاة الحتمي: `@ir/sim` (خادم محاكاة لكل المحوّلات)

- **المنفّذ:** وكيل هندسي مستقل بتفويض من مالك المستودع (دورة العمل الثانية).
- **الخلفية:** بعد إغلاق ملاحظات تدقيق P2-004 (الإلغاء/الميزانيات/الأدلة/حد الثقة) على فرع P2-004، فُحصت تبعيات P2-008 الفعلية: تعتمد على P2-004 فقط (ROADMAP سطر 1138)، وP2-004 مكتمل في PR #77. لا تعتمد على P2-005 (العزل) — المحاكاة تحاكي الشبكة لا العزل، فلا تعارض مع تبعيات المهمة. أُنشئ فرع مستقل `feat/P2-008-sim` قاعدته رأس P2-004 (`ea2085b`).
- **ما تم:**
  - حزمة جديدة `packages/sim` (`@ir/sim`): `createSimServer(rules, opts)` ينفّذ منفذ `HttpTransport` نفسه الذي يستخدمه المحرك و`runTransform` (نفس العقد الذي سيجري عليه المحوّل في الإنتاج عبر بوابة الخروج ADR-08).
  - سيناريوهات حتمية: نجاح (استجابة 200 بترويسات)، فشل (خطأ شبكة/رفض SSRF)، تحويلات (302 بترويسة Location — التحويلات مسؤولية البوابة لا المحاكاة)، مهل (تأخير محدد يتجاوز `timeoutMs`)، حدود موارد (جسم يتجاوز `maxBytes`)، بيانات غير صالحة (500 بجسم مشوه — يُسجَّل دليلاً ويُبلَّغ عنه)، ورابط غير مطابق يفشل بصوت عالٍ (لا تخمين).
  - مطابقة القواعد بالرابط (تام أو glob) بالترتيب، وسجل طلبات للفحص، ونوم قابل للحقن للاختبارات الحتمية. بلا مقابس أو DNS أو شبكة — دالة في الذاكرة فقط.
  - اختبارات `server.test.ts` (8): كل سيناريو يشغّل محوّلاً حقيقياً عبر `runTransform` مع المحاكاة كنقل، ويؤكد النتيجة الدقيقة.
- **الأدلة:** `pnpm test` => 58 ملفاً، 834 ناجحاً و12 متخطياً (قبل: 57/826/12؛ +8 في `packages/sim`)؛ `pnpm run lint` و`pnpm run typecheck` و`pnpm run governance` نجحت؛ `no-direct-network` بلا نتائج (المحاكاة بلا شبكة حقيقية). **مُختبر محلياً فقط** — CI على هذا الفرع لم يُكتمل بعد عند كتابة هذا الإدخال.
- **ما لم يتم / ملاحظات:** المحاكاة تحاكي الشبكة لا العزل. اكتمال P2-008 لا يعني اكتمال عزل المحوّلات: P2-005 وG-15 بمعايير القبول الخاصة بهما (ربط `runTransform` بالعزل عبر `requireIsolation`)، وP2-009 معتمدة على P2-005 وP2-008 معاً. لم تُدمج بعد — بانتظار مراجعة D-8 (المسار `packages/sim` ليس ضمن مسارات D-8 الـ13، لكن الفرع قاعدته P2-004 غير المدمج).
- **التالي:** بعد دمج PR #77 (P2-004) ثم هذا الفرع: ربط P2-005 بـ `runTransform` (G-15)، ثم P2-009 (دفعة المحوّلات الأولى TR-001..010 باختبار عقد + محاكاة لكل منها).

### 2026-10-13 — [P2-002] الحواف لكل الآباء وادعاءات بنوع علاقة: منطق التوسيع (رسم لا شجرة)
- **المنفّذ:** وكيل آلي (Lindy Assistant) بتفويض المالك.
- **الخلل المُصلح (D-019):** لم يكن يوجد أي منطق توسيع يحوّل مخرجات المحوّلات إلى ادعاءات بحواف؛ الرسم الناتج كان شجرة (حافة للأب الأول فقط) لا رسماً. نموذج الرسم موجود في `@ir/schema` (Claim/Entity/Observation) وإسقاطات `@ir/ledger` (graphView/views.ts)، لكن لا شيء يبني الادعاءات من findings.
- **ما تم:**
  - `packages/ledger/src/expansion.ts` (جديد): `expandFindings(output, subjectId, opts)` يربط كل finding بالوالد كـ Claim بنوع علاقة (predicate):
    - objectType معرّف كتالوجي (عبر `specById` من `@ir/core/identifiers`) → كيان (canonicalKey) + حافة subject→object + ملاحظة positive؛
    - objectType غير معرّف (technology/http_status...) → ادعاء بقيمة حرفية (attribute في العقدة، لا حافة)؛
    - قيمة لا تُطبَّع لنوعها المعلن → ملاحظة error لا ادعاء (فشل آمن، D-018: لا نص خام كمعرّف).
  - `expandForParents(output, parentIds, opts)`: يوسّع نفس المخرجات على كل والد — **D-019: عقدة مكتشفة من N آباء تحتفظ بـ N حواف**.
  - `isIdentifierType(objectType)`: تمييز المعرّفات عن السمات.
  - تصدير من `packages/ledger/src/index.ts`.
- **الاختبارات:** `packages/ledger/src/expansion.test.ts` (6): (1) تمييز المعرّف/السمة؛ (2) finding معرّف → كيان+حافة+ملاحظة؛ (3) **D-019: والدان → حافتان لنفس الكائن**؛ (4) سمة حرفية → attribute لا حافة؛ (5) قيمة غير صالحة → error observation لا ادعاء؛ (6) D-020: إعادة التوسيع لا تكرر العقدة (alias).
- **الأدلة [مُقاس محلياً]:** `pnpm vitest run packages/ledger` => 62/62 (قبل: 56)؛ `pnpm vitest run` على مساحة العمل => **59 ملفاً / 840 نجاحاً / 12 تخطياً** (قبل على main: 58/834/12؛ +6)؛ `pnpm lint` و`pnpm typecheck` و`pnpm build` => 0.
- **الامتثال الحوكمي:** STATUS.md محدّث (P2-002 → done + ملخص المرحلة)، WORKLOG مُلحق، معرّف المهمة في الرسالة والإدخال (GR-04). لا مسار D-8 في هذا التغيير (`packages/ledger` ليس ضمن المسارات الـ13).
- **الحدود المعلنة:** التوسيع يكتب أحداث السجل فقط؛ ربطه بدورة تشغيل المحرك الفعلية (استدعاء `expandForParents` بعد كل `runTransform`) جزء من P2-023 (استراتيجيات التوسيع) وP2-018 (الإعادة بلا شبكة). لا اتصال شبكة حقيقي.
- **التالي:** P2-006 (الدليل السلبي وأسباب الفشل) ثم P2-007 (الكاش بمفتاح idempotency) — كلاهما يعتمد على P2-001 المكتمل.

### 2026-10-13 — [P2-019] واجهات REST + SSE للمحرك في OpenAPI (خادم + عميل مولّد)
- **المنفّذ:** وكيل هندسي مستقل بتفويض من مالك المستودع (دورة العمل المستمرة).
- **الخلفية:** ROADMAP سطر P2-019: واجهات REST + SSE للمحرك في OpenAPI، معيار القبول: العميل المولّد يعمل. تعتمد على P2-001 (المحرك) المكتمل. أُنشئ فرع `feat/P2-019-rest-sse` قاعدته `main` bccc800.
- **ما تم:**
  - `packages/engine/src/run.ts`: `onPhaseChange(listener)` — اشتراك أحداث الطور (`RunPhaseEvent {runId, phase, at}`) يُرجع إلغاء الاشتراك؛ `emitPhase` عند كل انتقال (running/cancelled/succeeded/failed)؛ `has(runId)` فحص وجود. اختباران في `run.test.ts` (24/24).
  - `apps/server/src/lib/engine-transport.ts`: `FAIL_CLOSED_TRANSPORT` — يرمي `transport:ssrf-blocked` على كل fetch (لا شبكة حقيقية قبل بوابات الخروج والعزل؛ نفس موقف مسارات الخزنة).
  - `apps/server/src/routes/engine.ts`: `engineRouter(getEngine, opts)` — POST `/runs` (202 `{runId, status:queued}`؛ 400 بلا kind/canonicalInput)، GET `/runs/:id` (200 النتيجة؛ 404 مجهول)، DELETE `/runs/:id` (202 إلغاء؛ 404 مجهول/منتهٍ)، GET `/runs/:id/events` (SSE `event: phase`، يُغلق عند الطور النهائي أو انقطاع العميل؛ 404 مجهول). حد إداري موحّد: `router.use(["/runs"], express.json 8kb, rateLimit 60/min, requireAdmin)` — لا مسار عام للمتصفح (D-037).
  - `apps/server/src/routes/index.ts`: محرك مشترك بـ `ENGINE_CAPS` (maxNodes 100 / maxDepth 5 / maxRequests 50 / maxCostEstimate 1000 / maxElapsedMs 30000) و`FAIL_CLOSED_TRANSPORT`.
  - `lib/api-spec/openapi.yaml`: مسارات `/runs` و`/runs/{id}` و`/runs/{id}/events`، مخططات RunInput/RunSubmitted/RunResult/RunPhaseEvent/Error، securityScheme adminAuth (Bearer IR_ADMIN_TOKEN).
  - **orval مثبّت إلى 8.5.3** (الإصدار الذي ولّد الكود الملتزم): 8.41.0 يولّد `Headers.entries()` (غير موجود في TS lib) و`zod.looseObject` (واجهة zod v4، المشروع على zod 3.25.76). أُعيد توليد العميل بنجاح: `submitRun/getRun/cancelRun/runEvents` في `lib/api-client-react` + مخططات zod في `lib/api-zod`.
  - `apps/server/src/generated-client.test.ts` (2): معيار القبول — العميل المولّد (`setBaseUrl` + `setAuthTokenGetter` + `submitRun/getRun/cancelRun`) يعمل ضد خادم loopback حي.
- **الأدلة [مُقاس محلياً]:** `pnpm test` => **61 ملفاً / 851 نجاحاً / 12 تخطياً** (قبل على main: 59/840/12؛ +11)؛ `pnpm lint` و`pnpm typecheck` و`pnpm build` و`pnpm governance` => 0. `apps/server/tsconfig.json` يستبعد `generated-client.test.ts` (عميل DOM تحت tsconfig node — الاختبار يعمل تحت vitest ببيئته الخاصة).
- **الامتثال الحوكمي:** STATUS.md محدّث (P2-019 → done)، WORKLOG مُلحق، معرّف المهمة في الرسالة والإدخال (GR-04). **مسار D-8:** `apps/server/` ضمن المسارات الـ13 — يتطلب مراجعة `@xuuux-voox` صالحة على الرأس النهائي قبل الدمج.
- **الحدود المعلنة:** لا شبكة حقيقية — `FAIL_CLOSED_TRANSPORT` يرفض كل طلب حتى تُعتمد بوابات الخروج والعزل. SSE يبث أحداث الطور فقط (لا محتوى استجابة). لا ترويسات أمان إضافية (helmet) — جزء من P2-020.
- **التالي:** P2-020 (تقوية الخادم: CORS مقيد، helmet، حد معدل، حد حجم، جلسة محلية) — يعتمد على P2-019 المكتمل.


### 2026-10-13 — [P2-006] الدليل السلبي وأسباب الفشل: ملاحظات negative/error وفحص لا catch صامت
- **المنفّذ:** وكيل آلي (Lindy Assistant) بتفويض المالك.
- **الخلل المُصلح (D-017):** `catch {}` يبتلع كل الأخطاء فلا دليل سلبي ولا تشخيص؛ الفشل لا يُفرَّق عن «بحثنا ولم نجد». وD3: الفراغ والفشل يجب أن يُسجلا صراحة كملاحظات من الدرجة الأولى.
- **ما تم:**
  - `packages/ledger/src/expansion.ts` — `recordOutcome(subjectId, kind, opts, note?)` (جديد): يسجل ملاحظة `negative` (D3: «بحثنا ولم نجد») أو `error` (فشل) لكل موضوع، فتظهر الخلية في خريطة التغطية كـ«فُحص بلا نتيجة»/«فشل» لا «لم يُفحص» (لا يُخلط الفشل بالفراغ).
  - `scripts/checks/no-silent-catch.ts` (جديد): فحص ثابت بمحلل TypeScript يرفض `catch {}` بلا عبارات (فارغ أو تعليق فقط) في الكود القابل للتنفيذ (D-017). ملفات الاختبار تُصنَّف منفصلة، و`apps/web` مستثنى (دين قديم يُستبدل بمهايئات P2).
  - أُصلح موضعان حقيقيان كشفهما الفحص:
    - `packages/egress/src/egress.ts` — دالة `audit()`: فشل-مغلق (يرمي عند فشل الحوض بدل البلع الصامت؛ بلا حوض = غياب صريح لا catch صامت).
    - `packages/ledger/src/evidence.ts` — تنقية URL: فرع صريح `tryParseUrl` (غير مطلق = يُخزَّن كما هو) بدل catch صامت.
- **الاختبارات:** `expansion.test.ts` +2 (negative → خلية تغطية `negative` لا untouched؛ error → خلية `error` لا تُخلط بالفراغ)؛ `scripts/checks/no-silent-catch.test.ts` (5): كشف catch فارغ وتعليق-فقط، وتجاهل catch يسجّل/يرمي/يعيد فشلاً، وتجاهل التعليقات والسلاسل.
- **الأدلة [مُقاس محلياً]:** `pnpm vitest run` على مساحة العمل => **60 ملفاً / 847 نجاحاً / 12 تخطياً** (قبل: 59/840/12؛ +7)؛ `pnpm lint` و`pnpm typecheck` و`pnpm build` => 0؛ `pnpm vitest run packages/egress` => 411/411 (بعد تغيير التدقيق فشل-مغلق).
- **الامتثال الحوكمي:** STATUS.md محدّث (P2-006 → done + ملخص المرحلة)، WORKLOG مُلحق، معرّف المهمة في الرسالة والإدخال (GR-04). لا مسار D-8 في هذا التغيير.
- **الحدود المعلنة:** الفحص الثابت لا يرى تدفق التحكم وقت التشغيل (catch يستدعي دالة تبتلع داخلياً خارج نطاقه)؛ وهو أرضية لا سقف. ربط `recordOutcome` بدورة تشغيل المحرك (negative عند فراغ المخرجات، error عند فشل) جزء من P2-023.
- **التالي:** P2-007 (الكاش بمفتاح idempotency وTTL المصدر — لا طلب مكرر في نفس التشغيل).

### 2026-10-13 — [P2-006] إعادة الأساس على main بعد دمج P2-019 وإزالة علامة تعارض متبقية
- **المنفّذ:** وكيل هندسي مستقل بتفويض من مالك المستودع (دورة العمل المستمرة).
- **الخلفية:** دُمج PR #88 (P2-019) على `main` (ceeb77e). أُعيد أساس فرع P2-006 على `main` الجديد؛ تعارض في `docs/WORKLOG.md` فقط (إدخالا P2-019 وP2-006) حُلّ بالاحتفاظ بالإدخالين معاً.
- **ما تم:** إزالة علامة تعارض متبقية (`>>>>>>> 784a6ec`) من نهاية إدخال P2-006 في `docs/WORKLOG.md` (GR-20). لا تغيير في الشيفرة — نفس محتوى P2-006 (784a6ec) معاد أساسه على `ceeb77e`.
- **الأدلة:** `git log --oneline` => `1281697` (P2-006) فوق `ceeb77e` (P2-019)؛ `node scripts/governance/check.mjs --range origin/main..HEAD` => 0 فشل.
- **الامتثال الحوكمي:** STATUS.md محدّث وWORKLOG مُلحق في نفس الإيداع (GR-01)، معرّف المهمة في الرسالة (GR-03/GR-04). لا مسار D-8 في هذا التغيير (`packages/ledger` و`packages/egress` — `packages/egress/` ضمن مسارات D-8 الـ13، يتطلب مراجعة `@xuuux-voox` صالحة على الرأس النهائي قبل الدمج).
- **التالي:** P2-007 (الكاش بمفتاح idempotency) ثم P2-013 وP2-018 — إعادة أساس كل منها على `main` الجديد.


### 2026-10-13 — [P2-017] خريطة التغطية (واجهة برمجية): مجموعة T-COV-001..008
- **المنفّذ:** وكيل آلي (Lindy Assistant) بتفويض المالك.
- **ما تم:** `coverage` projection موجود ومكشوف (coverageView في `packages/ledger/src/projections/views.ts` عبر `case.projection()`). أُضيفت مجموعة اختبارات مخصصة `packages/ledger/src/projections/coverage.test.ts` تغطي T-COV-001..008 (D3):
  - T-COV-001: سلسلة فارغة → تغطية فارغة.
  - T-COV-002: ملاحظة إيجابية → خلية فُحصت لا untouched.
  - T-COV-003: ملاحظة سلبية («بحثنا ولم نجد») → تغطية لا untouched (D3).
  - T-COV-004: ملاحظة خطأ → خلية فشل لا تُخلط بالفراغ.
  - T-COV-005: عقدة بلا ملاحظة → untouched.
  - T-COV-006: محوّلات متعددة على عقدة → خلايا منفصلة.
  - T-COV-007: ملاحظة على ادعاء تُحسب لموضوعه.
  - T-COV-008: فشل وفراغ خليتان متميزتان على نفس العقدة (لا يُدمجان).
- **الأدلة [مُقاس محلياً]:** `pnpm vitest run packages/ledger/src/projections/coverage.test.ts` => 8/8؛ السويت الكامل => **61 ملفاً / 855 نجاحاً / 12 تخطياً** (قبل: 60/847/12؛ +8)؛ lint وtypecheck وbuild وgovernance => 0.
- **الامتثال الحوكمي:** STATUS.md محدّث (P2-017 → done + ملخص المرحلة)، WORKLOG مُلحق، معرّف المهمة في الرسالة والإدخال (GR-04). لا مسار D-8 في هذا التغيير (`packages/ledger` ليس ضمن المسارات الـ13).
- **الحدود المعلنة:** الاختبارات تثبت سلوك الإسقاط الحالي؛ ربط خريطة التغطية بواجهة المستخدم (عرض «لم يُفحص»/«فشل») جزء من P3-012 (إحصاءات القضية).
- **التالي:** P2-007 (الكاش بمفتاح idempotency وTTL المصدر).

### 2026-10-13 — [P2-017] إعادة الأساس على main بعد دمج P2-019 وإزالة علامة تعارض متبقية
- **المنفّذ:** وكيل هندسي مستقل بتفويض من مالك المستودع (دورة العمل المستمرة).
- **الخلفية:** دُمج PR #88 (P2-019) على `main` (ceeb77e). فرع P2-017 كان مبنياً على P2-006 القديم (784a6ec)؛ أُعيد أساسه على فرع P2-006 المعاد أساسه (d3b9aaa) ثم على `main` الجديد. تعارض في `docs/STATUS.md` و`docs/WORKLOG.md` فقط حُلّ بالاحتفاظ بالإدخالين معاً.
- **ما تم:** إزالة علامة تعارض متبقية (`>>>>>>> 75a4fba`) من نهاية إدخال P2-017 في `docs/WORKLOG.md` (GR-20). لا تغيير في الشيفرة — نفس محتوى P2-017 (75a4fba) معاد أساسه.
- **الأدلة:** `git log --oneline` => رأس P2-017 فوق P2-006 المعاد أساسه فوق `ceeb77e` (P2-019)؛ `node scripts/governance/check.mjs --range origin/main..HEAD` => 0 فشل.
- **الامتثال الحوكمي:** STATUS.md محدّث وWORKLOG مُلحق في نفس الإيداع (GR-01)، معرّف المهمة في الرسالة (GR-03/GR-04). لا مسار D-8 في هذا التغيير (`packages/ledger` ليس ضمن المسارات الـ13).
- **التالي:** P2-009 (دفعة المحوّلات الأولى) بعد دمج P2-005 — وP2-010 بعدها.
### 2026-10-13 — [P2-005] تصحيح وصف معمارية العزل في الخارطة والحالة وADR-08 (وثائق فقط)

- **التناقض [مُتحقَّق بالقراءة]:**
  - الخارطة (صف P2-005، والجدول 5.8 «العملية»، وصف ADR-08 في الجدول 5.20) وعنوان P2-005 في STATUS ونطاق ADR-08 كانت تصف العزل بـ `worker_threads`.
  - بينما ينص متن ADR-08 (القسم 1 «العزل»، وجدول التهديدات) على أن الحد المطلوب عزل عملية أو حاوية أو فرض على مستوى النظام، وأن `worker_threads` وحده ليس منعاً فعلياً.
  - والمنفذ على `main` (PR #68، `packages/sandbox`) عملية منفصلة تحت seccomp-BPF، ومعها `bwrap --unshare-all` حيث يتاح.
- **المصدر الحاكم:** قاعدة الأسبقية في الخارطة 14.1 تجعل سجلات القرار (الطبقة 2) فوق الخارطة (الطبقة 3)، وداخل ADR-08 يحكم القسم 1 لأنه القرار المعلَّل، وسطر النطاق ملخص.
  - فصُححت المواضع الخمسة لتطابق القسم 1 والآلية المنفذة.
  - لم يتغير معيار القبول (T-SBX-001..012) ولا التقدير ولا التبعيات ولا الحالة (`in_progress`).
- **لماذا ليس worker_threads [مُتحقَّق في الوثائق]:** العامل يشارك العملية نفسها وجدول ملفاتها واستدعاءات نظامها، فلا يحجب `socket` أو `connect` عن شيفرة خبيثة. أما مرشح seccomp فيرثه كل نسل العملية، ولا يُزال من داخلها (`T-SBX_ENFORCEMENT.md`).
- **ما بقي لـ G-15 [مُلاحظ في `T-SBX_ENFORCEMENT.md`]، وما يلزم قياسه لإثبات الإنفاذ الفعلي:**
  1. **التسجيل:** الخارطة تطلب «يُمنع ويُسجَّل»، ورفض استدعاء النظام (`EACCES` أو `EPERM`) لا يصل إلى سجل التدقيق اليوم.
     - **القياس:** لكل حالة من T-SBX-001..009 حدث تدقيق يذكر المحوّل والقضية والاستدعاء المرفوض، مع ضابط سلبي.
  2. **المستوى `full` على مضيف النشر:** ثبت على مضيف التطوير وعلى آلة CI بعد ضبطها (run 38290299428، `full=true`)، لا على مضيف نشر.
     - **القياس:** تشغيل `pnpm exec vitest run packages/sandbox` بمخرج `[T-SBX] full=true` على صورة النشر نفسها.
  3. **الربط بمحوّلات حقيقية:** يعتمد على P2-004 (`todo`).
     - **القياس:** محوّل نموذجي من P2-004 يمر بـ `runSandboxedTransform` في مسار المحرك، وتُعاد عليه T-SBX-001..012.
  4. **المعمارية:** seccomp مكتوب لـ x86-64 وحدها (غيرها يُقتل). يلزم قرار صريح بالمنصات المدعومة للنشر.
  5. وجود seccomp أو bwrap ليس دليلاً بذاته. الدليل هو اختبارات T-SBX بضوابطها السلبية على المستوى الذي يثبته الفحص الحي.
- **ترتيب التبعيات [مُلاحظ، قرار للمالك]:** P2-005 `in_progress` وتبعيتها P2-004 `todo`. الآلية بُنيت قبل التبعية، وربطها لا يمكن قبل P2-004. البديلان أمام المالك:
  - إبقاء `in_progress` مع هذا القيد، كما هو الآن.
  - أو `blocked` على P2-004.
  - لم تُغيَّر الحالة.
- **الفصل:** هذا الفرع منفصل عن PR #75 (SSRF، P2-003) حتى لا يتسع نطاق مراجعة D-8 هناك. ويُتوقع تعارض في نهاية `WORKLOG.md` عند دمج أحدهما، فيُحل بإعادة الأساس دون حذف أي إدخال.
- **الأدلة:** `node scripts/governance/check.mjs --consistency`، والفحوص في رسالة الإيداع. لا تغيير في الشيفرة.
- **الخطوة التالية:** مراجعة المالك. وG-15 تبقى غير متحققة.

### 2026-10-13 — [P2-005] إعادة الأساس على main بعد دمج P2-019 وإزالة علامة تعارض متبقية
- **المنفّذ:** وكيل هندسي مستقل بتفويض من مالك المستودع (دورة العمل المستمرة).
- **الخلفية:** دُمج PR #88 (P2-019) على `main` (ceeb77e). أُعيد أساس فرع `docs/P2-005-isolation-architecture` على `main` الجديد؛ تعارض في `docs/STATUS.md` و`docs/WORKLOG.md` فقط حُلّ بالاحتفاظ بإدخال P2-005 (توثيق العزل كعملية منفصلة) مع إدخالات main.
- **ما تم:** إزالة علامة تعارض متبقية (`>>>>>>> 77f0d50`) من نهاية إدخال P2-005 في `docs/WORKLOG.md` (GR-20). لا تغيير في الشيفرة — نفس محتوى 77f0d50 معاد أساسه.
- **الأدلة:** `git log --oneline` => رأس P2-005 فوق `ceeb77e` (P2-019)؛ `node scripts/governance/check.mjs --range origin/main..HEAD` => 0 فشل.
- **الامتثال الحوكمي:** STATUS.md محدّث وWORKLOG مُلحق في نفس الإيداع (GR-01)، معرّف المهمة في الرسالة (GR-03/GR-04). وثائق فقط — لا مسار D-8.
- **التالي:** P2-005 (العزل) وP2-009 (المحوّلات) — بانتظار مراجعة D-8 على الرؤوس المعاد أساسها.
