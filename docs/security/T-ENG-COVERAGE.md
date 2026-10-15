# خريطة تغطية T-ENG-001..015 (قبول P2-001)

> **الغرض:** حصر شروط قبول P2-001 (`@ir/engine`: طابور، ميزانيات، إلغاء لكل تشغيل) المذكورة في ROADMAP (القسم 6، صف P2-001: «T-ENG-001..015») وربط كل معرّف بدليل. معرّف واحد مربوط خارجياً بمرجع حاكم: **T-ENG-012 = NFR-07** (ROADMAP §9: «استئناف التشغيل بعد إعادة التشغيل — يستأنف من الطابور المحفوظ»). بقية المعرّفات بلا تعداد مادي في أي ملف، فاشتُق الترقيم من نطاق المهمة نفسه — دون تغيير أي معيار قبول، وبإبقاء غير المستوفى ظاهراً.
>
> **حالة الإغلاق: غير مكتمل — T-ENG-012 (NFR-07) غير مستوفى** (انظر صفه أدناه).
>
> **إعادة الإنتاج:** `pnpm exec vitest run packages/engine` => 9 ملفات / **83 ناجحاً / 0 فاشلاً** (2026-10-15 على main@`1e47f48`، Node 24.10.0). `pnpm run test` (كامل المستودع) => 1520 ناجحاً / 6 متخطاة.

## الربط بمنفذ الشبكة الحقيقي

شرط صف P2-001 المتعقّب: «لا اتصال حقيقي من المحرك قبل اكتمال P2-003 وT-SBX» — مُستوفى: منفذ النقل للمحرك موصول ببوابة الخروج عبر `createEgressHttpTransport` (`packages/engine/src/egress-adapter.ts`)، وهو النقل المستخدم فعلاً في مسار الإنتاج `ir run --network` و`ir investigate` (`packages/cli/src/network.ts` يستورده من `@ir/engine`)، مع اختبارات تكامل المحرك+البوابة خضراء (ssrf-blocked، حد المعدل، الإلغاء، الترويسات، السر غير المثبت). الخادم يبقى `FAIL_CLOSED_TRANSPORT` بقرار ADR-08 (لا محرك شبكة حقيقية في الخادم قبل بوابات الخروج).

## الخريطة

