# مصفوفة اختبار مفاتيح المزوّدين (P2-015 / D-032)

> كل مزوّد في الخزنة إما له اختبار مفتاح مُعرَّف (`PROVIDER_KEY_TESTS` في `apps/server/src/lib/providers.ts`) أو سبب موثق لعدم إمكانه (`PROVIDER_TEST_BLOCKED`). الاختبار يمر حصراً عبر بوابة الخروج بمضيف ومسار مثبتين، والمفتاح يسافر في ترويسته المعينة فقط — لا في الرابط أبداً (D-031/P2-016)، ولا استعلام في طلب يحمل سراً (T-SEC-SSRF-042). نقاط النهاية وأسماء الترويسات موثقة من الوثائق الرسمية الحالية لكل مزوّد (المصادر أدناه؛ تحقق 2026-10-16).

## القابلون للاختبار (8)

| المزوّد | المضيف والمسار المثبتان | ترويسة المفتاح | ملاحظات |
|---|---|---|---|
| ipinfo | `ipinfo.io/8.8.8.8` | `Authorization: Bearer` | قائم من قبل (P2-003) |
| virustotal | `www.virustotal.com/api/v3/ip_addresses/8.8.8.8` | `x-apikey` | قائم من قبل (D-056) |
| haveibeenpwned | `haveibeenpwned.com/api/v3/subscription/status` | `hibp-api-key` | يرفض 403 بلا `user-agent` وصفي — يُرسل ثابتاً؛ 401 عند مفتاح خاطئ |
| securitytrails | `api.securitytrails.com/v1/ping` | `APIKEY` | النقطة مخصصة أصلاً لاختبار المصادقة (401 عند مفتاح خاطئ) |
| greynoise | `api.greynoise.io/v3/community/8.8.8.8` | `key` | 401 موثق عند مفتاح خاطئ؛ الاستعلام غير المصادق له مسموح بحصص أدنى — الاختبار يقدم المفتاح فالمصادقة تُفحص |
| binaryedge | `api.binaryedge.io/v2/user/subscription` | `X-Key` | نقطة الاشتراك تعرض صلاحية المفتاح |
| hunter | `api.hunter.io/v1/account` | `X-API-KEY` | نقطة الحساب مجانية وتثبت المفتاح |
| urlscan | `urlscan.io/api/v1/user/searches/` | `API-Key` | نقطة تتطلب مصادقة (401 بلا مفتاح صالح)؛ TR-009 |

## غير قابلين للاختبار (9) — بأسباب موثقة

| المزوّد | السبب |
|---|---|
| shodan | المفتاح في الرابط حصراً (`api-info?key=`) — سياسة D-031/P2-016 تمنع؛ TR-008 |
| etherscan | المفتاح في الرابط حصراً (`apikey` استعلام) — TR-017 |
| whoisxml | المفتاح في الرابط حصراً (`apiKey` استعلام) |
| numverify | المفتاح في الرابط حصراً (`access_key` استعلام) |
| ipgeolocation | المفتاح في الرابط حصراً (`apiKey` استعلام) |
| abuseipdb | لا نقطة اختبار بلا استعلام: `/api/v2/check` يلزمه `ipAddress` في الاستعلام (T-SEC-SSRF-042 يمنع الاستعلام في طلب يحمل سراً) و`/api/v2/blacklist` بلا استعلام تتجاوز استجابته حد حجم بوابة الاختبار |
| clearbit | كل نقاط GET الحاملة للمفتاح تلزم معامِل استعلام (domain/email) ونقاط الإثراء POST (ADR-27/28 يقيدان POST) |
| fullcontact | كل النقاط الحاملة للمفتاح POST (ADR-27/28 يقيدان POST) |
| censys | زوج اعتمادات (API ID + secret عبر HTTP Basic) — يحتاج عقد تخزين للزوج في الخزنة (قرار تصميم يُتبع مع تعدد المفاتيح P2-024) |

## المحوّلات ذات المفاتيح من البيئة (ليست في الخزنة)

TR-023 (Companies House) وTR-025 (OpenSanctions) وTR-040 (OpenSky) تقرأ مفاتيحها من متغيرات بيئة عند المالك (نمط التسليم الموثق) — لا يمر مسار «تم الحفظ» عليها أصلاً؛ سلوكها عند المفتاح الخاطئ مقيس في اختبارات العقد (فشل-مغلق قبل أي نقل بلا مفتاح، و401 يعالَج). TR-028 (EU FSD) رمز كتالوج عام ثابت لا اعتماد مستخدم — خارج النطاق بالتصنيف.

## قيد الإنتاج (معلن)

