# مراجعة التراخيص للاعتماديات والمصادر — P6-014

**التاريخ:** 2026-10-24 — **المهمة:** P6-014 — **التوقيع:** قائد الهندسة التنفيذية بتكليف المالك (الجلسة الحالية). معيار القبول: لا تعارض مع AGPL-3.0-or-later (ADR-10). الحارس: `scripts/governance/licenses.test.mjs` (T-LIC-001..003) في CI و`governance:test`.

## النطاق والمنهجية

- **الاعتماديات:** كل عائلة ترخيص في الشجرة المثبتة تُستخرج بـ `pnpm licenses list --json` من القفل المجمّد (نفس ما يفعله الحارس في CI) — لا تعدّ يدوي. أي عائلة جديدة بلا صف حكم هنا يُرفضها الحارس فاشلاً مغلقاً.
- **المصادر:** كل نقطة نهاية خارجية يستطيع النظام الوصول إليها — سجل مزوّدي المفاتيح (`packages/egress/providers/*.ts`، حقول `hosts`) وقائمة `connect-src` في CSP (`apps/server/src/app.ts`) — موثقة أدناه بحدودها (D-048).
- **معيار التوافق:** ترخيص التوزيع هو AGPL-3.0-or-later. المتوافق: التراخيص المتساهلة (MIT/BSD/ISC/Apache-2.0/0BSD/Unlicense/CC0/BlueOak) والمتروكة للملف (MPL-2.0) والبيانات المفتوحة (CC-BY-4.0/OFL-1.1) والمزدوجة بخيار متساهل. الممنوع صراحة: GPL-2.0-only، CC-BY-NC، التراخيص الملكية/UNLICENSED، BSD-4-Clause، JSON، SSPL، QPL، Sleepycat.
- **حد معلن:** مراجعة الشروط القانونية للمصادر الخارجية مراجعة قانونية مستقلة هي P7-008؛ هذا التقرير يثبت الحدود الهندسية المفروضة ومرجع الشروط، لا بديلاً عنها.

## جدول تراخيص الاعتماديات

| الترخيص | العائدة | الحكم مع AGPL-3.0 | ملاحظة |
|---|---|---|---|
| MIT | الأغلبية (340+) | متوافق | متساهل قياسي |
| MIT-0 | csstools | متوافق | MIT بلا إشعار |
| Apache-2.0 | typescript، playwright، drizzle… | متوافق | متساهل مع بند براءات |
| ISC | d3، maplibre… | متوافق | متساهل |
| BSD-2-Clause | mapbox، espree… | متوافق | متساهل |
| BSD-3-Clause | maplibre-gl، qs… | متوافق | متساهل |
| 0BSD | tslib | متوافق | متساهل |
| Unlicense | wouter | متوافق | تنازل عام |
| BlueOak-1.0.0 | lru-cache، minimatch، sax | متوافق | متساهل حديث |
| CC0-1.0 | mdn-data | متوافق | تنازل عام (بيانات) |
| (MIT OR CC0-1.0) | type-fest | متوافق | خيار متساهل |
| (MIT AND Zlib) | pako | متوافق | كلاهما متساهل |
| MIT AND ISC | victory-vendor | متوافق | كلاهما متساهل |
| (MIT OR Apache-2.0) | @maplibre/mlt | متوافق | خيار متساهل |
| (MIT OR GPL-3.0-or-later) | jszip | متوافق | نعتمد خيار MIT |
| (MPL-2.0 OR Apache-2.0) | dompurify | متوافق | خيار متساهل |
| MPL-2.0 | resvg، axe-core، exifreader، lightningcss | متوافق | متروكة للملف — متوافقة مع GPLv3/AGPL |
| Python-2.0 | argparse | متوافق | رخصة PSF متوافقة مع GPL |
| CC-BY-4.0 | caniuse-lite | متوافق | بيانات بإسناد — ليست كوداً |
| OFL-1.1 | @fontsource-variable/noto-sans-arabic | متوافق | خطوط (استخدام/توزيع مقيد بالخط نفسه لا البرنامج) |

**لا توجد حزم بترخيص ممنوع، ولا حزم ملكية، ولا NONE في الشجرة المثبتة.** الحارس يفحص الشجرة الفعلية عند كل تشغيل — أي انحدار مستقبلي (اعتمادية GPL-2.0-only مثلاً) يكسر CI.