| المعرّف | السلوك المطلوب (نطاق P2-001) | الاختبار الأخضر | الملف |
|---|---|---|---|
| T-ENG-001 | طابور أولويات داخل العملية: ترتيب واستقرار عند تساوي الأولويات (5.7) | `dequeues in priority order` + `is stable for equal priorities` | `queue.test.ts` |
| T-ENG-002 | تحقق صارم من قيم الخيارات والميزانيات (رفض NaN/سالب/لانهائي/غير صحيح) | `rejects invalid engine options (NaN, Infinity, negative, non-integer)` | `run.test.ts` |
| T-ENG-003 | `consume()` ذرّي و`check()` غير معدِّل للحالة | `consumes and reports a snapshot` + `check does not mutate state` | `budget.test.ts` |
| T-ENG-004 | رفض قابل للقراءة آلياً لكل قفص (nodes/depth/requests/cost/time) | `refuses depth, requests, cost and time separately` + `exposes a machine-readable refusal on the error` | `budget.test.ts` |
| T-ENG-005 | رمز إلغاء لكل تشغيل: التسجيل، أول سبب يفوز، `whenCancelled`، جسر `AbortSignal` بـ`CancellationError` | كل اختبارات `createCancellationToken` (6) | `cancel.test.ts` |
| T-ENG-006 | إلغاء تشغيل مرصود في الطابور قبل أي نقل: `cancelled` بصفر محاولات نقل (D-022) | `cancelling a queued run before drain produces cancelled with zero transport attempts (D-022)` | `run.test.ts` |
| T-ENG-007 | كل محاولة نقل — بما فيها إعادة المحاولة — تُخصم من ميزانية `requests` (D-024) | `charges every retry attempt against the requests budget (D-024)` | `run.test.ts` |
| T-ENG-008 | إعادة المحاولة للأخطاء العابرة فقط (5xx/429) بتراجع أسي قابل للإلغاء | `retries transient 5xx up to maxRetries then succeeds` + `exhausts retries on persistent 5xx and fails with a typed transport failure` | `run.test.ts` |
| T-ENG-009 | عدم إعادة المحاولة للأخطاء الدائمة (4xx، dns) | `does not retry non-retryable failures` + `does not retry permanent 4xx responses` + `does not retry a non-retryable TransportError (dns)` | `run.test.ts` |
| T-ENG-010 | دورة حياة التشغيل (queued/running/succeeded/failed/cancelled) مع أحداث الطور | `returns results for multiple inputs` + `onPhaseChange observes the queued→running→succeeded transitions` + `onPhaseChange reports cancelled...` | `run.test.ts` |
| T-ENG-011 | `drain()` غير تراكمي ورفض `drain()` المتداخلة (تزامن مقيد) | `drain() is not additive: a second call does not re-execute finished runs` + `rejects overlapping drain() calls instead of exceeding concurrency` | `run.test.ts` |
| T-ENG-012 | **[NFR-07 — غير مستوفى]** استئناف التشغيل بعد إعادة التشغيل: يستأنف من الطابور المحفوظ | **لا يوجد اختبار — العنصر غير منفذ:** `PriorityQueue` في الذاكرة فقط (`private heap`)، ولا آلية لحفظ الطابور ولا لاستئنافه بعد إعادة تشغيل العملية؛ `restart(runId)` (P2-025) يعيد تشغيلاً فاشلاً داخل العملية الحية ولا يغطي NFR-07. **هذا هو البند المتبقي الوحيد المعروف لقبول P2-001** | — |
| T-ENG-013 | المهلة الزمنية تقطع نقلاً يتجاهل إشارة الإلغاء (فرض بالسباق لا بالتعاون) | `a transport that IGNORES the abort signal is still cut off by the time budget` | `run.test.ts` |
| T-ENG-014 | لا يُحتسب نجاحاً أي استجابة تصل بعد الإلغاء | `a transport that ignores the signal and resolves late is NOT reported as a success` + `a run cancelled during a pending transport is not reported as a success` | `run.test.ts` |
| T-ENG-015 | الإلغاء أثناء انتظار التراجع ينهي التشغيل `cancelled` لا `budget:time` | `a backoff wait that IGNORES the abort signal is still cut off by cancellation` + `cancelling a run with a signal-ignoring transport ends drain() as cancelled, not budget:time` | `run.test.ts` |

## ملحقات القبول اللاحقة (مهام أخرى، ليست من نطاق P2-001)

تصنيف أخطاء النقل (`TransportError` مع `retryable`/`retryAfterMs`) — اختبارات `transport.test.ts` (2) + `classifies transport failures with a machine-readable reason` في `run.test.ts` — من نواة المحرك الأخضر لكن خارج المعرّفات الـ15 (T-ENG-012 محجوز لـNFR-07).

مهام لاحقة وسّعت المحرك وأدخلت اختباراتها الخاصة الخضراء ضمن نفس الحزمة — ليست شرطاً لقبول P2-001 لكنها تُذكر للسياق: بوابة الأشخاص (P2-013، `gate.test.ts`)، الإعادة بلا شبكة (P2-018، `replay.test.ts`)، الكاش (P2-007، `cache.test.ts`)، إعادة المحاولة/إعادة التشغيل (P2-025، ضمن `run.test.ts`)، مهايئ بوابة الخروج (PR #68، `egress-adapter.test.ts`)، وأحداث الطور لـSSE (P2-019).

## حدود معلنة (لا تُخفي)

- **T-ENG-012/NFR-07 غير منفذ** — يبقى ظاهراً هنا وفي صف STATUS حتى يُنفّذ ويُثبت.
- `RunEngine` نفسه يقود التوسع في مسار الخادم فقط؛ مسار CLI للتحقيق (`ir investigate`) يدير حلقته الخاصة بميزانيات `@ir/egress` مباشرة، ويستخدم من المحرك منفذ النقل (`createEgressHttpTransport`) لا RunEngine. هذا قرار تصميمي موثق في P2-038، لا نقص في P2-001.
- إلغاء أثناء انتظار تراجع طويل فعلي (دقائق) مثبت بمؤقتات اختبار قصيرة (10–40ms) لا بانتظار دقائق — مقبول لدقة الاختبارات الحتمية، وموثق هنا للحد منه.
