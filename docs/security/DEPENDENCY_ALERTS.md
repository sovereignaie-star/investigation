# سجل فرز تنبيهات الاعتماديات (P1-029، D-054)

> **السياسة (قرار المالك D-3، 2026-10-10):** التنبيه **الحرج** يُعالَج خلال **24 ساعة** من ظهوره (أو من اعتماد السياسة للتنبيهات السابقة لها)، و**العالي** خلال **7 أيام**. المعالجة إما إصلاح بإصدار مثبت في `pnpm-lock.yaml` على `main`، وإما **استثناء موثق** في هذا الملف يذكر دليل عدم قابلية الاستغلال وموعد إعادة المراجعة. لا تُقرَّر قابلية الاستغلال من مستوى الشدة وحده، بل من مسار الاعتمادية الفعلي (`pnpm why -r`) وطريقة استعمال الكود. التنبيهات المتوسطة والمنخفضة تُسجَّل وتُعالَج مع أقرب تحديث، بلا مهلة ملزمة. لا يُغلق تنبيه يدوياً (dismiss) بلا سطر هنا.

## فرز 2026-10-10 (طلب الدمج P1-029)

المصدر: واجهة GitHub لتنبيهات Dependabot، 23 تنبيهاً مفتوحاً كلها من `pnpm-lock.yaml` وأنشئت في 2026-10-10. المسارات من `pnpm why -r <حزمة>` على الفرع. «المسار» يحدد هل الكود يصل إلى الخادم المشحون أم أدوات التطوير فقط؛ تصنيف Dependabot «runtime» لكل الحزم الانتقالية تقريباً لا يميّز ذلك.

### حرج وعالٍ (12)

