> المصدر: `docs/ROADMAP2.md` — مصنّف حسب المجال التحليلي (2026-10-10).

# علم كسر الشفرات (Cryptanalysis)
1. أساليب التحليل الكلاسيكية

الاسم الإنجليزي ما تفعله فعلاً
التحليل التفاضلي Differential Cryptanalysis يهاجم خوارزميات ضعيفة التصميم (DES القديم)
التحليل الخطي Linear Cryptanalysis مماثل، يبحث عن علاقات خطية في S-Boxes
التحليل التكاملي Integral Cryptanalysis للشبكات التي تعتمد على XOR
التحليل الجبري Algebraic Cryptanalysis يحول المشكلة إلى معادلات
هجوم اللقاء في المنتصف Meet-in-the-Middle Attack يهاجم مفتاحين بذاكرة كبيرة
هجوم القوة الغاشمة Brute Force Attack لا عملي ضد AES-256
هجوم القاموس Dictionary Attack ضد كلمات مرور ضعيفة
هجوم قوس قزح Rainbow Table Attack ضد hashes غير مملّحة
هجوم Colision Collision Attack لكشف تصادمات في دوال التجزئة

2. الهجمات على تنفيذ التشفير (Implementation Attacks)

هذه الأكثر شيوعاً فعلياً — لا تكسر التشفير نفسه، بل كسره عند تنفيذه بشكل خاطئ.

الاسم الهدف
هجوم القناة الجانبية Side-Channel Attack
هجوم التوقيت Timing Attack
هجوم استهلاك الطاقة Power Analysis Attack
تحليل الطاقة البسيط Simple Power Analysis (SPA)
تحليل الطاقة التفاضلي Differential Power Analysis (DPA)
هجوم الإشعاع الكهرومغناطيسي Electromagnetic Attack
هجوم الصوت Acoustic Cryptanalysis
هجوم الحرارة Thermal Attack
هجوم التجويع Fault Injection Attack
هجوم الجهد Voltage Glitching
هجوم الساعة Clock Glitching
هجوم الليزر Laser Fault Injection
هجوم Rowhammer يقلب البتات في الذاكرة
هجوم Cache Timing يستغل الكاش
هجوم Spectre يستغل التنفيذ التنبؤي
هجوم Meltdown يقرأ ذاكرة النواة

3. الهجمات على البروتوكولات

الاسم ما تهاجمه
Padding Oracle Attack تنفيذات خاطئة لـ CBC
Lucky Thirteen TLS CBC
BEAST TLS 1.0
CRIME ضغط TLS
BREACH ضغط HTTP
POODLE SSL 3.0
DROWN SSLv2
Heartbleed OpenSSL
FREAK تصدير قديم
Logjam Diffie-Hellman ضعيف
Sweet32 3DES
ROBOT RSA PKCS#1 v1.5
Bleichenbacher RSA
ROCA مفتاح RSA ضعيف
CurveBall شهادات Windows
KRACK WPA2
Dragonblood WPA3
TunnelVision توجيه DHCP لاعتراض VPN
Kaspersky Operation Triangulation iOS hardware

4. هجمات على الشهادات وPKI

الاسم الوصف
MITM Man in the Middle
SSL Stripping تخفيض HTTPS إلى HTTP
Certificate Spoofing تزوير شهادة
CA Compromise اختراق CA
Rogue CA CA مزيفة
Certificate Transparency Attack استغلال CT
Downgrade Attack تخفيض الإصدار

---

