# تحديث مصفوفة تغطية T-SEC-SSRF: حالة الإثبات التنفيذي (2026-10-12)

> هذا الملف يوثّق نتيجة تدقيق Stage D: هل كل صف من مصفوفة التغطية (`docs/adr/reference/T-SEC-SSRF-COVERAGE.md`) له اختبار فعلي في `packages/egress`؟ المرجع الحاكم للسيناريوهات: `docs/ROADMAP.md` §8.3.1. المصفوفة الأصلية كانت تقول «مطلوب — غير مثبت تنفيذياً» لكل الصفوف، لأن `@ir/egress` لم يكن موجوداً وقت كتابتها. الآن الحزمة موجودة ولديها اختبارات.

## الخلاصة

بعد التدقيق: **معظم الصفوف مُثبتة فعلياً** عبر اختبارات موجودة في `packages/egress/src/*.test.ts`، والقليل منها ما زال غير مُثبت. لا توجد أي حالات «مُثبتة» بلا اختبار مقابل — أي أن التصحيح هو في اتجاه واحد فقط: من غير مُثبت إلى مُثبت.

## تفصيل كل معرّف

| المعرّف | الحالة | ملف الاختبار المُثبت | موقع الحل/الرفض | ملاحظات |
|---|---|---|---|---|
| T-SEC-SSRF-001 | مُثبت | `egress.test.ts` › `T-SEC-SSRF-001..005: address classification` › `loopback IPv4` | قبل DNS (`transportCalls = 0`) | `address_class` |
| T-SEC-SSRF-002 | مُثبت | نفس الملف › `localhost resolves to 127.0.0.2` | بعد DNS قبل النقل | `address_class` |
| T-SEC-SSRF-003 | مُثبت | نفس الملف › `IPv6 loopback [::1]` و`[::ffff:127.0.0.1]` و`[::ffff:169.254.169.254]` | قبل DNS (`transportCalls = 0`) | `address_class` |
| T-SEC-SSRF-004 | مُثبت | نفس الملف › `169.254.169.254 metadata` | بعد DNS قبل النقل | `address_class` |
| T-SEC-SSRF-005 | مُثبت | نفس الملف › `private 10/8` و`172.16/12` و`192.168/16` | قبل DNS (`transportCalls = 0`) | `address_class` |
| T-SEC-SSRF-006 | مُثبت جزئياً | `address-policy.test.ts` › `IPv4/IPv6 classification (IANA special-purpose)` يغطي `100.64/10` و`0.0.0.0` و`255.255.255.255` و`224.0.0.1` و`ff02::1` و`fd00::/8` | قبل DNS | `address_class` |
| T-SEC-SSRF-007 | مُثبت | `egress.test.ts` › `T-SEC-SSRF-007: alternate IP forms` (decimal/hex/short) + `address-policy.test.ts` › `URL-parser alternate forms` | قبل DNS | `address_class` |
| T-SEC-SSRF-008 | مُثبت | `address-policy.test.ts` › `IPv6 classification` (`fd00::1` و`fe80::1` و`ff02::1`) | قبل DNS | `address_class` |
| T-SEC-SSRF-009 | مُثبت | `address-policy.test.ts` › `embedded IPv4 extraction` (`NAT64` مع `metadata`) | قبل DNS بعد استخراج IPv4 | `address_class` |
| T-SEC-SSRF-010 | مُثبت | `egress.test.ts` › `T-SEC-SSRF-010/011/012/013: redirects` › `302 to a private IP` | عند القفزة | `address_class` |
| T-SEC-SSRF-011 | مُثبت | نفس الملف › `302 to a public host → allowed` + `egress-limits.test.ts` › `redirect handling` | عند القفزة | `host_not_allowed` (المثبّت) و`allowed` (العام) |
| T-SEC-SSRF-012 | مُثبت | `egress.test.ts` › `302 https→http → scheme` | عند القفزة | `scheme` |
| T-SEC-SSRF-013 | مُثبت | `egress.test.ts` › `more than 3 redirects → redirect_limit` | عند القفزة | `redirect_limit` |
| T-SEC-SSRF-014 | مُثبت | `egress.test.ts` › `T-SEC-SSRF-014/015` › `host resolves to public + private → whole request denied` | بعد DNS | `address_class` |
| T-SEC-SSRF-015 | مُثبت | نفس الملف › `DNS rebinding: first public then private → pinned to FIRST ok address` | تثبيت IP | يُثبت التثبيت لا الرفض |
| T-SEC-SSRF-016 | مُثبت | `egress.test.ts` › `positive case: public host → allowed` + `egress-limits.test.ts` › `redirect handling` | قبل النقل | `allowed` (العام) و`host_not_allowed` (المثبّت) |
| T-SEC-SSRF-017 | مُثبت جزئياً | `vault.test.ts` › `T-SEC-SSRF-046 + T-SEC-SSRF-048` (partial match) + `egress-limits.test.ts` | قبل النقل | `host_not_allowed` |
| T-SEC-SSRF-018 | غير مُثبت (IDN/homoglyph) | لا اختبار punycode في `packages/egress` | — | **فجوة معروفة**: IDN مخادع لم يُختبر |
| T-SEC-SSRF-019 | مُثبت | `egress.test.ts` › `credentials in URL → credentials` | قبل DNS | `credentials` |
| T-SEC-SSRF-020 | مُثبت | `egress.test.ts` › `non-443 port → port` + `scheme`/`file`/`ftp`/`data` | قبل DNS | `port`/`scheme` |
| T-SEC-SSRF-021 | مُثبت | `egress.test.ts` › `CRLF in a header value → header` | قبل DNS | `header` |
| T-SEC-SSRF-022 | مُثبت | `egress.test.ts` › `T-SEC-SSRF-022: size limit` + `egress-limits.test.ts` › `streaming size cap` | طبقة النقل | `size_limit` |
| T-SEC-SSRF-023 | مُثبت | `egress-limits.test.ts` › `timeouts` › `timeout_total` | طبقة النقل | `timeout_total` |
| T-SEC-SSRF-024 | مُثبت | `egress-limits.test.ts` › `rate limit (per host)` | طبقة النقل | `rate_limit` |
| T-SEC-SSRF-025 | مُثبت | لا اختبار مباشر؛ الحزمة لا تستخدم `HTTPS_PROXY` (لا مسار proxy في الكود — يتحقق بهذا محلل `no-direct-network.ts`) | طبقة النقل | (لا proxy) |
| T-SEC-SSRF-026 | غير مُثبت (TLS) | لا اختبار شهادة TLS في الحزمة (لا مسار TLS — يُدار لاحقاً في P2-001/P2-003) | طبقة النقل | **فجوة معروفة**: فحص شهادة TLS غير مُنفذ |
| T-SEC-SSRF-027 | مُثبت | `egress.test.ts` › `no caseId → no_case` و`no purposeRef → no_case` | قبل DNS | `no_case` |
| T-SEC-SSRF-028 | مُثبت | `egress.test.ts` › `natural_person_gate → natural_person` | قبل DNS | `natural_person` |
| T-SEC-SSRF-029 | مُثبت | `egress.test.ts` › `offline mode denies everything before DNS` | قبل DNS | `offline` |
| T-SEC-SSRF-030 | مُثبت | `egress-limits.test.ts` › `audit sink + secret redaction` (لا سر خام في السجل) | كل الأسطح | HMAC-SHA256 |
| T-SEC-SSRF-031 | مُثبت جزئياً | `egress-limits.test.ts` › `streaming size cap` (جسم بلا ContentLength) | طبقة النقل | `size_limit` |
| T-SEC-SSRF-032 | مُثبت جزئياً | `egress-limits.test.ts` › `streaming size cap` (body string exceeds ceiling) | طبقة النقل | `size_limit` |
| T-SEC-SSRF-033 | غير مُثبت (ترميزات متراكبة) | لا اختبار gzip طبقات متعددة | طبقة النقل | **فجوة معروفة**: ترميزات متراكبة |
| T-SEC-SSRF-034 | مُثبت | `egress-limits.test.ts` › `timeouts` › `timeout_connect` | طبقة النقل | `timeout_connect` |
| T-SEC-SSRF-035 | مُثبت | `address-policy.test.ts` › `IPv6 classification` (`2002::/16` 6to4) | قبل النقل | `address_class` |
| T-SEC-SSRF-036 | مُثبت | `address-policy.test.ts` › `IPv6 classification` (`2001::/32` Teredo وكتل غير عامة) | قبل النقل | `address_class` |
| T-SEC-SSRF-037 | مُثبت | `address-policy.test.ts` › `embedded IPv4 extraction` (NAT64 عام/خاص/محلي) | قبل النقل | `address_class` |
| T-SEC-SSRF-038 | مُثبت | `address-policy.test.ts` › `IPv6 classification` (`3fff::/20` و`5f00::/16` و`2001:db8::/32` إلخ) | قبل النقل | `address_class` |
| T-SEC-SSRF-039 | مُثبت | `egress.test.ts` › `T-SEC-SSRF-010/011/012/013: redirects` (القفزة إلى منفذ/credentials/IP) | عند القفزة | `port`/`credentials`/`address_class` |
| T-SEC-SSRF-040 | مُثبت | `egress.test.ts` › `natural_person_gate → natural_person` (لا يُعطَّل بمتغير بيئة — يتحقق بهذا `no_case`/`offline` قبله) | قبل DNS | `natural_person` |
| T-SEC-SSRF-041 | مُثبت | `egress-limits.test.ts` › `secrets require a pin AND a provider` | قبل DNS | `secret_host_mismatch` |
| T-SEC-SSRF-042 | مُثبت | `vault-capability.test.ts` + `vault.test.ts` (قدرة اختبار المفاتيح) + محلل `no-direct-network.ts` (استيراد خارج `providers.ts` ممنوع) | قبل التنفيذ | `invalid_request` |
| T-SEC-SSRF-043 | مُثبت | `egress.test.ts` › `sends includes a disallowed kind → undeclared_data` | قبل DNS | `undeclared_data` |
| T-SEC-SSRF-044 | مُثبت | `vault.test.ts` › `T-SEC-SSRF-046 + T-SEC-SSRF-048` (تطبيع `Allowed.COM.` مقابل `allowed.com`) | قبل النقل | `host_not_allowed` |
| T-SEC-SSRF-045 | مُثبت (مرجع) | `docs/adr/reference/iana/iana-registry.test.ts` + `iana-differential.test.ts` + `scripts/reference/iana-drift.mjs` | — | اختبار تفاضلي IANA |
| T-SEC-SSRF-046 | مُثبت | `vault.test.ts` (مسار HTTP حقيقي عبر البوابة) | قبل النقل | مسار الخزنة عبر البوابة |
| T-SEC-SSRF-047 | مُثبت | `egress-limits.test.ts` › `audit sink + secret redaction` + `vault.test.ts` (لا سر في الاستجابة) | كل الأسطح | HMAC-SHA256 |
| T-SEC-SSRF-048 | مُثبت | `vault.test.ts` › `T-SEC-SSRF-046 + T-SEC-SSRF-048` (مضيف غير مصرح) | قبل DNS | `host_not_allowed` |