| # | الشدة | الحزمة | الاستشارة | المسار الفعلي | القرار | الدليل | الإصلاح أو الموعد |
|---|---|---|---|---|---|---|---|
| 59 | حرج | `proxy-addr` | [GHSA-jqcg-44mw-7w3h](https://github.com/advisories/GHSA-jqcg-44mw-7w3h) انتحال IP عبر شبكة ثقة IPv6 مرسومة من IPv4 | **الخادم المشحون**: `express@5.2.1` و`express-rate-limit` في `@ir/server` | إصلاح | الخلل يظهر حين تُضبط شبكة ثقة بنص (مثل `::ffff:10.0.0.0/8`). الخادم يضبط `trust proxy` بعدد قفزات فقط (`app.ts:24`، `Number(TRUST_PROXY)`)، فالاستغلال غير مرجّح، لكنه لم يُثبت بتجربة، والمسار حي في الإنتاج، فلا استثناء | `2.0.7` -> `2.0.8` |
| 14 | عالٍ | `fast-uri` | [GHSA-4c8g-83qw-93j6](https://github.com/advisories/GHSA-4c8g-83qw-93j6) | أدوات التطوير: `ajv@8.20.0` <- `@scalar/*` <- `orval` في `@workspace/api-spec` (توليد الكود) | إصلاح | لا يصل إلى الخادم ولا الواجهة المبنية؛ الإصلاح متاح ضمن النطاق فلا حاجة لاستثناء | `3.1.2` -> `3.1.8` |
| 16 | عالٍ | `fast-uri` | [GHSA-v2hh-gcrm-f6hx](https://github.com/advisories/GHSA-v2hh-gcrm-f6hx) | كما في #14 | إصلاح | كما في #14 | `3.1.8` |
| 21 | عالٍ | `fast-uri` | [GHSA-7p8r-x3mc-p8w7](https://github.com/advisories/GHSA-7p8r-x3mc-p8w7) | كما في #14 | إصلاح | كما في #14 | `3.1.8` |
| 32 | عالٍ | `fast-uri` | [GHSA-jqff-g426-hqxp](https://github.com/advisories/GHSA-jqff-g426-hqxp) | كما في #14 | إصلاح | كما في #14 | `3.1.8` |
| 33 | عالٍ | `fast-uri` | [GHSA-fph4-wmhf-6fwf](https://github.com/advisories/GHSA-fph4-wmhf-6fwf) | كما في #14 | إصلاح | كما في #14 | `3.1.8` |
| 34 | عالٍ | `fast-uri` | [GHSA-f65p-4m7j-42xc](https://github.com/advisories/GHSA-f65p-4m7j-42xc) | كما في #14 | إصلاح | كما في #14 | `3.1.8` |
| 48 | عالٍ | `fast-uri` | [GHSA-qw65-cvwx-89v3](https://github.com/advisories/GHSA-qw65-cvwx-89v3) | كما في #14 | إصلاح | كما في #14 | `3.1.8` |
| 25 | عالٍ | `browserslist` | [GHSA-73wf-gq98-2v4g](https://github.com/advisories/GHSA-73wf-gq98-2v4g) | أدوات البناء: `@babel/helper-compilation-targets` <- `@vitejs/plugin-react` في `@ir/web` و`@ir/sandbox` | إصلاح | وقت البناء فقط | `4.28.2` -> `4.29.3` |
| 26 | عالٍ | `browserslist` | [GHSA-c83g-rgw3-j3cx](https://github.com/advisories/GHSA-c83g-rgw3-j3cx) | كما في #25 | إصلاح | كما في #25 | `4.29.3` |
| 11 | عالٍ | `brace-expansion` | [GHSA-3jxr-9vmj-r5cp](https://github.com/advisories/GHSA-3jxr-9vmj-r5cp) | أدوات التطوير: `minimatch@10.2.5` <- `@typescript-eslint/typescript-estree` | إصلاح | وقت الفحص فقط؛ نسخة `1.1.21` (عبر `minimatch@3`) خارج النطاق المصاب (`>=3.0.0`) | `5.0.6` -> `5.0.12` |
| 54 | عالٍ | `braces` | [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) استنفاد المكدس بأنماط أقواس متداخلة | أدوات التطوير: `micromatch@4.0.8` <- `fast-glob@3.3.3` في `@ir/sandbox` (`mockupPreviewPlugin.ts`) | **استثناء مؤقت** | لا إصدار مصلح (النطاق المصاب `<= 3.0.3` وهو آخر إصدار؛ `micromatch@latest` يطلب `^3.0.3`). الاستغلال يتطلب نمط glob يتحكم فيه مهاجم؛ النمط الوحيد ثابت في الكود (`` `${MOCKUPS_DIR}/**/*.tsx` `` و`MOCKUPS_DIR = "src/components/mockups"`)، والإضافة تعمل في خادم Vite للتطوير فقط، ولا تدخل حزمة الخادم ولا صورة Docker. أثر أسوأ حالة: توقف أداة تطوير محلية | إعادة المراجعة **2026-10-17** أو عند صدور إصلاح، أيهما أسبق؛ البديل حينها: استبدال `fast-glob` في `@ir/sandbox` بـ `fs.glob` في Node |

### متوسط ومنخفض (11)

| # | الشدة | الحزمة | المسار | القرار |
|---|---|---|---|---|
| 3، 27، 28 | متوسط | `qs` | `express` في الخادم | إصلاح: `6.15.1` -> `6.16.0` |
| 13 | منخفض | `body-parser` | `express` في الخادم | إصلاح: `2.2.2` -> `2.3.0` |
| 52 | متوسط | `brace-expansion` | كما في #11 | إصلاح: `5.0.12` |
| 53 | متوسط | `fast-uri` | كما في #14 | إصلاح: `3.1.8` |
| 44 | متوسط | `baseline-browser-mapping` | أدوات البناء | إصلاح: `2.10.28` -> `2.11.28` |
| 57 | متوسط | `fast-copy` | `pino-pretty` (تطوير) | إصلاح: `4.0.3` -> `4.1.2` |
| 58 | متوسط | `postcss-selector-parser` | `@tailwindcss/typography@0.5.20` في `@ir/web` (بناء) | مؤجل: الإصدار مقيد بـ `^6` في الحزمة الأم؛ إعادة مراجعة مع تحديث `@tailwindcss/typography` |
| 4 | منخفض | `esbuild` | `@ir/server` و`@ir/cli` (بناء)، ومثبت بـ override `esbuild: 0.27.3` في `pnpm-workspace.yaml` (بينما `package.json` للحزمتين يطلب `0.28.2`؛ الـ override هو الفاعل [مُلاحظ]) | مؤجل: الخلل في خادم التطوير على Windows فقط؛ رفع الإصدار تغيير مقصود في override يحتاج مهمة خاصة |
| 5 | منخفض | `@babel/core` | `@vitejs/plugin-react` (بناء) | مؤجل: `7.29.6` و`7.29.7` منشوران وضمن النطاق `^7.29.0`، لكن `pnpm update -r --depth Infinity @babel/core` أبقى `7.29.0` [مُقاس]؛ السبب [للتحقق]. إعادة مراجعة مع تحديث `@vitejs/plugin-react` أو عبر override صريح في مهمة لاحقة |

### التحقق

- بعد التحديث (`pnpm update -r --depth Infinity` لحزم الإصلاح، ضمن النطاقات المعلنة، بلا تغيير `package.json`): `pnpm why -r` يعطي `proxy-addr@2.0.8` و`fast-uri@3.1.8` و`browserslist@4.29.3` و`brace-expansion@5.0.12` و`qs@6.16.0` و`body-parser@2.3.0`.
- إغلاق التنبيهات المُصلحة يتم آلياً من GitHub بعد الدمج في `main`؛ يُسجَّل العدد المتبقي في `docs/WORKLOG.md`.