الخادم على `FAIL_CLOSED_TRANSPORT` بالتصميم (الحد L-05 — قرار الانتقال): لا شبكة حقيقية من الخادم، فناقل اختبار المفاتيح في الإنتاج يبقى معلقاً على قرار المالك (رفع L-05 لهذا المسار أو توجيه اختبار المفاتيح عبر مسار `ir run --network`). المنطق والتغطية مثبتان بناقل محقون في الاختبارات.

## المصادر (تحقق 2026-10-16)

- HIBP API v3 — التوثيق الرسمي: <https://haveibeenpwned.com/API/V3> (ترويسة `hibp-api-key`، `user-agent` إلزامي، 401)
- SecurityTrails — التوثيق الرسمي: <https://docs.securitytrails.com/docs/authentication> و<https://docs.securitytrails.com/reference/ping-old-1> (ترويسة `APIKEY`، نقطة ping لاختبار المصادقة)
- GreyNoise — التوثيق الرسمي: <https://docs.greynoise.io/docs/using-the-greynoise-community-api> (ترويسة `key`، 401)
- BinaryEdge — التوثيق الرسمي: <https://docs.binaryedge.io/> (ترويسة `X-Key`؛ نقطة `/v2/user/subscription`)
- Hunter — التوثيق الرسمي: <https://hunter.io/api-documentation/v1> (ترويسة `X-API-KEY` بديلة عن `api_key` في الاستعلام؛ نقطة `/v1/account`)
- urlscan — التوثيق الرسمي: <https://urlscan.io/docs/api/> (ترويسة `API-Key` حصراً لا أسماء أخرى؛ نقطة `/api/v1/user/searches/` تتطلب مصادقة)
- Shodan — التوثيق الرسمي: <https://developer.shodan.io/api> (`api-info?key=` — مفتاح في الرابط حصراً)
- AbuseIPDB — التوثيق الرسمي: <https://docs.abuseipdb.com/> (ترويسة `Key`؛ `/api/v2/check` يلزمه `ipAddress`)
- Censys — التوثيق الرسمي: <https://docs.censys.com/docs/ls-api> (HTTP Basic بزوج اعتمادات)
- FullContact — التوثيق الرسمي: <https://docs.fullcontact.com/docs/quickstart> (كل النقاط POST بـBearer)
- Clearbit — <https://apis.io/security/clearbit/clearbit-authentication/> (Basic/Bearer؛ النقاط تتطلب معامِلات)
- numverify — <https://docs.apilayer.com/numverify/docs/getting-started> (`access_key` استعلام)
- ipgeolocation — <https://ipgeolocation.io/documentation/ip-location-api.html> (`apiKey` استعلام)
- WhoisXML — نمط `apiKey` في الاستعلام (توثيق الواجهة)
- Etherscan — `apikey` معامِل استعلام في `api.etherscan.io/v2/api`

## قائمة سماح الاستعلام لكل مزوّد (قرار المالك 2026-10-16 — استكمال P2-016)

الحد المعلن L-21 في `docs/DECLARED_LIMITS.md`: طلب حامل سر لا يحمل إلا بارامترات مدوّنة في مدخل المزوّد (`packages/egress/providers/`) — اسم البارامتر + نوع القيمة + طول أقصى معلن — وأي بارامتر خارج القائمة يُرفض فشل-مغلق. مصدر كل بارامتر:

