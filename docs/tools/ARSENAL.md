# ترسانة الأدوات والقدرات

> مُولَّد آلياً بواسطة `tools/catalog/arsenal.py` من `tools/catalog/arsenal.json` والكتالوج والخارطة. لا تحرّر هذا الملف يدوياً.

خريطة القدرات التي أرفقها المالك (PR #9، «ترسانة الأدوات والقدرات»)، مرتبة حسب الاختصاص في طبقات: العيون (الرصد والجمع)، والأذرع (التحليل)، والأرجل (الوصول)، والأجنحة (التوسع والتشغيل)، ثم الأدوات المتخصصة.
لكل أداة: موقعها في الكتالوج (`TL-…`)، وموقعها في الخارطة (`TR-…` محوّل أو `Pn-nnn` مهمة) إن وُجد، وحالتها. النص الأصلي محفوظ في `docs/archive/ROADMAP2-arsenal-original-2026-10-10.md`، والقرارات في القسم 14.8 من الخارطة.

## الملخص

| الحالة | المعنى | عدد الأدوات الفريدة |
|---|---|---|
| في الخارطة | لها محوّل أو مهمة في الخارطة | 106 |
| مكدس المشروع | جزء من مكدس بناء المشروع نفسه | 27 |
| في الكتالوج | في الكتالوج، تنتظر محوّلاً | 220 |
| مرشح | مذكورة في الترسانة فقط (بلا رابط موثق بعد) | 151 |
| متوقف | متوقفة أو أُعيدت تسميتها | 8 |
| مستبعد | مستبعدة بقواعد المنتج E-01..E-10 | 8 |
| **المجموع** | | **520** |

## الفهرس

- العيون: الرصد والجمع: [1.1](#11-محركات-البحث-العامة-والمتخصصة)، [1.2](#12-قواعد-وأدوات-الـ-dorking)، [2](#2-محركات-البحث-عن-الأشخاص-والأسماء)، [3](#3-محركات-البحث-عن-البريد-الإلكتروني)، [4](#4-محركات-البحث-عن-الهاتف)، [5](#5-محركات-البحث-عن-النطاقات-وdns)، [6](#6-محركات-البحث-عن-عناوين-ip-والشبكات)، [7](#7-محركات-البحث-عن-التهديدات-والسمعة)، [8](#8-محركات-البحث-عن-العملات-الرقمية)، [9](#9-محركات-البحث-عن-الشركات-والسجلات)، [10](#10-محركات-البحث-عن-الصور-والوسائط)، [11](#11-محركات-البحث-عن-الأصول-التاريخية)، [12](#12-محركات-البحث-عن-وسائل-التواصل)، [13](#13-محركات-البحث-عن-الطائرات-والسفن)، [14](#14-محركات-البحث-في-الويب-المظلم)، [15](#15-محركات-البحث-عن-البيانات-الحكومية-والمفتوحة)، [16](#16-محركات-البحث-عن-الملفات-والوثائق)
- الأذرع: التحليل والمعالجة: [17](#17-تحليل-البيانات-الوصفية-metadata-analysis)، [18](#18-تحليل-الصور-والوسائط)، [19](#19-التحليل-الجغرافي-geolocation--mapping)، [20](#20-تحليل-الشبكات-والروابط-link-analysis)، [21](#21-تحليل-البيانات-الكبيرة-والاستعلام)، [22](#22-تحليل-النصوص-واللغة)، [23](#23-تحليل-الهوية-والكيانات-entity-resolution)، [24](#24-تحليل-التهديدات-والأمن-السيبراني)، [25](#25-تحليل-الطب-الشرعي-الرقمي-dfir)، [26](#26-تحليل-العملات-الرقمية-المتقدمة)، [27](#27-تحليل-البيانات-المالية)
- الأرجل: الوصول والتنقل: [28](#28-المتصفحات-وأدوات-التصفح)، [29](#29-أدوات-البروكسي-والخصوصية)، [30](#30-أدوات-سطر-الأوامر)، [31](#31-أدوات-جمع-البيانات-الآلي)، [32](#32-أدوات-تحليل-الشبكات-الاجتماعية)
- الأجنحة: التوسع والنشر والتشغيل: [33](#33-أطر-عمل-الذكاء-الاصطناعي)، [34](#34-أدوات-mcp-model-context-protocol)، [35](#35-منصات-النشر-والتشغيل)، [36](#36-قواعد-البيانات-ومخازن-البيانات)، [37](#37-أدوات-المراقبة-والقياس)، [38](#38-أدوات-الأتمتة-والتنسيق)، [39](#39-أدوات-التصور-والتقارير)، [40](#40-أدوات-التكامل-والتشغيل-البيني)
- أدوات متخصصة ومتقدمة: [41](#41-أدوات-sdr-software-defined-radio)، [42](#42-أدوات-التحليل-الجنائي-للهواتف)، [43](#43-أدوات-تحليل-الشيفرة-العكسية)، [44](#44-أدوات-تحليل-البرمجيات-الخبيثة)، [45](#45-أدوات-تحليل-الشبكات-المتقدمة)، [46](#46-أدوات-تحليل-السجلات)
- الحماية والخصوصية: [47](#47-أدوات-التشفير)، [48](#48-أدوات-إدارة-الأسرار)، [49](#49-أدوات-الخصوصية)
- الذكاء الاصطناعي: [50](#50-نماذج-llm-للتشغيل-المحلي)، [52](#52-أدوات-rag-retrieval-augmented-generation)، [53](#53-أدوات-تحليل-المشاعر-والتصنيف)، [54](#54-أدوات-تحليل-الصور-بالذكاء-الاصطناعي)
- الإدارة والتعاون: [55](#55-أدوات-إدارة-الحالة-والقضايا)، [56](#56-أدوات-التعاون)، [57](#57-أدوات-التوثيق-والمعرفة)، [58](#58-أدوات-إدارة-المهام)
- تحليلات متخصصة إضافية: [59](#59-أدوات-تحليل-البريد-الإلكتروني)، [60](#60-أدوات-تحليل-الهاتف)، [61](#61-أدوات-تحليل-النطاقات)، [62](#62-أدوات-تحليل-ip)، [63](#63-أدوات-تحليل-الثغرات)، [64](#64-أدوات-الاستجابة-للحوادث)، [65](#65-أدوات-soar-security-orchestration-automation-and-response)

## العيون: الرصد والجمع

### 1.1 محركات البحث العامة والمتخصصة

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| Google Search | أكبر محرك بحث، يدعم Google Dorks المتقدمة | مجاني | — | متوقف | لا واجهة بحث عامة مجانية: Custom Search JSON API مغلقة أمام العملاء الجدد (14.4)؛ يبقى فتح الاستعلام يدوياً (TR-033) ([مصدر](https://developers.google.com/custom-search/v1/overview)) |
| Bing Search | محرك بحث ثانٍ، واجهة بحث متقدمة | مجاني | — | متوقف | واجهات Bing للبحث أُوقفت في 2025-08-11 ([مصدر](https://learn.microsoft.com/en-us/lifecycle/announcements/bing-search-api-retirement)) |
| [DuckDuckGo](https://duckduckgo.com/) | محرك بحث يركز على الخصوصية | مجاني | TL-dea05d82 | في الكتالوج | — |
| Yandex Search | محرك بحث روسي، بحث عكسي قوي للصور | مجاني | — | مرشح | — |
| [Baidu](https://www.baidu.com/) | محرك بحث صيني، مفيد للأصول الصينية | مجاني | TL-3774fcd9 | في الكتالوج | — |
| Brave Search | محرك بحث مستقل بفهرسة خاصة | مجاني | — | في الخارطة | TR-053 |
| [Startpage](https://www.startpage.com/) | نتائج Google مع خصوصية | مجاني | TL-0d7fd716 | في الكتالوج | — |
| [Mojeek](https://mojeek.com/) | محرك بحث مستقل تماماً | مجاني | TL-783fe1f3 | في الخارطة | TR-081 |
| [Marginalia Search](https://search.marginalia.nu/) | يبحث في الويب غير التجاري | مجاني | TL-261d1592 | في الخارطة | TR-081 |

### 1.2 قواعد وأدوات الـ Dorking

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| Google Hacking Database (GHDB | كتالوج من Exploit-DB لاستعلامات Dork | مفتوح | — | مرشح | — |
| [DorkSearch](https://www.dorksearch.com/) | منشئ ومكتبة Dorks | مجاني | TL-fe352fd9 | في الكتالوج | — |
| dorkhound | يولّد 340+ استعلام Dork في 25 فئة | مفتوح | — | مرشح | — |
| OSINT Framework | دليل تفاعلي لأدوات OSINT | مجاني | — | مرشح | — |

### 2 محركات البحث عن الأشخاص والأسماء

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| [WhatsMyName](https://github.com/WebBreacher/WhatsMyName) | بحث عن أسماء المستخدمين في مئات المواقع | مفتوح | TL-23ab8de7 | في الكتالوج | — |
| [Sherlock](https://github.com/sherlock-project/sherlock) | بحث عن أسماء المستخدمين في 400+ منصة | مفتوح | TL-318e2d1a | في الخارطة | TR-039 |
| [Maigret](https://github.com/soxoj/maigret) | بحث في 3000+ موقع مع بيانات الملف الشخصي | مفتوح | TL-2ebe8201 | في الكتالوج | — |
| [Blackbird](https://github.com/p1ngul1n0/blackbird) | بحث في 700+ موقع من قائمة WhatsMyName | مفتوح | TL-555b4954 | في الكتالوج | — |
| [Holehe](https://github.com/megadose/holehe) | التحقق من تسجيل البريد في 120+ موقع قد يلامس خطوطاً رمادية | حساس، مفتوح | TL-f8349c83 | مستبعد | يستنتج الحسابات بإساءة استعمال مسارات التسجيل لدى أطراف ثالثة وقد ينبّه صاحبها (14.7) |
| [GHunt](https://github.com/mxrch/GHunt) | OSINT من حساب Google يتطلب تسجيل دخول | حساس، مفتوح | TL-1c664653 | مستبعد | يتطلب جلسة Google ويستهدف حساب شخص (14.7) |
| [Namechk](https://namechk.com/) | التحقق من توفر اسم المستخدم | مجاني | TL-5ba24bbd | في الكتالوج | — |
| [Social Analyzer](https://github.com/qeeqbox/social-analyzer) | تحليل ملفات شخصية عبر منصات | مفتوح | TL-9c1dc66c | في الكتالوج | — |
| Stalkie | أسماء مستخدمين في 13+ منصة مع تقييم ثقة | مفتوح | — | مرشح | — |
| Canopy | كشف البصمة الرقمية عبر منصات | مفتوح | — | مرشح | — |

### 3 محركات البحث عن البريد الإلكتروني

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| [Hunter.io](https://hunter.io/) | البحث عن بريد بالاسم/النطاق والتحقق | مجاني | TL-fb0a6404 | في الكتالوج | — |
| [Emailrep.io](https://emailrep.io/) | سمعة البريد الإلكتروني | مجاني | TL-ca47d6e2 | في الكتالوج | — |
| [Have I Been Pwned](https://haveibeenpwned.com/) | التحقق من تسريبات البريد يحتاج موافقة صاحب البريد | حساس، مجاني | TL-86dfec61 | في الكتالوج | — |
| Firefox Monitor | مراقبة تسريبات البريد | مجاني | — | متوقف | صار اسمه Mozilla Monitor ويعتمد بيانات HIBP (مغطّى في TR-038) ([مصدر](https://support.mozilla.org/en-US/kb/mozilla-monitor-faq)) |
| [DeHashed](https://dehashed.com/) | بحث في التسريبات يتطلب تبرير قانوني | حساس، مدفوع | TL-ee7479dc | مستبعد | بحث في بيانات اعتماد مسربة لأشخاص (E-03) |
| [LeakCheck](https://leakcheck.io/) | بحث في التسريبات يتطلب تبرير قانوني | حساس، مدفوع | TL-23cff676 | مستبعد | بحث في بيانات اعتماد مسربة لأشخاص (E-03) |
| [Intelligence X](https://intelx.io/) | محرك بحث في التسريبات والويب المظلم يتطلب تبرير قانوني | حساس، مدفوع | TL-76a41d31 | في الكتالوج | — |
| [Hudson Rock Cavalier](https://cavalier.hudsonrock.com/) | كشف اختراق أجهزة عبر معلومات مسربة | مجاني | TL-6c7617dc | في الخارطة | TR-082 |
| [XposedOrNot](https://xposedornot.com/) | التحقق من التسريبات | مجاني | TL-3857e3f5 | في الخارطة | TR-083 |

### 4 محركات البحث عن الهاتف

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| [PhoneInfoga](https://github.com/sundowndev/PhoneInfoga) | تحليل الهاتف: البلد، المزود، البحث | مفتوح | TL-27f63d61 | في الكتالوج | — |
| [Numverify](https://numverify.com?utm_source=Github&utm_medium=Referral&utm_campaign=Public-apis-repo-Best-sellers) | التحقق من الهاتف | مجاني | TL-2c455238 | في الكتالوج | — |
| AbstractAPI Phone Validation | التحقق من الهاتف | مجاني | — | مرشح | — |
| [Twilio Lookup](https://www.twilio.com/lookup) | معلومات الهاتف الرسمية | مدفوع | TL-42abb54f | في الكتالوج | — |
| [Truecaller](https://www.truecaller.com/) | تعريف المتصل بيانات مستخدمين، حذر أخلاقي | حساس، مجاني | TL-f8f18d7c | مستبعد | كشف هوية أصحاب الأرقام من دفاتر عناوين المستخدمين (E-03) |
| [libphonenumber](https://github.com/google/libphonenumber) | مكتبة Google لتحليل الأرقام | مفتوح | TL-97e7d609 | في الخارطة | TR-036 |

### 5 محركات البحث عن النطاقات وDNS

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| [SecurityTrails](https://securitytrails.com/) | DNS تاريخي، WHOIS، نطاقات فرعية | مجاني | TL-9cf5c0d2 | في الخارطة | TR-048 |
| [WhoisXML API](https://whois-history.whoisxmlapi.com/) | WHOIS وDNS | مدفوع | TL-3855648d | في الخارطة | TR-050 |
| [WhoisFreaks](https://whoisfreaks.com/) | WHOIS وبيانات تاريخية | مدفوع | TL-d7d47152 | في الخارطة | TR-050 |
| [ViewDNS.info](https://viewdns.info/) | أدوات DNS وWHOIS متعددة | مجاني | TL-c7d9f3cc | في الكتالوج | — |
| [DNSdumpster](https://dnsdumpster.com/) | اكتشاف نطاقات فرعية | مجاني | TL-9e6bda87 | في الكتالوج | — |
| [crt.sh](https://crt.sh/?) | سجل شهادات TLS (Certificate Transparency) | مجاني | TL-18a2d7b5 | في الخارطة | P2-037، TR-004 |
| [CIRCL Passive DNS](https://www.circl.lu/services/passive-dns/) | DNS السلبي | مجاني | TL-458dc021 | في الخارطة | TR-072 |
| [Robtex](https://robtex.com/) | تحليل DNS وIP | مجاني | TL-64ba0f7c | في الخارطة | TR-073 |
| [Amass](https://github.com/owasp-amass/amass) | اكتشاف سطح الهجوم، نطاقات فرعية | مفتوح | TL-37c02af1 | في الخارطة | P8-024، TR-079 |
| [Subfinder](https://github.com/projectdiscovery/subfinder) | اكتشاف نطاقات فرعية سريع | مفتوح | TL-32d063d2 | في الكتالوج | — |
| [Sublist3r](https://github.com/aboul3la/Sublist3r) | اكتشاف نطاقات فرعية | مفتوح | TL-e8f0dea8 | في الكتالوج | — |
| [Findomain](https://github.com/Findomain/Findomain) | اكتشاف نطاقات فرعية | مفتوح | TL-ce3268a4 | في الخارطة | TR-079 |
| [dnsx](https://github.com/projectdiscovery/dnsx) | مجموعة أدوات DNS | مفتوح | TL-5fd295f5 | في الكتالوج | — |
| [MassDNS](https://github.com/blechschmidt/massdns) | DNS سريع | مفتوح | TL-a0b1a4dd | في الكتالوج | — |
| [dnstwist](https://dnstwist.it/) | كشف النطاقات المشابهة (typosquatting) | مفتوح | TL-34991975 | في الكتالوج | — |
| [dnsrecon](https://github.com/darkoperator/dnsrecon) | استطلاع DNS | مفتوح | TL-bce1b82e | في الكتالوج | — |

### 6 محركات البحث عن عناوين IP والشبكات

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| [Shodan](https://www.shodan.io/) | محرك بحث الأجهزة المتصلة بالإنترنت | مجاني | TL-0cba9f15 | في الخارطة | TR-008، TR-054 |
| [Censys](https://censys.io/) | محرك بحث الإنترنت والأصول الرقمية | مجاني | TL-96019d2b | في الخارطة | TR-049 |
| [BinaryEdge](https://docs.binaryedge.io/api-v2.html) | بيانات استطلاع الإنترنت | مدفوع | TL-07aecd34 | متوقف | متوقف (14.4) ([مصدر](https://help.coalitioninc.com/hc/en-us/articles/34383910057371-BinaryEdge-Transition-FAQ)) |
| [Onyphe](https://www.onyphe.io/) | استطلاع الإنترنت | مجاني | TL-04ec7fa8 | في الخارطة | TR-055 |
| [Netlas](https://netlas.io/) | محرك بحث الإنترنت | مجاني | TL-6a89c3ac | في الخارطة | TR-056 |
| [ZoomEye](https://www.zoomeye.ai/) | محرك بحث صيني للإنترنت | مجاني | TL-22a3cff9 | في الخارطة | TR-060 |
| [Fofa](https://en.fofa.info/) | محرك بحث صيني | مجاني | TL-b70060b7 | في الخارطة | TR-060 |
| [CriminalIP](https://www.criminalip.io/) | محرك بحث الأمن السيبراني | مجاني | TL-9971cd74 | في الكتالوج | — |
| [LeakIX](https://leakix.net/) | كشف الخدمات المكشوفة | مجاني | TL-12c855ff | في الخارطة | TR-058 |
| [GreyNoise](https://docs.greynoise.io/reference/getcommunityip) | تحليل ضوضاء الإنترنت | مجاني | TL-c486114a | في الخارطة | TR-045 |
| [Shodan InternetDB](https://internetdb.shodan.io/) | بيانات Shodan مجانية | مجاني | TL-1095d275 | في الخارطة | TR-054 |
| [IPinfo](https://ipinfo.io/) | معلومات IP: ASN، الموقع، المزود | مجاني | TL-9c90fd6a | في الخارطة | TR-007 |
| [IPGeolocation](https://www.abstractapi.com/ip-geolocation-api) | تحديد الموقع الجغرافي | مجاني | TL-8943c4a6 | في الكتالوج | — |
| [MaxMind](https://www.maxmind.com/en/home) | قواعد بيانات IP | مدفوع | TL-a83c923a | في الكتالوج | — |
| [IP2Location](https://www.ip2location.com/) | تحديد الموقع | مدفوع | TL-f89ed296 | في الكتالوج | — |
| [BGPView](https://bgpview.io/) | معلومات BGP وASN | مجاني | TL-f2cd614b | في الكتالوج | — |
| [RIPEstat](https://stat.ripe.net/) | إحصاءات RIPE | مجاني | TL-204227a7 | في الخارطة | TR-005 |
| [Hurricane Electric BGP](https://bgp.he.net/) | أدوات BGP | مجاني | TL-b7e964ca | في الخارطة | TR-071 |
| [PeeringDB](https://www.peeringdb.com/advanced_search) | بيانات التصيير | مجاني | TL-451fbd29 | في الخارطة | TR-071 |
| [bgp.tools](https://bgp.tools/) | أدوات BGP | مجاني | TL-e61ff1ef | في الكتالوج | — |

### 7 محركات البحث عن التهديدات والسمعة

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| [VirusTotal](https://www.virustotal.com/gui/) | تحليل الملفات والروابط والعناوين | مجاني | TL-0eabcdf6 | في الخارطة | TR-043 |
| [AbuseIPDB](https://www.abuseipdb.com/) | قاعدة بيانات إساءة IP | مجاني | TL-16535933 | في الخارطة | TR-044 |
| [ThreatFox](https://threatfox.abuse.ch/browse/) | مؤشرات التهديد من abuse.ch | مفتوح | TL-f4258b59 | في الخارطة | TR-047 |
| [URLhaus](https://urlhaus-api.abuse.ch/) | قواعد بيانات URLs الخبيثة | مفتوح | TL-0e564783 | في الخارطة | TR-047 |
| [MalwareBazaar](https://bazaar.abuse.ch/browse/) | قاعدة بيانات البرمجيات الخبيثة | مفتوح | TL-2196d401 | في الخارطة | TR-047 |
| [Feodo Tracker](https://feodotracker.abuse.ch/) | تتبع C2 | مفتوح | TL-86a6d8b7 | في الخارطة | TR-074 |
| SSL Blacklist | شهادات SSL الخبيثة | مفتوح | — | مرشح | — |
| [URLScan.io](https://urlscan.io/search/#*) | تحليل ومسح المواقع | مجاني | TL-c74816f4 | في الخارطة | TR-009 |
| [Hybrid Analysis](https://hybrid-analysis.com/) | تحليل البرمجيات الخبيثة | مجاني | TL-4dd7d00a | في الخارطة | TR-061 |
| [Any.Run](https://any.run/) | تحليل تفاعلي | مجاني | TL-82fc63b9 | في الكتالوج | — |
| [Joe Sandbox](https://www.joesandbox.com/) | تحليل البرمجيات الخبيثة | مجاني | TL-1e862e5e | في الكتالوج | — |
| [Triage](https://tria.ge/reports/public) | تحليل البرمجيات الخبيثة | مجاني | TL-62020870 | في الخارطة | TR-062 |
| [Intezer](https://analyze.intezer.com/scan) | تحليل الشيفرة | مدفوع | TL-65c29a51 | في الكتالوج | — |
| [Malpedia](https://malpedia.caad.fkie.fraunhofer.de/) | موسوعة البرمجيات الخبيثة | مفتوح | TL-b276e68a | في الخارطة | TR-063 |
| [ThreatMiner](https://www.threatminer.org/) | استخبارات التهديدات | مجاني | TL-a80cf1fb | في الكتالوج | — |

### 8 محركات البحث عن العملات الرقمية

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| [Etherscan](https://etherscan.io/) | مستكشف Ethereum | مجاني | TL-036543e8 | في الخارطة | TR-017 |
| Blockchain.com Explorer | مستكشف Bitcoin | مجاني | — | مرشح | — |
| [Blockchair](https://blockchair.com/) | مستكشف متعدد السلاسل | مجاني | TL-679d4dec | في الخارطة | TR-065 |
| [Tokenview](https://tokenview.com/) | مستكشف متعدد | مجاني | TL-1703717c | في الكتالوج | — |
| [Arkham Intelligence](https://intel.arkm.com/) | تحليلات on-chain وكشف الهويات | مجاني | TL-f84b858d | في الكتالوج | — |
| [Breadcrumbs](https://www.breadcrumbs.app/) | تحقيقات بصرية للبلوكشين | مجاني | TL-9eb2a63b | في الكتالوج | — |
| [Whale Alert](https://whale-alert.io/) | تنبيهات المعاملات الكبيرة | مجاني | TL-b1f87f2a | في الخارطة | TR-067 |
| [Chainabuse](https://www.chainabuse.com/) | قاعدة بيانات الاحتيال | مجاني | TL-2fdaba2c | في الخارطة | TR-066 |
| [CryptoScamDB](https://cryptoscamdb.org/) | قاعدة بيانات الاحتيال | مفتوح | TL-26c0897d | في الخارطة | TR-066 |
| OXT | تحليل Bitcoin | مفتوح | — | مرشح | — |
| [WalletExplorer](https://www.walletexplorer.com/) | مستكشف Bitcoin | مجاني | TL-c84b1d2d | في الكتالوج | — |
| Blockchain.com API | API للبلوكشين | مجاني | — | مرشح | — |
| [Bitquery](https://www.bitquery.io/) | API للبلوكشين | مدفوع | TL-1284e997 | في الخارطة | TR-085 |
| [Covalent](https://www.covalenthq.com/docs/api/) | API للبلوكشين | مدفوع | TL-9f597e5e | في الكتالوج | — |
| crypttrace | مجموعة أدوات تحقيقات العملات الرقمية | مفتوح | — | مرشح | — |

### 9 محركات البحث عن الشركات والسجلات

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| [OpenCorporates](http://api.opencorporates.com/documentation/API-Reference) | أكبر قاعدة بيانات شركات مفتوحة | مجاني | TL-e109146a | في الخارطة | TR-022 |
| [OpenOwnership](https://www.openownership.org/en/) | بيانات الملكية الحقيقية | مفتوح | TL-ec129a31 | في الكتالوج | — |
| OCCRP Aleph | بيانات صحافة استقصائية | مفتوح | — | في الخارطة | TR-068 |
| [ICIJ Offshore Leaks](https://offshoreleaks.icij.org/) | بيانات التسريبات البحرية | مفتوح | TL-53c8b902 | في الخارطة | TR-069 |
| [OpenSanctions](https://www.opensanctions.org/) | قوائم العقوبات | مفتوح | TL-4d494627 | في الخارطة | TR-025 |
| SEC EDGAR | سجلات الشركات الأمريكية | مجاني | — | في الخارطة | TR-024 |
| [Companies House](https://beta.companieshouse.gov.uk/) | سجلات الشركات البريطانية | مجاني | TL-e1730ac4 | في الخارطة | TR-023 |
| Delaware Business Search | سجلات شركات ديلاوير | مجاني | — | مرشح | — |
| EU Business Register | سجلات الشركات الأوروبية | مجاني | — | مرشح | — |
| WIPO Global Brand Database | العلامات التجارية العالمية | مجاني | — | في الخارطة | TR-084 |
| [USPTO](https://www.uspto.gov/learning-and-resources/open-data-and-mobility) | براءات وعلامات أمريكية | مجاني | TL-0970cce6 | في الكتالوج | — |
| [EUIPO](https://euipo.europa.eu/eSearch/) | علامات الاتحاد الأوروبي | مجاني | TL-a6b194e1 | في الخارطة | TR-084 |
| [SAIP](https://www.saip.gov.sa/) | العلامات التجارية السعودية | مجاني | TL-f8e0c0f1 | في الخارطة | TR-084 |
| Google Patents | براءات الاختراع | مجاني | — | مرشح | — |
| [Crunchbase](https://www.crunchbase.com/#/home/index) | بيانات الشركات الناشئة | مجاني | TL-a4b2ef3e | في الكتالوج | — |
| [Sayari](https://sayari.com/) | استخبارات سلسلة التوريد | مدفوع | TL-b89a9dce | في الكتالوج | — |

### 10 محركات البحث عن الصور والوسائط

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| [Google Images](https://images.google.com/) | بحث عكسي | مجاني | TL-274f300b | في الكتالوج | — |
| [Yandex Images](https://yandex.com/images/) | بحث عكسي قوي | مجاني | TL-1e8c96ed | في الكتالوج | — |
| Bing Visual Search | بحث عكسي | مجاني | — | متوقف | ضمن واجهات Bing الموقوفة في 2025-08-11 ([مصدر](https://learn.microsoft.com/en-us/lifecycle/announcements/bing-search-api-retirement)) |
| [TinEye](https://tineye.com/) | بحث عكسي | مجاني | TL-5abbeafc | في الخارطة | TR-033 |
| [SauceNAO](https://saucenao.com/) | بحث عن مصدر الصور | مجاني | TL-1fe76b9b | في الكتالوج | — |
| [PimEyes](https://pimeyes.com/en) | بحث عن الوجوه | مدفوع | TL-b9c3dbe8 | مستبعد | بحث بالوجه عن أشخاص (E-02) |
| [Karma Decay](http://karmadecay.com/) | بحث عن الصور المكررة على Reddit | مجاني | TL-9b9057c5 | في الكتالوج | — |
| InVID | التحقق من الصور والفيديو | مفتوح | — | مرشح | — |
| [FotoForensics](https://fotoforensics.com/) | تحليل التلاعب | مجاني | TL-ee5903f0 | في الكتالوج | — |
| [Forensically](https://29a.ch/photo-forensics/) | تحليل التلاعب | مجاني | TL-fe28f732 | في الكتالوج | — |
| [Ghiro](https://github.com/Ghirensics/ghiro) | تحليل forensics للصور | مفتوح | TL-af900c1d | في الكتالوج | — |
| [Izitru](http://www.izitru.com/) | التحقق من الصور | مجاني | TL-0b65cf1b | في الكتالوج | — |
| Deepware Scanner | كشف Deepfake | مجاني | — | مرشح | — |
| [Sensity](https://sensity.ai/) | كشف Deepfake | مدفوع | TL-d0c8a805 | في الكتالوج | — |
| Reality Defender | كشف Deepfake | مدفوع | — | مرشح | — |
| [ExifTool](http://www.sno.phy.queensu.ca/~phil/exiftool) | استخراج بيانات الصور | مفتوح | TL-645c328d | مكدس المشروع | TR-031 |
| [ExifReader](https://github.com/mattiasw/ExifReader) | تحليل بيانات EXIF/XMP/GPS للصور محليًا (TR-031) | مفتوح | TL-f6a3c4db | في الخارطة | TR-031 |
| [jimp](https://github.com/jimp-dev/jimp) | معالجة صور بJS خالص — تجزئة إدراكية pHash/dHash (TR-032، بديل sharp المتوقف: L-18) | مفتوح | TL-060b80df | في الخارطة | TR-032 |

### 11 محركات البحث عن الأصول التاريخية

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| [Wayback Machine](https://archive.org/web/) | نسخ قديمة من الصفحات | مجاني | TL-23c50734 | في الكتالوج | — |
| [Archive.today](https://archive.today) | أرشيف الصفحات | مجاني | TL-e741a5dd | في الخارطة | TR-076 |
| [Common Crawl](https://commoncrawl.org/) | بيانات زحف الويب | مفتوح | TL-f423189d | في الخارطة | TR-052 |
| Google Cache | نسخ Google المؤقتة | مجاني | — | متوقف | أُزيل في 2024 ([مصدر](https://www.seroundtable.com/google-cache-dead-38112.html)) |
| Bing Cache | نسخ Bing المؤقتة | مجاني | — | متوقف | لا واجهة بعد إيقاف واجهات Bing ([مصدر](https://learn.microsoft.com/en-us/lifecycle/announcements/bing-search-api-retirement)) |
| Yandex Cache | نسخ Yandex المؤقتة | مجاني | — | مرشح | — |
| [Timetravel](http://timetravel.mementoweb.org/) | أرشيف متعدد | مجاني | TL-901cc095 | في الكتالوج | — |
| Memento | أرشيف | مجاني | — | مرشح | — |
| [Perma.cc](https://perma.cc/) | أرشفة دائمة | مجاني | TL-c5c0c962 | في الخارطة | TR-088 |
| [urlscan.io](https://urlscan.io/search/#*) | أرشفة وتحليل الصفحات | مجاني | TL-c74816f4 | في الخارطة | TR-009 |

### 12 محركات البحث عن وسائل التواصل

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| Bluesky | أدوات تحليل | مجاني | — | مرشح | — |
| Mastodon | بحث في المثيلات | مجاني | — | مرشح | — |
| SocialNet | تحقيقات وسائل التواصل | مدفوع | — | مرشح | — |
| Osintgraph | تحليل شبكات Instagram | مفتوح | — | مستبعد | جمع من Instagram بجلسة دخول، يخالف شروط المنصة |
| [Toutatis](https://pypi.org/project/toutatis/) | بيانات Instagram | مفتوح | TL-0348fd1c | في الكتالوج | — |

### 13 محركات البحث عن الطائرات والسفن

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| [Flightradar24](https://www.flightradar24.com/data/gps-jamming?date=2025-06-19) | تتبع الطائرات | مجاني | TL-e5c8ef6f | في الكتالوج | — |
| [FlightAware](https://www.flightaware.com/) | تتبع الطائرات | مجاني | TL-007b4fee | في الكتالوج | — |
| [ADS-B Exchange](https://www.adsbexchange.com/) | بيانات ADS-B غير مفلترة | مجاني | TL-b41d22f7 | في الكتالوج | — |
| [OpenSky Network](https://opensky-network.org/) | بيانات ADS-B بحثية | مجاني | TL-cfeb77bb | في الخارطة | TR-040 |
| [PlaneFinder](https://planefinder.net/) | تتبع الطائرات | مجاني | TL-3aa2d4ae | في الكتالوج | — |
| [MarineTraffic](https://www.marinetraffic.com/) | تتبع السفن | مجاني | TL-e4242560 | في الكتالوج | — |
| [VesselFinder](https://www.vesselfinder.com/) | تتبع السفن | مجاني | TL-1cf64c44 | في الكتالوج | — |
| [Global Fishing Watch](https://globalfishingwatch.org) | تتبع الصيد | مجاني | TL-e9b9fc6b | في الكتالوج | — |
| [Equasis](https://www.equasis.org/EquasisWeb/public/HomePage) | بيانات السفن | مجاني | TL-dbf97fab | في الكتالوج | — |
| [WiGLE](https://wigle.net/) | قواعد بيانات الشبكات اللاسلكية | مجاني | TL-099e4f4d | في الكتالوج | — |
| [dump1090](https://github.com/flightaware/dump1090) | فك ADS-B | مفتوح | TL-a97e6e01 | في الخارطة | P2-031 |
| [readsb](https://github.com/wiedehopf/readsb) | فك ADS-B | مفتوح | TL-4ec05284 | في الخارطة | P2-031 |
| [tar1090](https://github.com/wiedehopf/tar1090) | واجهة ويب للطائرات | مفتوح | TL-cd0ecc2c | في الكتالوج | — |
| [AIS-catcher](https://github.com/jvde-github/AIS-catcher) | استقبال AIS | مفتوح | TL-334f16eb | في الخارطة | P2-031 |
| [Gqrx](https://github.com/gqrx-sdr/gqrx) | مستقبل SDR | مفتوح | TL-d630855a | في الكتالوج | — |
| [SDR++](https://github.com/AlexandreRouma/SDRPlusPlus) | مستقبل SDR | مفتوح | TL-f9f530a2 | في الكتالوج | — |
| [Universal Radio Hacker](https://github.com/jopohl/urh) | تحليل البروتوكولات اللاسلكية | مفتوح | TL-be7fe04c | في الكتالوج | — |
| [rtl_433](https://github.com/merbanan/rtl_433) | فك أجهزة ISM | مفتوح | TL-da3cbed8 | في الكتالوج | — |
| [SatDump](https://www.satdump.org/about/) | فك بيانات الأقمار | مفتوح | TL-f26fd03f | في الكتالوج | — |
| [Gpredict](https://github.com/csete/gpredict) | تتبع الأقمار | مفتوح | TL-4f45c027 | في الكتالوج | — |
| [Kismet](https://github.com/kismetwireless/kismet) | كشف الشبكات اللاسلكية | مفتوح | TL-6243998b | في الكتالوج | — |
| OpenALPR | التعرف على لوحات السيارات | مفتوح | — | مرشح | — |

### 14 محركات البحث في الويب المظلم

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| [Ahmia](https://ahmia.fi/) | محرك بحث Tor | مفتوح | TL-9f9da81a | في الكتالوج | — |
| [OnionScan](https://onionscan.org/) | تحليل خدمات Tor | مفتوح | TL-b9e7ae5d | في الكتالوج | — |
| [Onionsearch](https://github.com/megadose/OnionSearch) | بحث في Tor | مفتوح | TL-57d8048f | في الكتالوج | — |
| [Hidden Wiki](https://thehiddenwiki.org/) | دليل مواقع Tor | مفتوح | TL-165224cd | في الكتالوج | — |
| [DarkOwl](https://www.darkowl.com/) | استخبارات الويب المظلم | مدفوع | TL-43587682 | في الكتالوج | — |
| [Intel471](https://intel471.com/) | استخبارات الويب المظلم | مدفوع | TL-c5e083c4 | في الكتالوج | — |
| [Flashpoint](https://flashpoint.io/resources/research/flashpoint-and-chainalysis-investigate-hydra-where-cryptocurrency-cybercrime-goes-dark/) | استخبارات الويب المظلم | مدفوع | TL-e35002a9 | في الكتالوج | — |
| darkwatch | مراقبة التعرض على الويب المظلم | مفتوح | — | مرشح | — |
| [AIL Framework](https://github.com/ail-project/ail-framework) | تحليل التسريبات | مفتوح | TL-c445b6c4 | في الكتالوج | — |

### 15 محركات البحث عن البيانات الحكومية والمفتوحة

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| [USASpending.gov](https://api.usaspending.gov/) | الإنفاق الحكومي الأمريكي | مجاني | TL-7a696565 | في الكتالوج | — |
| [FEC](https://api.open.fec.gov/developers/) | تبرعات سياسية أمريكية | مجاني | TL-9222e5a1 | في الكتالوج | — |
| Follow the Money | تتبع الأموال | مجاني | — | مرشح | — |
| [OpenTender](https://opentender.net/) | المناقصات الأوروبية | مجاني | TL-8abb3483 | في الكتالوج | — |
| [data.gov](https://api.data.gov/) | البيانات المفتوحة الأمريكية | مجاني | TL-6c8724ff | في الخارطة | TR-029 |
| data.gov.uk | البيانات المفتوحة البريطانية | مجاني | — | مرشح | — |
| EU Open Data Portal | البيانات المفتوحة الأوروبية | مجاني | — | مرشح | — |
| [World Bank Open Data](https://data.worldbank.org/) | بيانات البنك الدولي | مجاني | TL-e2d61f26 | في الكتالوج | — |

### 16 محركات البحث عن الملفات والوثائق

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| [Metagoofil](https://github.com/laramies/metagoofil) | استخراج بيانات وصفية من الوثائق العامة | مفتوح | TL-6b063c72 | في الكتالوج | — |
| [FOCA](https://github.com/ElevenPaths/FOCA) | تحليل البيانات الوصفية | مفتوح | TL-5f8e1904 | في الكتالوج | — |
| [ExifTool](http://www.sno.phy.queensu.ca/~phil/exiftool) | استخراج البيانات الوصفية | مفتوح | TL-645c328d | مكدس المشروع | TR-031 |
| pdfid | تحليل PDF | مفتوح | — | في الخارطة | TR-086 |
| [peepdf](https://github.com/jesparza/peepdf) | تحليل PDF | مفتوح | TL-9a597988 | في الخارطة | TR-086 |
| pdf-parser | تحليل PDF | مفتوح | — | في الخارطة | TR-086 |
| [qpdf](https://github.com/qpdf/qpdf) | معالجة PDF | مفتوح | TL-50b5d284 | في الكتالوج | — |
| [oletools](https://github.com/decalage2/oletools) | تحليل ملفات Office | مفتوح | TL-9e1db23c | في الكتالوج | — |
| python-docx | معالجة Word | مفتوح | — | مرشح | — |
| openpyxl | معالجة Excel | مفتوح | — | مرشح | — |
| [EasyOCR](https://github.com/JaidedAI/EasyOCR) | OCR متعدد اللغات | مفتوح | TL-d56ea6e6 | مكدس المشروع | P5-024 |

## الأذرع: التحليل والمعالجة

### 17 تحليل البيانات الوصفية (Metadata Analysis)

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| [ExifTool](http://www.sno.phy.queensu.ca/~phil/exiftool) | المعيار الذهبي لاستخراج البيانات الوصفية | مفتوح | TL-645c328d | مكدس المشروع | TR-031 |
| [FOCA](https://github.com/ElevenPaths/FOCA) | تحليل جماعي للبيانات الوصفية | مفتوح | TL-5f8e1904 | في الكتالوج | — |
| [Metagoofil](https://github.com/laramies/metagoofil) | استخراج بيانات من الوثائق | مفتوح | TL-6b063c72 | في الكتالوج | — |
| [Metadata2Go](https://www.metadata2go.com/) | عرض البيانات الوصفية عبر الإنترنت | مجاني | TL-3760c5f3 | في الكتالوج | — |
| [Jeffrey's Image Metadata Viewer](http://regex.info//exif.cgi) | عارض بيانات الصور | مجاني | TL-ac7369e0 | في الكتالوج | — |
| [Metapicz](https://metapicz.com/#landing) | عارض بيانات الصور | مجاني | TL-537260eb | في الكتالوج | — |
| [MAT2](https://github.com/jvoisin/mat2) | تنقية البيانات الوصفية | مفتوح | TL-ec38b6ce | في الكتالوج | — |

### 18 تحليل الصور والوسائط

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| [FotoForensics](https://fotoforensics.com/) | تحليل التلاعب (ELA) | مجاني | TL-ee5903f0 | في الكتالوج | — |
| [Forensically](https://29a.ch/photo-forensics/) | تحليل التلاعب | مجاني | TL-fe28f732 | في الكتالوج | — |
| [Ghiro](https://github.com/Ghirensics/ghiro) | تحليل forensics | مفتوح | TL-af900c1d | في الكتالوج | — |
| [Izitru](http://www.izitru.com/) | التحقق من الصور | مجاني | TL-0b65cf1b | في الكتالوج | — |
| InVID | التحقق من الصور والفيديو | مفتوح | — | مرشح | — |
| [WeVerify](https://weverify.eu/) | التحقق من المحتوى | مفتوح | TL-fe9b1a6b | في الكتالوج | — |
| AP Verify | التحقق من الصور والفيديو | مدفوع | — | مرشح | — |
| Google Vision | API تحليل الصور بالذكاء الاصطناعي | مدفوع | — | مرشح | — |
| AWS Rekognition | تحليل الصور | مدفوع | — | مرشح | — |
| Azure Vision | تحليل الصور | مدفوع | — | مرشح | — |
| Deepware Scanner | كشف Deepfake | مجاني | — | مرشح | — |
| [Sensity](https://sensity.ai/) | كشف Deepfake | مدفوع | TL-d0c8a805 | في الكتالوج | — |
| Reality Defender | كشف Deepfake | مدفوع | — | مرشح | — |
| OpenALPR | التعرف على اللوحات | مفتوح | — | مرشح | — |

### 19 التحليل الجغرافي (Geolocation & Mapping)

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| [Google Earth Pro](https://www.google.com/intl/en/earth/versions/#earth-pro) | صور الأقمار الصناعية | مجاني | TL-3e3a1d7a | في الكتالوج | — |
| [Google Maps](https://www.google.com/maps/) | خرائط | مجاني | TL-978c6cf7 | في الكتالوج | — |
| [Yandex Maps](https://yandex.com/maps/) | خرائط | مجاني | TL-ee810002 | في الكتالوج | — |
| [Bing Maps](https://www.bing.com/maps) | خرائط | مجاني | TL-1d18257b | في الكتالوج | — |
| [Mapillary](https://www.mapillary.com/app/) | صور مستوى الشارع | مجاني | TL-6564a919 | في الكتالوج | — |
| [KartaView](https://kartaview.org/map/) | صور مستوى الشارع | مجاني | TL-16d5f784 | في الكتالوج | — |
| [OpenStreetMap](https://www.openstreetmap.org/) | خرائط مفتوحة | مفتوح | TL-7eb7af63 | في الكتالوج | — |
| [Overpass Turbo](https://overpass-turbo.eu/) | استعلامات OSM متقدمة | مفتوح | TL-8612151f | في الكتالوج | — |
| [Bellingcat OSM Search](https://osm-search.bellingcat.com/) | بحث في OSM | مفتوح | TL-1fc5f33a | في الكتالوج | — |
| [SunCalc](https://suncalc.net/) | حساب موضع الشمس | مفتوح | TL-186812b9 | في الكتالوج | — |
| [ShadowCalculator](http://shadowcalculator.eu/#/lat/50.08/lng/19.9) | حساب الظلال | مفتوح | TL-cf86d009 | في الكتالوج | — |
| [Peakfinder](https://www.peakfinder.com/) | تحديد القمم | مجاني | TL-171fb00f | في الكتالوج | — |
| [Peakvisor](https://peakvisor.com/) | تحديد القمم | مجاني | TL-5b71507d | في الكتالوج | — |
| [Sentinel Hub](https://www.sentinel-hub.com/explore/sentinelplayground/) | صور الأقمار الصناعية | مجاني | TL-d1e17c4a | في الكتالوج | — |
| Planet Labs | صور الأقمار | مدفوع | — | مرشح | — |
| [Maxar](https://discover.maxar.com/) | صور الأقمار | مدفوع | TL-740472bd | في الكتالوج | — |
| TracePoint | تحديد الموقع من الصور | مفتوح | — | مرشح | — |

### 20 تحليل الشبكات والروابط (Link Analysis)

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| [Maltego](https://www.maltego.com/categories/osint/) | تحليل الروابط والرسم البياني | مدفوع | TL-1c93cd05 | في الخارطة | P8-014 |
| [Gephi](https://github.com/gephi/gephi) | تحليل وتصور الشبكات | مفتوح | TL-77f4a112 | في الكتالوج | — |
| [Cytoscape](https://cytoscape.org/) | تحليل الشبكات | مفتوح | TL-57aa7e4f | مكدس المشروع | P3 (عرض الرسم) |
| [Neo4j](http://tinkerpop.apache.org/docs/current/#neo4j-gremlin) | قاعدة بيانات الرسم البياني | مفتوح | TL-3269db6a | في الخارطة | P8-014 |
| Linkurious | تصور Neo4j | مدفوع | — | مرشح | — |
| i2 Analyst's Notebook | تحليل استخباراتي | مدفوع | — | مرشح | — |
| [yEd](https://www.yworks.com/products/yed) | رسم بياني | مفتوح | TL-1f009207 | في الكتالوج | — |
| [Graphviz](http://www.graphviz.org/) | رسم بياني | مفتوح | TL-8bffd1ff | في الكتالوج | — |
| [Sigma.js](https://www.sigmajs.org/) | مكتبة رسم بياني للويب | مفتوح | TL-cc86dc6a | في الخارطة | P3-005 |
| [D3.js](https://d3js.org/) | تصور بيانات | مفتوح | TL-677d9808 | مكدس المشروع | P3 |
| [Vis.js](https://visjs.org/) | تصور شبكات | مفتوح | TL-e3ea87fc | في الكتالوج | — |
| PyGraphviz | رسم بياني بلغة Python | مفتوح | — | مرشح | — |
| [NetworkX](http://networkx.github.io/) | تحليل شبكات بلغة Python | مفتوح | TL-8c33e2c1 | في الخارطة | P4-011، P4-018 |

### 21 تحليل البيانات الكبيرة والاستعلام

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| Elasticsearch | محرك بحث وتحليلات | مفتوح | — | مرشح | — |
| [OpenSearch](https://open-search.aleph-networks.eu/en) | بحث وتحليلات | مفتوح | TL-f77885bb | في الكتالوج | — |
| Meilisearch | بحث سريع | مفتوح | — | مكدس المشروع | P5-020 (بديل بحث) |
| Typesense | بحث سريع | مفتوح | — | مكدس المشروع | P5-020 (بديل بحث) |
| [Apache Superset](https://superset.apache.org/docs/api) | تصور بيانات | مفتوح | TL-9658f3d0 | في الكتالوج | — |
| [Metabase](https://www.metabase.com/) | تحليلات | مفتوح | TL-5c0bbb01 | في الكتالوج | — |
| [DuckDB](https://duckdb.org/2023/04/28/spatial.html) | قاعدة بيانات تحليلية | مفتوح | TL-15b5a657 | في الكتالوج | — |
| Pandas | تحليل بيانات | مفتوح | — | مرشح | — |
| Polars | تحليل بيانات سريع | مفتوح | — | مرشح | — |
| Apache Spark | معالجة بيانات ضخمة | مفتوح | — | مرشح | — |

### 22 تحليل النصوص واللغة

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| spaCy | معالجة لغة طبيعية | مفتوح | — | في الخارطة | P5-025 |
| [@umalqura/core](https://github.com/umalqura/umalqura) | تحويل وتنسيق التقويم الهجري (أم القرى) 1356..1500هـ — P5-004 | مفتوح | TL-8afbfec9 | في الكتالوج | — |
| [Stanza](https://github.com/stanfordnlp/stanza) | NLP متعدد اللغات | مفتوح | TL-08b94619 | في الخارطة | P5-025 |
| Hugging Face Transformers | نماذج NLP | مفتوح | — | مرشح | — |
| BERT | فهم النصوص | مفتوح | — | مرشح | — |
| [fastText](https://github.com/facebookresearch/fastText) | تصنيف النصوص | مفتوح | TL-83bbd3c9 | في الخارطة | TR-087 |
| LangDetect | تحديد اللغة | مفتوح | — | مرشح | — |
| [CLD3](https://github.com/google/cld3) | تحديد اللغة | مفتوح | TL-9a920edf | في الخارطة | TR-087 |
| [EasyOCR](https://github.com/JaidedAI/EasyOCR) | OCR متعدد اللغات | مفتوح | TL-d56ea6e6 | مكدس المشروع | P5-024 |
| [Google](https://translate.google.co.id/?sl=auto&tl=en&op=translate) | NLP تحليل النصوص | مدفوع | TL-2f220b9a | في الخارطة | TR-001، TR-053، TR-081 |
| AWS Comprehend | تحليل النصوص | مدفوع | — | مرشح | — |

### 23 تحليل الهوية والكيانات (Entity Resolution)

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| [Dedupe](https://github.com/dedupeio/dedupe) | إزالة التكرار | مفتوح | TL-8fa57ef2 | في الخارطة | P4-023 |
| [Splink](https://github.com/moj-analytical-services/splink) | ربط السجلات | مفتوح | TL-09d2ddb7 | في الخارطة | P4-023 |
| [Zingg](https://github.com/zinggAI/zingg) | تعلم آلي لربط السجلات | مفتوح | TL-1ced8cdc | في الخارطة | P4-023 |
| [Senzing](https://senzing.com/) | مطابقة الكيانات | مدفوع | TL-813d550a | في الكتالوج | — |
| Tilores | حل الكيانات | مدفوع | — | مرشح | — |
| [RecordLinkage](https://github.com/J535D165/recordlinkage) | ربط السجلات | مفتوح | TL-749c764c | مكدس المشروع | P4-023 |
| PyEntityResolution | حل الكيانات | مفتوح | — | مرشح | — |

### 24 تحليل التهديدات والأمن السيبراني

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| [MISP](https://www.misp-project.org/) | منصة مشاركة استخبارات التهديدات | مفتوح | TL-69d076b5 | في الخارطة | P4-022، P8-012 |
| [OpenCTI](https://github.com/OpenCTI-Platform/opencti) | إدارة المعرفة السيبرانية | مفتوح | TL-1d3bd937 | في الخارطة | P8-012 |
| [IntelOwl](https://github.com/intelowlproject/IntelOwl/) | تحليل المؤشرات | مفتوح | TL-c579a1c6 | في الكتالوج | — |
| [Yeti](https://github.com/yeti-platform/yeti) | استخبارات التهديدات والطب الشرعي | مفتوح | TL-f879e62e | في الكتالوج | — |
| [TheHive](https://thehive-project.org/) | استجابة للحوادث | مدفوع | TL-02233eff | في الخارطة | P8-012 |
| Cortex | تحليل المراقبة | مفتوح | — | في الخارطة | P8-012 |
| [Threat Bus](https://github.com/tenzir/threatbus) | توزيع استخبارات التهديدات | مفتوح | TL-91a944ac | في الكتالوج | — |
| [Sigma](https://github.com/SigmaHQ/sigma) | قواعد كشف | مفتوح | TL-5134d5c8 | في الخارطة | P3-005، P4-021 |
| [YARA](https://github.com/VirusTotal/yara) | قواعد كشف البرمجيات الخبيثة | مفتوح | TL-54a83925 | في الخارطة | P4-021، TR-063 |
| [Snort](https://www.snort.org/) | كشف التسلل | مفتوح | TL-95823dda | في الكتالوج | — |
| [Suricata](http://suricata-ids.org/) | كشف التسلل | مفتوح | TL-86221e99 | في الكتالوج | — |
| [Elastic Detection Rules](https://github.com/elastic/detection-rules) | قواعد كشف | مفتوح | TL-7e014a6c | في الكتالوج | — |
| [Splunk Security Content](https://github.com/splunk/security_content) | قواعد كشف | مفتوح | TL-0138b409 | في الكتالوج | — |
| [MITRE ATT&CK](https://attack.mitre.org/) | إطار تقنيات المهاجمين | مفتوح | TL-68dc4e7c | في الخارطة | P4-020 |
| [MITRE CAPEC](https://capec.mitre.org/) | أنماط الهجوم | مفتوح | TL-bc934678 | في الكتالوج | — |
| [MITRE D3FEND](https://d3fend.mitre.org/) | تقنيات الدفاع | مفتوح | TL-8c878400 | في الكتالوج | — |

### 25 تحليل الطب الشرعي الرقمي (DFIR)

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| [Volatility](https://github.com/volatilityfoundation/volatility) | 3 تحليل الذاكرة | مفتوح | TL-30a653d1 | في الكتالوج | — |
| [AVML](https://github.com/microsoft/avml) | حجز ذاكرة Linux | مفتوح | TL-9162aff4 | في الكتالوج | — |
| [LiME](https://github.com/jtsylve/LiME) | استخراج ذاكرة Linux | مفتوح | TL-cc83f8ba | في الكتالوج | — |
| [KAPE](https://www.kroll.com/en/services/cyber-risk/incident-response-litigation-support/kroll-artifact-parser-extractor-kape) | جمع وتحليل الأدلة | مفتوح | TL-399d5ab6 | في الكتالوج | — |
| [Velociraptor](https://github.com/Velocidex/velociraptor) | استجابة للحوادث | مفتوح | TL-bd6521f2 | في الكتالوج | — |
| [Autopsy](http://www.sleuthkit.org/autopsy/) | تحليل forensics | مفتوح | TL-06cda8d6 | في الكتالوج | — |
| [The Sleuth Kit](https://github.com/sleuthkit/sleuthkit) | تحليل forensics | مفتوح | TL-cb95d39f | في الكتالوج | — |
| [Plaso / log2timeline](https://github.com/log2timeline/plaso) | تحليل زمني | مفتوح | TL-8b00d7cd | في الكتالوج | — |
| [Timesketch](https://github.com/google/timesketch) | تحليل زمني تعاوني | مفتوح | TL-cd88945f | في الكتالوج | — |
| FTK Imager | حجز الأدلة | مجاني | — | مرشح | — |
| Magnet AXIOM | تحليل forensics | مدفوع | — | مرشح | — |
| [Cellebrite](https://cellebrite.com/en/ufed/) | تحليل الهواتف | مدفوع | TL-0e833743 | في الكتالوج | — |
| [X-Ways Forensics](http://www.x-ways.net/forensics/) | تحليل forensics | مدفوع | TL-7682614f | في الكتالوج | — |
| EnCase Forensic | تحليل forensics | مدفوع | — | مرشح | — |
| [Aleapp](https://github.com/abrignoni/ALEAPP) | تحليل Android | مفتوح | TL-fb492fae | في الكتالوج | — |
| [iLEAPP](https://github.com/abrignoni/iLEAPP) | تحليل iOS | مفتوح | TL-0a165f65 | في الكتالوج | — |
| Eric Zimmerman Tools | أدوات Windows forensics | مفتوح | — | مرشح | — |
| [MFTECmd](https://binaryforay.blogspot.com/2018/06/introducing-mftecmd.html) | تحليل MFT | مفتوح | TL-030fd160 | في الكتالوج | — |
| ShellBags Explorer | تحليل ShellBags | مفتوح | — | مرشح | — |
| Registry Explorer | تحليل Registry | مفتوح | — | مرشح | — |
| [Wireshark](https://www.wireshark.org/download.html) | تحليل الشبكة | مفتوح | TL-e8dee90b | في الكتالوج | — |
| [NetworkMiner](https://www.netresec.com/?page=Networkminer) | تحليل الشبكة | مفتوح | TL-c2a28974 | في الكتالوج | — |
| [Zeek](https://zeek.org/) | تحليل الشبكة | مفتوح | TL-58e538e6 | في الكتالوج | — |
| TCPdump | تحليل الشبكة | مفتوح | — | مرشح | — |

### 26 تحليل العملات الرقمية (المتقدمة)

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| [Chainalysis](https://www.chainalysis.com/blockchain-intelligence/) | تحقيقات بلوكشين | مدفوع | TL-842802fc | في الكتالوج | — |
| [TRM Labs](https://www.trmlabs.com/) | تحقيقات بلوكشين | مدفوع | TL-a386ce55 | في الكتالوج | — |
| Elliptic | تحقيقات بلوكشين | مدفوع | — | مرشح | — |
| [CipherTrace](https://ciphertrace.com/) | تحقيقات بلوكشين | مدفوع | TL-614710fa | في الكتالوج | — |
| Nansen | تحليلات on-chain | مدفوع | — | مرشح | — |
| [Dune Analytics](https://dune.com/) | استعلامات بلوكشين | مجاني | TL-134e856d | في الكتالوج | — |
| [DeFiLlama](https://defillama.com/) | بيانات DeFi | مجاني | TL-9e80d886 | في الكتالوج | — |
| [Breadcrumbs](https://www.breadcrumbs.app/) | تحقيقات بصرية | مجاني | TL-9eb2a63b | في الكتالوج | — |
| [Arkham](https://intel.arkm.com/) | تحليلات on-chain | مجاني | TL-f84b858d | في الكتالوج | — |

### 27 تحليل البيانات المالية

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| [OpenCorporates](http://api.opencorporates.com/documentation/API-Reference) | بيانات الشركات | مجاني | TL-e109146a | في الخارطة | TR-022 |
| [Sayari](https://sayari.com/) | استخبارات سلسلة التوريد | مدفوع | TL-b89a9dce | في الكتالوج | — |
| [LexisNexis](https://www.lexisnexis.com/en-us) | بيانات قانونية وتجارية | مدفوع | TL-e000c06e | في الكتالوج | — |
| ComplyAdvantage | مراقبة المخاطر | مدفوع | — | مرشح | — |
| Aleph (OCCRP | بيانات صحافة استقصائية | مفتوح | — | مرشح | — |
| Follow the Money | تتبع الأموال | مجاني | — | مرشح | — |
| [OpenTender](https://opentender.net/) | المناقصات | مجاني | TL-8abb3483 | في الكتالوج | — |

## الأرجل: الوصول والتنقل

### 28 المتصفحات وأدوات التصفح

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| [Tor Browser](https://www.torproject.org/) | تصفح مجهول | مفتوح | TL-0c048063 | في الكتالوج | — |
| Brave Browser | متصفح يركز على الخصوصية | مفتوح | — | مرشح | — |
| Firefox | متصفح مرن | مفتوح | — | مرشح | — |
| Chromium | متصفح مفتوح المصدر | مفتوح | — | مرشح | — |
| [Tails](https://tails.net/) | نظام تشغيل مجهول | مفتوح | TL-58408a87 | في الكتالوج | — |
| [Whonix](https://www.whonix.org) | نظام تشغيل مجهول | مفتوح | TL-31ae5137 | في الكتالوج | — |
| [Qubes OS](https://www.qubes-os.org/) | نظام تشغيل آمن | مفتوح | TL-0b3ad9f4 | في الكتالوج | — |
| [Sputnik](https://chrome.google.com/webstore/detail/sputnik/manapjdamopgbpimgojkccikaabhmocd/related) | إضافة OSINT للمتصفح | مفتوح | TL-0e1f7972 | في الكتالوج | — |
| PRISM | OSINT إضافة Firefox | مفتوح | — | مرشح | — |

### 29 أدوات البروكسي والخصوصية

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| [Tor](https://tor.link) | شبكة مجهولة | مفتوح | TL-7ca1365e | في الخارطة | P2-028 |
| [I2P](https://i2p.net/) | شبكة مجهولة | مفتوح | TL-8980d3dd | في الكتالوج | — |
| VPN | شبكات افتراضية خاصة | مدفوع | — | مرشح | — |
| [ProxyChains](https://www.kali.org/tools/proxychains-ng/) | تسلسل البروكسيات | مفتوح | TL-8f72897c | في الكتالوج | — |
| [Privoxy](https://www.privoxy.org/) | بروكسي | مفتوح | TL-7a659aae | في الكتالوج | — |
| Squid | بروكسي | مفتوح | — | مرشح | — |
| [mitmproxy](https://www.mitmproxy.org/) | بروكسي تفاعلي | مفتوح | TL-777ab069 | في الكتالوج | — |
| Burp Suite | بروكسي أمني | مدفوع | — | مرشح | — |

### 30 أدوات سطر الأوامر

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| curl | نقل البيانات | مفتوح | — | مرشح | — |
| [wget](http://www.gnu.org/software/wget/) | تنزيل | مفتوح | TL-04df799a | في الكتالوج | — |
| [nmap](https://nmap.org/) | مسح الشبكات | مفتوح | TL-6578b10d | في الكتالوج | — |
| netcat | أدوات الشبكة | مفتوح | — | مرشح | — |
| dig | استعلامات DNS | مفتوح | — | مرشح | — |
| [whois](https://who.is/) | استعلامات WHOIS | مفتوح | TL-42562da6 | في الخارطة | TR-050 |
| traceroute | تتبع المسار | مفتوح | — | مرشح | — |
| ping | اختبار الاتصال | مفتوح | — | مرشح | — |
| tcpdump | تحليل الشبكة | مفتوح | — | مرشح | — |
| jq | معالجة JSON | مفتوح | — | مرشح | — |
| yq | معالجة YAML | مفتوح | — | مرشح | — |
| ripgrep | بحث سريع | مفتوح | — | مرشح | — |
| fd | بحث عن الملفات | مفتوح | — | مرشح | — |
| fzf | بحث تفاعلي | مفتوح | — | مرشح | — |

### 31 أدوات جمع البيانات الآلي

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| [theHarvester](https://github.com/laramies/theHarvester) | جمع بريد ونطاقات | مفتوح | TL-37502490 | في الخارطة | P8-024 |
| [SpiderFoot](https://www.spiderfoot.net/) | أتمتة OSINT | مفتوح | TL-64c46305 | في الخارطة | P8-024 |
| [Recon-ng](https://github.com/lanmaster53/recon-ng) | إطار استطلاع | مفتوح | TL-07a02713 | في الكتالوج | — |
| [DataSploit](https://github.com/datasploit/datasploit/) | OSINT آلي | مفتوح | TL-b762d9ed | في الكتالوج | — |
| [Metagoofil](https://github.com/laramies/metagoofil) | جمع وثائق | مفتوح | TL-6b063c72 | في الكتالوج | — |
| [Photon](https://github.com/komoot/photon) | زحف سريع | مفتوح | TL-5c6b81d3 | في الكتالوج | — |
| [Scrapy](https://www.scrapy.org/) | إطار زحف | مفتوح | TL-a665b032 | في الكتالوج | — |
| [Beautiful Soup](https://BeautifulSoup.org/) | تحليل HTML | مفتوح | TL-45d25199 | في الكتالوج | — |
| [Selenium](https://www.selenium.dev/) | أتمتة المتصفح | مفتوح | TL-0abb3579 | في الكتالوج | — |
| [Playwright](https://playwright.dev/docs/writing-tests) | أتمتة المتصفح | مفتوح | TL-70e07be6 | في الخارطة | P3-020، P5-027 |
| [Puppeteer](https://github.com/puppeteer/puppeteer) | أتمتة المتصفح | مفتوح | TL-c6287e12 | مكدس المشروع | P5-027 |

### 32 أدوات تحليل الشبكات الاجتماعية

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| [instaloader](https://github.com/instaloader/instaloader) | تنزيل من Instagram | مفتوح | TL-a9207832 | في الكتالوج | — |
| [twint](https://forum.seccodeid.com/d/twint-twitter-intelligence-tool) | تحليل Twitter | مفتوح | TL-f479bdfe | في الكتالوج | — |
| [snscrape](https://github.com/JustAnotherArchivist/snscrape) | زحف الشبكات الاجتماعية | مفتوح | TL-8aec009c | في الكتالوج | — |
| [Osintgram](https://github.com/Datalux/Osintgram) | تحليل Instagram | حساس، مفتوح | TL-dccccd1e | مستبعد | جمع من Instagram بجلسة دخول، يخالف شروط المنصة |
| [Toutatis](https://pypi.org/project/toutatis/) | بيانات Instagram | مفتوح | TL-0348fd1c | في الكتالوج | — |
| Osintgraph | تحليل شبكات Instagram | مفتوح | — | مستبعد | جمع من Instagram بجلسة دخول، يخالف شروط المنصة |
| SocialNet | تحقيقات وسائل التواصل | مدفوع | — | مرشح | — |
| CyberTrace | تحليل forensics لوسائل التواصل | مفتوح | — | مرشح | — |

## الأجنحة: التوسع والنشر والتشغيل

### 33 أطر عمل الذكاء الاصطناعي

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| [Ollama](https://ollama.com/) | تشغيل نماذج LLM محلياً | مفتوح | TL-23ec2c6a | مكدس المشروع | P5-012 |
| vLLM | خدمة LLM عالية الأداء | مفتوح | — | مرشح | — |
| llama.cpp | تشغيل LLM | مفتوح | — | مكدس المشروع | P5-012 |
| [LM Studio](https://lmstudio.ai/) | واجهة لتشغيل LLM | مفتوح | TL-4b3acbc5 | في الكتالوج | — |
| [Hugging Face](https://huggingface.co/) | نماذج ومجموعات بيانات | مفتوح | TL-71612e4c | في الكتالوج | — |
| LangChain | إطار تطبيقات LLM | مفتوح | — | مرشح | — |
| LlamaIndex | إطار تطبيقات LLM | مفتوح | — | مرشح | — |
| AutoGen | وكلاء متعددون | مفتوح | — | مرشح | — |
| CrewAI | وكلاء متعددون | مفتوح | — | مرشح | — |

### 34 أدوات MCP (Model Context Protocol)

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| osint-mcp | 26 أداة OSINT مجانية كأدوات MCP | مفتوح | — | مرشح | — |
| mcp-world | أدوات OSINT لـ Claude | مفتوح | — | مرشح | — |
| [argus](https://github.com/jasonxtn/Argus?tab=readme-ov-file) | إطار OSINT محلي مع MCP | مفتوح | TL-b89e8d0c | في الكتالوج | — |

### 35 منصات النشر والتشغيل

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| [Docker](https://www.docker.com/) | حاويات | مفتوح | TL-9f5c8138 | في الخارطة | P1-024، P2-033، P7-002 |
| Docker Compose | تنسيق حاويات | مفتوح | — | مكدس المشروع | P0-023 (اختياري) |
| Kubernetes | تنسيق حاويات | مفتوح | — | في الخارطة | P8-009 |
| Helm | إدارة Kubernetes | مفتوح | — | في الخارطة | P8-009 |
| Terraform | بنية تحتية كشيفرة | مفتوح | — | مرشح | — |
| Ansible | أتمتة التكوين | مفتوح | — | مرشح | — |
| ArgoCD | نشر GitOps | مفتوح | — | مرشح | — |

### 36 قواعد البيانات ومخازن البيانات

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| PostgreSQL | قاعدة بيانات علائقية | مفتوح | — | مكدس المشروع | ADR-04 (نمط الفريق) |
| SQLite | قاعدة بيانات مدمجة | مفتوح | — | في الخارطة | P1-013 |
| [DuckDB](https://duckdb.org/2023/04/28/spatial.html) | قاعدة بيانات تحليلية | مفتوح | TL-15b5a657 | في الكتالوج | — |
| [Neo4j](http://tinkerpop.apache.org/docs/current/#neo4j-gremlin) | قاعدة بيانات رسم بياني | مفتوح | TL-3269db6a | في الخارطة | P8-014 |
| Redis | مخزن مؤقت | مفتوح | — | مكدس المشروع | نمط الفريق (5.9) |
| Elasticsearch | بحث وتحليلات | مفتوح | — | مرشح | — |
| [OpenSearch](https://open-search.aleph-networks.eu/en) | بحث وتحليلات | مفتوح | TL-f77885bb | في الكتالوج | — |
| Meilisearch | بحث سريع | مفتوح | — | مكدس المشروع | P5-020 (بديل بحث) |
| MinIO | تخزين كائنات | مفتوح | — | مكدس المشروع | نمط الفريق (5.9) |
| S3 | تخزين سحابي | مدفوع | — | مكدس المشروع | نمط الفريق (5.9) |

### 37 أدوات المراقبة والقياس

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| Prometheus | مراقبة | مفتوح | — | مكدس المشروع | 5.19 |
| [Grafana](https://grafana.com/) | لوحات معلومات | مفتوح | TL-2a430edf | في الكتالوج | — |
| [Loki](https://github.com/Neo23x0/Loki) | تسجيل | مفتوح | TL-5b986bf1 | في الكتالوج | — |
| Jaeger | تتبع موزع | مفتوح | — | مرشح | — |
| OpenTelemetry | مراقبة | مفتوح | — | مكدس المشروع | 5.19 |
| Sentry | تتبع الأخطاء | مفتوح | — | مكدس المشروع | 5.19 (اختياري، معطّل افتراضياً ADR-23) |
| Uptime Kuma | مراقبة التوفر | مفتوح | — | مرشح | — |
| Netdata | مراقبة | مفتوح | — | مرشح | — |

### 38 أدوات الأتمتة والتنسيق

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| [n8n](https://github.com/n8n-io/n8n) | أتمتة سير العمل | مفتوح | TL-ba28d566 | في الكتالوج | — |
| Apache Airflow | تنسيق المهام | مفتوح | — | مرشح | — |
| Prefect | تنسيق المهام | مفتوح | — | مرشح | — |
| Dagster | تنسيق المهام | مفتوح | — | مرشح | — |
| Temporal | تنسيق سير العمل | مفتوح | — | مرشح | — |
| Celery | مهام موزعة | مفتوح | — | مرشح | — |
| BullMQ | طوابير Node.js | مفتوح | — | مكدس المشروع | طابور المحرك (5.7) |
| Redis Queue | طوابير | مفتوح | — | مرشح | — |

### 39 أدوات التصور والتقارير

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| [Gephi](https://github.com/gephi/gephi) | تصور شبكات | مفتوح | TL-77f4a112 | في الكتالوج | — |
| [Cytoscape](https://cytoscape.org/) | تصور شبكات | مفتوح | TL-57aa7e4f | مكدس المشروع | P3 (عرض الرسم) |
| [D3.js](https://d3js.org/) | تصور بيانات | مفتوح | TL-677d9808 | مكدس المشروع | P3 |
| [Sigma.js](https://www.sigmajs.org/) | تصور شبكات | مفتوح | TL-cc86dc6a | في الخارطة | P3-005 |
| [Vis.js](https://visjs.org/) | تصور شبكات | مفتوح | TL-e3ea87fc | في الكتالوج | — |
| [Apache Superset](https://superset.apache.org/docs/api) | تصور بيانات | مفتوح | TL-9658f3d0 | في الكتالوج | — |
| [Metabase](https://www.metabase.com/) | تحليلات | مفتوح | TL-5c0bbb01 | في الكتالوج | — |
| [Redash](https://redash.io/help/user-guide/integrations-and-api/api) | استعلامات ولوحات | مفتوح | TL-41077766 | في الكتالوج | — |
| [Grafana](https://grafana.com/) | لوحات معلومات | مفتوح | TL-2a430edf | في الكتالوج | — |
| [Kibana](https://www.elastic.co/kibana/) | تصور بيانات | مفتوح | TL-06363582 | في الكتالوج | — |
| OpenSearch Dashboards | تصور بيانات | مفتوح | — | مرشح | — |
| [Puppeteer](https://github.com/puppeteer/puppeteer) | توليد PDF | مفتوح | TL-c6287e12 | مكدس المشروع | P5-027 |
| [Playwright](https://playwright.dev/docs/writing-tests) | توليد PDF | مفتوح | TL-70e07be6 | في الخارطة | P3-020، P5-027 |
| React-PDF | توليد PDF | مفتوح | — | في الخارطة | P5-027 |
| Typst | تنضيد | مفتوح | — | في الخارطة | P5-027 |
| LaTeX | تنضيد | مفتوح | — | مرشح | — |

### 40 أدوات التكامل والتشغيل البيني

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| OpenAPI | مواصفات API | مفتوح | — | في الخارطة | P2-019 |
| [GraphQL](https://graphql.bitquery.io/ide) | استعلام API | مفتوح | TL-c2b47216 | في الخارطة | P8-015 |
| gRPC | اتصال خدمات | مفتوح | — | مرشح | — |
| Webhooks | إشعارات | مفتوح | — | في الخارطة | P8-015 |
| STIX 2.1 | تبادل استخبارات التهديدات | مفتوح | — | في الخارطة | P4-014 |
| MISP Format | تبادل استخبارات التهديدات | مفتوح | — | مكدس المشروع | P4-022 |
| [GraphML](http://graphml.graphdrawing.org/) | تبادل الرسوم البيانية | مفتوح | TL-e1240e9e | في الخارطة | P4-015 |
| [GEXF](https://gexf.net) | تبادل الرسوم البيانية | مفتوح | TL-ebcf595b | في الخارطة | P4-015 |
| PROV-O | تتبع المصادر | مفتوح | — | مكدس المشروع | P4-015 |
| FtM | تتبع الأموال | مفتوح | — | في الخارطة | P4-013 |

## أدوات متخصصة ومتقدمة

### 41 أدوات SDR (Software Defined Radio)

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| [Gqrx](https://github.com/gqrx-sdr/gqrx) | مستقبل SDR | مفتوح | TL-d630855a | في الكتالوج | — |
| [SDR++](https://github.com/AlexandreRouma/SDRPlusPlus) | مستقبل SDR | مفتوح | TL-f9f530a2 | في الكتالوج | — |
| [Universal Radio Hacker](https://github.com/jopohl/urh) | تحليل بروتوكولات لاسلكية | مفتوح | TL-be7fe04c | في الكتالوج | — |
| [rtl_433](https://github.com/merbanan/rtl_433) | فك أجهزة ISM | مفتوح | TL-da3cbed8 | في الكتالوج | — |
| [SatDump](https://www.satdump.org/about/) | فك بيانات الأقمار | مفتوح | TL-f26fd03f | في الكتالوج | — |
| [Gpredict](https://github.com/csete/gpredict) | تتبع الأقمار | مفتوح | TL-4f45c027 | في الكتالوج | — |
| [Kismet](https://github.com/kismetwireless/kismet) | كشف الشبكات اللاسلكية | مفتوح | TL-6243998b | في الكتالوج | — |
| [dump1090](https://github.com/flightaware/dump1090) | فك ADS-B | مفتوح | TL-a97e6e01 | في الخارطة | P2-031 |
| [readsb](https://github.com/wiedehopf/readsb) | فك ADS-B | مفتوح | TL-4ec05284 | في الخارطة | P2-031 |
| [tar1090](https://github.com/wiedehopf/tar1090) | واجهة ADS-B | مفتوح | TL-cd0ecc2c | في الكتالوج | — |
| [AIS-catcher](https://github.com/jvde-github/AIS-catcher) | استقبال AIS | مفتوح | TL-334f16eb | في الخارطة | P2-031 |

### 42 أدوات التحليل الجنائي للهواتف

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| [Cellebrite](https://cellebrite.com/en/ufed/) | استخراج البيانات | مدفوع | TL-0e833743 | في الكتالوج | — |
| Magnet AXIOM | تحليل forensics | مدفوع | — | مرشح | — |
| Oxygen Forensic Detective | تحليل forensics | مدفوع | — | مرشح | — |
| Mobiledit | استخراج | مدفوع | — | مرشح | — |
| [ALEAPP](https://github.com/abrignoni/ALEAPP) | تحليل Android | مفتوح | TL-fb492fae | في الكتالوج | — |
| [iLEAPP](https://github.com/abrignoni/iLEAPP) | تحليل iOS | مفتوح | TL-0a165f65 | في الكتالوج | — |
| [Andriller](https://github.com/den4uk/andriller) | تحليل Android | مفتوح | TL-7112872f | في الكتالوج | — |
| [libimobiledevice](https://github.com/libimobiledevice/libimobiledevice) | أدوات iOS | مفتوح | TL-311f555b | في الكتالوج | — |

### 43 أدوات تحليل الشيفرة العكسية

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| [Ghidra](https://www.ghidra-sre.org/) | هندسة عكسية | مفتوح | TL-c60b05aa | في الكتالوج | — |
| [radare2](https://github.com/radareorg/radare2) | هندسة عكسية | مفتوح | TL-6c285bfb | في الكتالوج | — |
| IDA Free | هندسة عكسية | مجاني | — | مرشح | — |
| [Binary Ninja](https://binary.ninja/) | هندسة عكسية | مدفوع | TL-01c95fe0 | في الكتالوج | — |
| [x64dbg](https://github.com/x64dbg/x64dbg) | تصحيح | مفتوح | TL-6fedde23 | في الكتالوج | — |
| OllyDbg | تصحيح | مجاني | — | مرشح | — |
| [dnSpy](https://github.com/dnSpyEx/dnSpy) | تصحيح .NET | مفتوح | TL-cf96d385 | في الكتالوج | — |
| [JADX](https://github.com/skylot/jadx) | فك Android | مفتوح | TL-3c175fe8 | في الكتالوج | — |
| [apktool](https://github.com/iBotPeaches/Apktool) | فك APK | مفتوح | TL-8aa47cfb | في الكتالوج | — |

### 44 أدوات تحليل البرمجيات الخبيثة

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| [Cuckoo Sandbox](http://www.cuckoosandbox.org/) | تحليل آلي | مفتوح | TL-ca614ce8 | متوقف | مستودعه مؤرشف منذ 2021؛ البديل CAPEv2 ([مصدر](https://github.com/cuckoosandbox/cuckoo)) |
| [CAPE Sandbox](https://capesandbox.com/) | تحليل آلي | مفتوح | TL-e1f1c3ba | في الكتالوج | — |
| [Any.Run](https://any.run/) | تحليل تفاعلي | مجاني | TL-82fc63b9 | في الكتالوج | — |
| [Hybrid Analysis](https://hybrid-analysis.com/) | تحليل آلي | مجاني | TL-4dd7d00a | في الخارطة | TR-061 |
| [Joe Sandbox](https://www.joesandbox.com/) | تحليل آلي | مجاني | TL-1e862e5e | في الكتالوج | — |
| [Triage](https://tria.ge/reports/public) | تحليل آلي | مجاني | TL-62020870 | في الخارطة | TR-062 |
| [VirusTotal](https://www.virustotal.com/gui/) | تحليل متعدد | مجاني | TL-0eabcdf6 | في الخارطة | TR-043 |
| [Intezer](https://analyze.intezer.com/scan) | تحليل الشيفرة | مدفوع | TL-65c29a51 | في الكتالوج | — |
| [Malpedia](https://malpedia.caad.fkie.fraunhofer.de/) | موسوعة | مفتوح | TL-b276e68a | في الخارطة | TR-063 |

### 45 أدوات تحليل الشبكات المتقدمة

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| [Wireshark](https://www.wireshark.org/download.html) | تحليل الحزم | مفتوح | TL-e8dee90b | في الكتالوج | — |
| tcpdump | تحليل الحزم | مفتوح | — | مرشح | — |
| [Zeek](https://zeek.org/) | مراقبة الشبكة | مفتوح | TL-58e538e6 | في الكتالوج | — |
| [Suricata](http://suricata-ids.org/) | كشف التسلل | مفتوح | TL-86221e99 | في الكتالوج | — |
| [Snort](https://www.snort.org/) | كشف التسلل | مفتوح | TL-95823dda | في الكتالوج | — |
| [NetworkMiner](https://www.netresec.com/?page=Networkminer) | تحليل الشبكة | مفتوح | TL-c2a28974 | في الكتالوج | — |
| [Ntopng](http://www.ntop.org/products/traffic-analysis/ntop/) | مراقبة الشبكة | مفتوح | TL-95592193 | في الكتالوج | — |
| [Arkime](https://github.com/arkime/arkime) | تحليل الحزم | مفتوح | TL-7da6a0b3 | في الكتالوج | — |
| [Moloch](https://github.com/aol/moloch) | تحليل الحزم | مفتوح | TL-7f78b6b4 | في الكتالوج | — |

### 46 أدوات تحليل السجلات

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| Elastic Stack | تحليل السجلات | مفتوح | — | مرشح | — |
| [Splunk](https://www.splunk.com/) | تحليل السجلات | مدفوع | TL-a1f4a991 | في الخارطة | P8-012 |
| [Graylog](https://github.com/Graylog2/graylog2-server) | تحليل السجلات | مفتوح | TL-aca35d65 | في الكتالوج | — |
| [Loki](https://github.com/Neo23x0/Loki) | تسجيل | مفتوح | TL-5b986bf1 | في الكتالوج | — |
| Fluentd | جمع السجلات | مفتوح | — | مرشح | — |
| Filebeat | شحن السجلات | مفتوح | — | مرشح | — |
| Logstash | معالجة السجلات | مفتوح | — | مرشح | — |
| [Vector](https://github.com/thesaderror/vector) | معالجة السجلات | مفتوح | TL-1134e4a9 | في الكتالوج | — |

## الحماية والخصوصية

### 47 أدوات التشفير

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| [GnuPG](https://gnupg.org/) | تشفير | مفتوح | TL-8d0a879d | في الكتالوج | — |
| OpenSSL | تشفير | مفتوح | — | مكدس المشروع | P1-015 |
| libsodium | تشفير | مفتوح | — | مكدس المشروع | خزنة المفاتيح P1-015 |
| age | تشفير حديث | مفتوح | — | مكدس المشروع | تشفير الحزم P4-016 |
| VeraCrypt | تشفير الأقراص | مفتوح | — | مرشح | — |
| LUKS | تشفير Linux | مفتوح | — | مرشح | — |
| BitLocker | تشفير Windows | مجاني | — | مرشح | — |
| FileVault | تشفير macOS | مجاني | — | مرشح | — |

### 48 أدوات إدارة الأسرار

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| HashiCorp Vault | إدارة الأسرار | مفتوح | — | مرشح | — |
| [Bitwarden](https://bitwarden.com/help/api/) | إدارة كلمات المرور | مفتوح | TL-8bc69e79 | في الكتالوج | — |
| KeePassXC | إدارة كلمات المرور | مفتوح | — | مرشح | — |
| 1Password | إدارة كلمات المرور | مدفوع | — | مرشح | — |
| [SOPS](https://github.com/mozilla/sops) | تشفير الملفات | مفتوح | TL-8f054ebe | في الكتالوج | — |
| Sealed Secrets | أسرار Kubernetes | مفتوح | — | مرشح | — |

### 49 أدوات الخصوصية

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| [Tor](https://tor.link) | شبكة مجهولة | مفتوح | TL-7ca1365e | في الخارطة | P2-028 |
| [Tails](https://tails.net/) | نظام تشغيل مجهول | مفتوح | TL-58408a87 | في الكتالوج | — |
| [Whonix](https://www.whonix.org) | نظام تشغيل مجهول | مفتوح | TL-31ae5137 | في الكتالوج | — |
| [Qubes OS](https://www.qubes-os.org/) | نظام تشغيل آمن | مفتوح | TL-0b3ad9f4 | في الكتالوج | — |
| [MAT2](https://github.com/jvoisin/mat2) | تنقية البيانات الوصفية | مفتوح | TL-ec38b6ce | في الكتالوج | — |
| [ExifCleaner](https://github.com/szTheory/exifcleaner) | إزالة البيانات الوصفية | مفتوح | TL-900dc7ae | في الكتالوج | — |
| [OONI Probe](https://ooni.org/install/) | قياس الرقابة | مفتوح | TL-5159f26d | في الكتالوج | — |
| Privacy Badger | حماية المتصفح | مفتوح | — | مرشح | — |

## الذكاء الاصطناعي

### 50 نماذج LLM للتشغيل المحلي

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| Llama | 3 نموذج مفتوح من Meta | مفتوح | — | مرشح | — |
| [Mistral](https://mistral.ai/) | نموذج مفتوح | مفتوح | TL-6766bb68 | في الكتالوج | — |
| Qwen | نموذج مفتوح من Alibaba | مفتوح | — | مرشح | — |
| Gemma | نموذج من Google | مفتوح | — | مرشح | — |
| Phi | نموذج من Microsoft | مفتوح | — | مرشح | — |
| [DeepSeek](https://www.deepseek.com/) | نموذج مفتوح | مفتوح | TL-958fa6cc | في الكتالوج | — |
| Falcon | نموذج من TII | مفتوح | — | مرشح | — |
| Yi | نموذج من 01.AI | مفتوح | — | مرشح | — |

### 52 أدوات RAG (Retrieval Augmented Generation)

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| LlamaIndex | إطار RAG | مفتوح | — | مرشح | — |
| LangChain | إطار RAG | مفتوح | — | مرشح | — |
| Haystack | إطار RAG | مفتوح | — | مرشح | — |
| Chroma | قاعدة بيانات متجهات | مفتوح | — | مكدس المشروع | P5-020 |
| Pinecone | قاعدة بيانات متجهات | مدفوع | — | مرشح | — |
| [Weaviate](https://github.com/semi-technologies/weaviate) | قاعدة بيانات متجهات | مفتوح | TL-ccd4d5ad | في الكتالوج | — |
| Qdrant | قاعدة بيانات متجهات | مفتوح | — | مكدس المشروع | P5-020 |
| Milvus | قاعدة بيانات متجهات | مفتوح | — | مرشح | — |
| FAISS | بحث تشابه | مفتوح | — | مكدس المشروع | P5-020 |

### 53 أدوات تحليل المشاعر والتصنيف

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| Hugging Face Transformers | نماذج متعددة | مفتوح | — | مرشح | — |
| VADER | تحليل المشاعر | مفتوح | — | مرشح | — |
| TextBlob | تحليل النصوص | مفتوح | — | مرشح | — |

### 54 أدوات تحليل الصور بالذكاء الاصطناعي

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| Google Vision | API تحليل الصور | مدفوع | — | مرشح | — |
| AWS Rekognition | تحليل الصور | مدفوع | — | مرشح | — |
| Azure Vision | تحليل الصور | مدفوع | — | مرشح | — |
| [Clarifai](https://docs.clarifai.com/api-guide/api-overview) | تحليل الصور | مدفوع | TL-1f90e009 | في الكتالوج | — |
| OpenCV | رؤية حاسوبية | مفتوح | — | مرشح | — |
| YOLO | كشف الأشياء | مفتوح | — | مرشح | — |
| [Detectron2](https://github.com/facebookresearch/detectron2) | كشف الأشياء | مفتوح | TL-2cdabd06 | في الكتالوج | — |
| [Segment Anything](https://github.com/facebookresearch/segment-anything) | تجزئة الصور | مفتوح | TL-9591ac53 | في الكتالوج | — |

## الإدارة والتعاون

### 55 أدوات إدارة الحالة والقضايا

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| [TheHive](https://thehive-project.org/) | إدارة الحوادث | مدفوع | TL-02233eff | في الخارطة | P8-012 |
| [DFIR IRIS](https://github.com/dfir-iris/iris-web) | إدارة التحقيقات | مفتوح | TL-8017ef27 | في الكتالوج | — |
| Casebox | إدارة القضايا | مفتوح | — | مرشح | — |
| [RTIR](https://www.bestpractical.com/rtir/) | إدارة الحوادث | مفتوح | TL-6bed4a74 | في الكتالوج | — |
| [OpenCTI](https://github.com/OpenCTI-Platform/opencti) | إدارة المعرفة | مفتوح | TL-1d3bd937 | في الخارطة | P8-012 |

### 56 أدوات التعاون

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| [Mattermost](https://api.mattermost.com/) | تعاون الفريق | مفتوح | TL-48716c21 | في الكتالوج | — |
| Rocket.Chat | تعاون الفريق | مفتوح | — | مرشح | — |
| Element/Matrix | تعاون مشفر | مفتوح | — | مرشح | — |
| Nextcloud | تخزين وتعاون | مفتوح | — | مرشح | — |
| CryptPad | تعاون مشفر | مفتوح | — | مرشح | — |
| HedgeDoc | تحرير تعاوني | مفتوح | — | مرشح | — |

### 57 أدوات التوثيق والمعرفة

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| Obsidian | قاعدة معرفة | مفتوح | — | مرشح | — |
| Logseq | قاعدة معرفة | مفتوح | — | مرشح | — |
| [Notion](https://developers.notion.com/docs/getting-started) | توثيق | مدفوع | TL-5341f9c2 | في الكتالوج | — |
| Confluence | توثيق | مدفوع | — | مرشح | — |
| BookStack | توثيق | مفتوح | — | مرشح | — |
| Wiki.js | ويكي | مفتوح | — | مرشح | — |
| Docusaurus | موقع توثيق | مفتوح | — | مرشح | — |
| VitePress | موقع توثيق | مفتوح | — | مرشح | — |

### 58 أدوات إدارة المهام

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| [Jira](https://developer.atlassian.com/server/jira/platform/rest-apis/) | إدارة المشاريع | مدفوع | TL-98428db8 | في الخارطة | P8-013 |
| Linear | إدارة المهام | مدفوع | — | مرشح | — |
| GitHub Issues | تتبع المهام | مفتوح | — | مرشح | — |
| GitLab Issues | تتبع المهام | مفتوح | — | مرشح | — |
| Kanboard | إدارة المهام | مفتوح | — | مرشح | — |
| Vikunja | إدارة المهام | مفتوح | — | مرشح | — |
| Focalboard | إدارة المهام | مفتوح | — | مرشح | — |

## تحليلات متخصصة إضافية

### 59 أدوات تحليل البريد الإلكتروني

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| [h8mail](https://github.com/khast3x/h8mail) | بحث في التسريبات | مفتوح | TL-08251bf9 | في الكتالوج | — |
| [Mosint](https://github.com/alpkeskin/mosint) | استخبارات البريد | مفتوح | TL-4fcfb90e | في الكتالوج | — |
| [EmailHarvester](https://github.com/4383/EmailHarvester) | جمع البريد | مفتوح | TL-233d2f31 | في الكتالوج | — |
| [theHarvester](https://github.com/laramies/theHarvester) | جمع البريد | مفتوح | TL-37502490 | في الخارطة | P8-024 |
| [Hunter.io](https://hunter.io/) | البحث عن البريد | مجاني | TL-fb0a6404 | في الكتالوج | — |
| [Emailrep.io](https://emailrep.io/) | سمعة البريد | مجاني | TL-ca47d6e2 | في الكتالوج | — |
| [Holehe](https://github.com/megadose/holehe) | التحقق من التسجيل | مفتوح | TL-f8349c83 | مستبعد | يستنتج الحسابات بإساءة استعمال مسارات التسجيل لدى أطراف ثالثة وقد ينبّه صاحبها (14.7) |
| [GHunt](https://github.com/mxrch/GHunt) | OSINT من Google | مفتوح | TL-1c664653 | مستبعد | يتطلب جلسة Google ويستهدف حساب شخص (14.7) |

### 60 أدوات تحليل الهاتف

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| [PhoneInfoga](https://github.com/sundowndev/PhoneInfoga) | تحليل الهاتف | مفتوح | TL-27f63d61 | في الكتالوج | — |
| [Numverify](https://numverify.com?utm_source=Github&utm_medium=Referral&utm_campaign=Public-apis-repo-Best-sellers) | التحقق | مجاني | TL-2c455238 | في الكتالوج | — |
| [AbstractAPI](https://www.abstractapi.com/vat-validation-rates-api) | التحقق | مجاني | TL-7fe79598 | في الكتالوج | — |
| [Twilio Lookup](https://www.twilio.com/lookup) | معلومات | مدفوع | TL-42abb54f | في الكتالوج | — |
| [libphonenumber](https://github.com/google/libphonenumber) | تحليل الأرقام | مفتوح | TL-97e7d609 | في الخارطة | TR-036 |

### 61 أدوات تحليل النطاقات

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| [Amass](https://github.com/owasp-amass/amass) | اكتشاف سطح الهجوم | مفتوح | TL-37c02af1 | في الخارطة | P8-024، TR-079 |
| [Subfinder](https://github.com/projectdiscovery/subfinder) | نطاقات فرعية | مفتوح | TL-32d063d2 | في الكتالوج | — |
| [Sublist3r](https://github.com/aboul3la/Sublist3r) | نطاقات فرعية | مفتوح | TL-e8f0dea8 | في الكتالوج | — |
| [Findomain](https://github.com/Findomain/Findomain) | نطاقات فرعية | مفتوح | TL-ce3268a4 | في الخارطة | TR-079 |
| [dnsx](https://github.com/projectdiscovery/dnsx) | أدوات DNS | مفتوح | TL-5fd295f5 | في الكتالوج | — |
| [MassDNS](https://github.com/blechschmidt/massdns) | DNS سريع | مفتوح | TL-a0b1a4dd | في الكتالوج | — |
| [dnstwist](https://dnstwist.it/) | نطاقات مشابهة | مفتوح | TL-34991975 | في الكتالوج | — |
| [dnsrecon](https://github.com/darkoperator/dnsrecon) | استطلاع DNS | مفتوح | TL-bce1b82e | في الكتالوج | — |
| [theHarvester](https://github.com/laramies/theHarvester) | جمع | مفتوح | TL-37502490 | في الخارطة | P8-024 |

### 62 أدوات تحليل IP

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| [Shodan](https://www.shodan.io/) | بحث الأجهزة | مجاني | TL-0cba9f15 | في الخارطة | TR-008، TR-054 |
| [Censys](https://censys.io/) | بحث الإنترنت | مجاني | TL-96019d2b | في الخارطة | TR-049 |
| [IPinfo](https://ipinfo.io/) | معلومات IP | مجاني | TL-9c90fd6a | في الخارطة | TR-007 |
| [IPGeolocation](https://www.abstractapi.com/ip-geolocation-api) | تحديد الموقع | مجاني | TL-8943c4a6 | في الكتالوج | — |
| [MaxMind](https://www.maxmind.com/en/home) | قواعد بيانات | مدفوع | TL-a83c923a | في الكتالوج | — |
| [RIPEstat](https://stat.ripe.net/) | إحصاءات | مجاني | TL-204227a7 | في الخارطة | TR-005 |
| [PeeringDB](https://www.peeringdb.com/advanced_search) | تصيير | مجاني | TL-451fbd29 | في الخارطة | TR-071 |

### 63 أدوات تحليل الثغرات

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| [Nuclei](https://github.com/projectdiscovery/nuclei) | فحص الثغرات | مفتوح | TL-05352f76 | في الكتالوج | — |
| [Nmap](https://nmap.org/) | مسح المنافذ | مفتوح | TL-6578b10d | في الكتالوج | — |
| [OpenVAS](http://www.openvas.org/) | فحص الثغرات | مفتوح | TL-a9642637 | في الكتالوج | — |
| [Nessus](https://www.tenable.com/products/nessus) | فحص الثغرات | مدفوع | TL-25db557f | في الكتالوج | — |
| Qualys | فحص الثغرات | مدفوع | — | مرشح | — |
| Rapid7 InsightVM | فحص الثغرات | مدفوع | — | مرشح | — |

### 64 أدوات الاستجابة للحوادث

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| [Velociraptor](https://github.com/Velocidex/velociraptor) | استجابة | مفتوح | TL-bd6521f2 | في الكتالوج | — |
| [GRR](https://github.com/google/grr) | استجابة | مفتوح | TL-ba23100c | في الكتالوج | — |
| [Osquery](https://github.com/osquery/osquery) | استعلام | مفتوح | TL-77be25b9 | في الكتالوج | — |
| [Wazuh](https://wazuh.com/) | كشف واستجابة | مفتوح | TL-a91d99ef | في الكتالوج | — |
| [Sigma](https://github.com/SigmaHQ/sigma) | قواعد كشف | مفتوح | TL-5134d5c8 | في الخارطة | P3-005، P4-021 |
| [YARA](https://github.com/VirusTotal/yara) | قواعد كشف | مفتوح | TL-54a83925 | في الخارطة | P4-021، TR-063 |
| [TheHive](https://thehive-project.org/) | إدارة | مدفوع | TL-02233eff | في الخارطة | P8-012 |
| Cortex | تحليل | مفتوح | — | في الخارطة | P8-012 |

### 65 أدوات SOAR (Security Orchestration, Automation, and Response)

| الأداة | الوظيفة | الترخيص | الكتالوج | الحالة | في الخارطة / ملاحظة |
|---|---|---|---|---|---|
| [Shuffle SOAR](https://github.com/Shuffle/Shuffle) | مفتوح | مفتوح | TL-4ed276f1 | في الكتالوج | — |
| [n8n](https://github.com/n8n-io/n8n) | أتمتة | مفتوح | TL-ba28d566 | في الكتالوج | — |
