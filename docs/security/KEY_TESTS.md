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