| المزوّد | البارامتر | النوع | الطول الأقصى | المصدر (وثائق المزوّد الرسمية) |
|---|---|---|---|---|
| urlscan | `q` | string | 512 (حدّنا المعلن) | [توثيق urlscan الرسمي](https://urlscan.io/docs/api/) — Search API، GET `/api/v1/search/`: «q — The query term (ElasticSearch Query String Query). Default: `*`». الوثائق لا تعلن حداً أقصى للطول؛ 512 حدّنا المعلن. |

ملاحظتان: (1) الوثائق نفسها تذكر `size` و`search_after` لنقطة البحث — **غير مسموحين** عمداً: TR-009 لا يرسل إلا `q`، والقائمة المحصورة أضيق من سطح المزوّد الموثق بقصد (فشل-مغلق). (2) إضافة بارامتر أو مزوّد = تعديل بيانات السجل في `packages/egress/providers/` مع تحديث هذا الجدول بالمصدر.

## أرصدة المفاتيح وحصصها (P2-024) — مصادر موثقة 2026-10-16

حد المهمة: «عرض الرصيد حيث يدعمه المزوّد، وتنبيه عند 80% من الحصة». الحالات الثلاث صادقة: «غير مدعوم» (غياب موثق) ≠ «لم يُتحقق منه» (تعذر الوصول للمرجع) ≠ «تعذر التحديث» — البيانات المفقودة ليست رصيداً صفرياً.

| المزوّد | الحالة | المصدر والتفصيل |
|---|---|---|
| urlscan | **مدعوم — محسوب النسبة** | [توثيق urlscan الرسمي](https://urlscan.io/docs/api/): ترويسات `X-Rate-Limit-*` على كل استجابة لمورد محدود المعدل — `Limit` = «سقفك لهذا الفعل والنافذة»، `Remaining` = «المتبقي لهذا الفعل والنافذة»، مع `Scope`/`Action`/`Window`/`Reset`. النسبة المئوية وتنبيه 80% يُحسبان منها حصراً (دلالات موثقة). نقطة `/api/v1/quotas` موجودة في [مرجع OpenAPI](https://docs.urlscan.io/apis/urlscan-openapi/generic/getquotas) لكن حقولها الداخلية غير موثقة — لم يُكتب محلل لها بعد. |
| hunter | **مدعوم — قيم خام بلا نسبة** | [توثيق Hunter الرسمي](https://hunter.io/api-documentation/v1#account): استجابة نقطة الحساب تحمل `requests.searches/verifications` (used/available) و`reset_date` — لكن الوثائق لا توضح دلالة `available` (إجمالي الحصة أم المتبقي؛ المثال المعروض used 14260 مع available 10000)، فتُعرض القيم الخام دون نسبة مئوية حتى يُتحقق من الدلالة. |
| virustotal | **لم يُتحقق منه** | [توثيق VT](https://docs.virustotal.com/docs/quota-consumption) يذكر نقطتي `/users/{id}/overall_quotas` و`/users/{id}/api_usage` (لا تستهلكان حصة) — لكن حقول الاستجابة تعذر التحقق منها هذه الدورة (صفحات المرجع تعذر جلبها). ليست «غير مدعوم». |
| binaryedge | **لم يُتحقق منه** | نقطة الاشتراك `/v2/user/subscription` موجودة (مسار اختبارنا) لكن حقول الاستجابة تعذر التحقق منها من الوثائق الرسمية هذه الدورة. |
| haveibeenpwned | **غير مدعوم للرصيد** | [توثيق HIBP](https://haveibeenpwned.com/API/v3#SubscriptionStatus): حالة الاشتراك تعيد معلومات الخطة و`Rpm` — بلا حقول استخدام/رصيد. |
| ipinfo | **غير مدعوم** | [توثيق IPinfo](https://ipinfo.io/developers): لا نقطة استخدام/رصيد (Lite غير محدود؛ المدفوع حد شهري مع 429 ولوحة تنبيهات — لا إبلاغ API). |
| securitytrails | **غير مدعوم** | [توثيق SecurityTrails](https://docs.securitytrails.com/docs/quotas-rate-limits): حصة شهرية مع 429 وتنبيه بريدي — لا نقطة استخدام متبقٍ. |
| greynoise | **غير مدعوم** | [توثيق GreyNoise](https://docs.greynoise.io/docs/using-the-greynoise-community-api): لا نقطة رصيد متبقٍ (حقل rate-limit يظهر في رفض 429 فقط). |

## تعدد المفاتيح للمصدر الواحد (E-05) — حالة التحقق 2026-10-16

التصميم المعتمد (المراجع المستقل): توزيع round-robin حتمي (لا least-used)، أعضاء المجموعة مرتبطون بالمزوّد والحساب صراحةً عبر نمط الإعداد المعتمد (لا استنتاج من لواحق الأسماء)، تثبيت المفتاح للعملية المنطقية مع قراءة قيمته من الخزنة عند كل طلب، لا تبديل بسبب 429 أو فشل مصادقة، ومفاتيح الحساب الواحد ليست حصصاً مستقلة. **التفعيل مشروط بإثبات سماح كل مزوّد — ولم يثبت السماح لأي مزوّد هذه الدورة:**

| المزوّد | حالة E-05 | المصدر |
|---|---|---|
| hunter | **ممنوع صراحة** | [مركز مساعدة Hunter](https://help.hunter.io/en/articles/1893896-how-many-accounts-can-i-create): «Ensure that you only use one account to comply with our TOS» — سياسة حساب واحد، والمفتاح واحد للحساب. |
| urlscan | **غير مثبت** | [شروط urlscan](https://urlscan.io/terms/): «Respect any rate-limit and quotas set in place» و«Bypass any measures urlscan may use to prevent or restrict access» ممنوعان — لا إذن صريح لتجميع مفاتيح؛ استخدام عدة مفاتيح لتوزيع الحمل قد يُعد التفافاً على قيود المعدل. |
| الباقون | **غير مثبت** | لا بند صريح في الشروط يسمح أو يمنع تجميع المفاتيح — والغياب ليس إذناً. |

**النتيجة:** التوزيع الآلي معطَّل لكل المزودين هذه الدورة بسبب E-05 (موثق أعلاه) — ولا تُغلق المهمة بادعاء أن مجموعة معطلة تحقق التوزيع الفعلي.