## المصادر الخارجية (D-048)

### مزوّدو المفاتيح (سجل ADR-08 §7 — مفتاح في ترويسة فقط، مسارات مغلقة)

| المصدر | المضيف | ما يصل إليه | الحدود المفروضة (قابلة للتحقق) | الشروط |
|---|---|---|---|---|
| urlscan | urlscan.io | استعلام بحث عام | مسار /api/v1/search/ فقط، استعلام q بحد 512، مفتاح في ترويسة api-key (T-SEC-SSRF-042) | شروط urlscan.io — مراجعة P7-008 |
| abusech (ThreatFox) | threatfox-api.abuse.ch | مؤشرات تهديد | سجل مزوّد مغلق + ميزانيات البوابة (ADR-08) | شروط abuse.ch — مراجعة P7-008 |
| abuseipdb | api.abuseipdb.com | سمعة عناوين | سجل مزوّد مغلق + ميزانيات | شروط abuseipdb.com — مراجعة P7-008 |
| brave | api.search.brave.com | بحث ويب | سجل مزوّد مغلق + ميزانيات | شروط brave.com — مراجعة P7-008 |
| censys | search.censys.io | مسح إنترنت | زوج اعتماد (Basic) لا في URL (TR-049) | شروط censys.io — مراجعة P7-008 |
| greynoise | api.greynoise.io | ضوضاء إنترنت | سجل مزوّد مغلق + ميزانيات | شروط greynoise.io — مراجعة P7-008 |
| hunter | api.hunter.io | بريدات عامة | سجل مزوّد مغلق + ميزانيات | شروط hunter.io — مراجعة P7-008 |
| otx | otx.alienvault.com | مؤشرات تهديد | سجل مزوّد مغلق + ميزانيات | شروط alienvault — مراجعة P7-008 |
| securitytrails | api.securitytrails.com | بيانات نطاقات | قوالب مسارات مغلقة (P2-026) | شروط securitytrails.com — مراجعة P7-008 |
| virustotal | www.virustotal.com | تحليل ملفات/روابط | قوالب مسارات مغلقة (P2-026) | شروط virustotal.com — مراجعة P7-008 |

مزوّدو shodan وetherscan (المفتاح في معامل URL فقط) **بلا سجل** — طلباتهم المفتاحية مرفوضة صراحة (D-031/P2-016، docs/security/KEY_TESTS.md).

### مصادر المتصفح المباشرة (connect-src في CSP)

| المصدر | المضيف | الغرض | الحدود | الشروط |
|---|---|---|---|---|
| Google DNS | https://dns.google | استعلام DNS من الواجهة | قراءة فقط، بلا مفتاح | شروط dns.google — مراجعة P7-008 |
| GitHub API | https://api.github.com | بيانات مستودعات عامة | قراءة فقط، بلا مفتاح | شروط github.com — مراجعة P7-008 |
| Blockchain | https://blockchain.info | عناوين معاملات عامة | قراءة فقط | شروط blockchain.com — مراجعة P7-008 |
| Etherscan | https://api.etherscan.io | عناوين سلسلة عامة | قراءة فقط | شروط etherscan.io — مراجعة P7-008 |
| MAC Vendors | https://api.macvendors.com | بحث بصمة MAC | قراءة فقط، بلا مفتاح | شروط macvendors.com — مراجعة P7-008 |

وإطارات العرض: `www.youtube.com` و`www.openstreetmap.org` (frame-src) — محتوى مضمن لا يُرسل إليه بيانات قضية.

كل جلب شبكي للخادم يمر عبر بوابة الخروج بغرض معلن وميزانيات لكل مصدر (ADR-08) — الحدود أعلاه مطبقة مركزياً في `packages/egress` ومختبرة في `packages/egress/src/production.test.ts`.

## الخلاصة

**لا تعارض مع AGPL-3.0-or-later**: كل عائلات تراخيص الاعتماديات (20 عائلة) متوافقة أو مزدوجة بخيار متوافق، ولا مصدر خارجي بشرط يمنع الاستخدام (الحدود الهندسية مفروضة وموثقة؛ المراجعة القانونية المستقلة للشروط هي P7-008 بحسب الخارطة). أي اعتمادية أو مصدر جديد لا يظهر هنا يُرفض فاشلاً مغلقاً بالحارس T-LIC-002/T-LIC-003.