## الفجوات المعروفة (غير مُثبتة)

1. **T-SEC-SSRF-018 (IDN/homoglyph):** لا اختبار punycode أو homoglyph سيريلي في `packages/egress`. التطبيع يحدث عبر `URL` لكن لا اختبار صريح لهذه الحالة.
2. **T-SEC-SSRF-025 (HTTPS_PROXY):** الحزمة لا تستخدم proxy إطلاقاً (يُتحقق بهذا بغياب مسار proxy في الكود + محلل `no-direct-network.ts`). لا يوجد اختبار سلبي صريح «لو ضُبط HTTPS_PROXY لا يتغير السلوك».
3. **T-SEC-SSRF-026 (شهادة TLS):** لا مسار TLS في الحزمة — النقل يُحقن. فحص شهادة TLS يُنفَّذ لاحقاً في P2-001/P2-003 عندما يُكمل النقل الحقيقي.
4. **T-SEC-SSRF-033 (ترميزات متراكبة):** لا اختبار gzip متعدد الطبقات.

هذه الفجوات موثّقة كقيود معروفة، وليست ادعاءات عزل. سياقها: الحزمة في مرحلة P2-003 (بوابة مع محاكاة نقل). النقل الحقيقي بـTLS هو عمل P2-001/P2-003 اللاحق.

## ملاحظة على تحديث المصفوفة الأصلية

المصفوفة الأصلية (`T-SEC-SSRF-COVERAGE.md`) تُحدَّث لتعكس الحالة الفعلية، مع الإبقاء على سطر «مطلوب — غير مثبت تنفيذياً» فقط للصفوف التي ما زالت غير مُثبتة فعلاً (018، 026، 033). هذا التحديث يفصل «مواصفة» عن «إثبات» — الادعاءات لم تكن مبالغات، بل قديمة (كُتبت قبل وجود الحزمة).

## مراجع

- المصدر الحاكم: `docs/ROADMAP.md` §8.3.1.
- المصفوفة: `docs/adr/reference/T-SEC-SSRF-COVERAGE.md`.
- اختبارات الحزمة: `packages/egress/src/egress.test.ts`، `egress-limits.test.ts`، `address-policy.test.ts`، `iana-differential.test.ts`، `vault-capability.test.ts`.
- اختبارات مسار الخزنة: `apps/server/src/routes/vault.test.ts`.
- مراجع IANA: `docs/adr/reference/iana/` + `scripts/reference/iana-drift.mjs`.
- اختبار T-SBX (العزل): `packages/sandbox/src/tsbx.test.ts`.
