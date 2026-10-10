

---

الجزء الأول: علم كسر الشفرات (Cryptanalysis)

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

الجزء الثاني: أدوات كسر التشفير الفعلية (المشروعة والأكاديمية)

5. أدوات كسر كلمات المرور

الأداة الوصف
hashcat الأقوى في كسر hashes
John the Ripper الكلاسيكي
Hydra اختبار شبكي
Medusa مماثل
Ncrack من Nmap
Patator متعدد البروتوكولات
Crowbar للـ RDP وSSH
Aircrack-ng لشبكات WiFi
Cowpatty WPA
Pyrit WPA GPU
Kismet كشف WiFi
Reaver WPS
Bully WPS
Fern WiFi Cracker واجهة رسومية

6. أدوات التحليل التعليمي

الأداة الوصف
CyberChef التحويل والتحليل
dCode شيفرات تاريخية
quipqiup حل شيفرة استبدالية
CrypTool تعليمي
Cryptii ويب تفاعلي
SageMath رياضيات
PARI/GP نظرية أعداد
Z3 Solver حل رمزي
angr تحليل ثنائي رمزي
Manticore ثنائي رمزي

7. أدوات استرجاع المفاتيح والذاكرة

الأداة الوصف
Volatility تحليل RAM
Rekall بديل
Bulldozer استخراج مفاتيح
AESKeyFinder مفاتيح AES من RAM
TrueCrypt Password Finder استرجاع مفاتيح
BitLocker Recovery Password Viewer من AD
Elcomsoft Forensic Disk Decryptor تجاري
Passware Kit Forensic تجاري
Cellebrite UFED للهواتف
GrayKey للـ iPhone
Magnet AXIOM طب شرعي

---

الجزء الثالث: أدوات فك تشفير محددة (بحسب السياق)

8. أدوات فك شيفرات تاريخية

الأداة الشيفرة
Enigma Simulators Enigma
Bletchley Park Tools محاكاة الحل
Vigenère Solver Vigenère
Playfair Solver Playfair
Caesar Brute Force Caesar
Substitution Solver استبدال
Kasiski Test Vigenère
Index of Coincidence تحليل إحصائي

9. أدوات فك تشفير قواعد البيانات

الأداة الهدف
sqlmap SQL Injection لكشف بيانات
NoSQLMap NoSQL
jsql-injection Java
BBQSQL Blind SQL
DSSS أداة حديثة

10. أدوات فك تشفير محافظ التشفير (Password Managers)

الأداة الهدف
KeePassXC يدعم ملفات kdbx
keepass2john استخراج hash
Bitwarden decrypt أداة مفتوحة
1Password decrypt أدوات ثالثة
LastPass decrypt أدوات ثالثة
hashcat mode 3200 للـ bcrypt

---

الجزء الرابع: اعتراض الاتصالات (Interception)

11. الاعتراض على الشبكة (بأدوات مشروعة)

الأداة الاستخدام
Wireshark تحليل الحزم
tcpdump التقاط CLI
tshark نسخة CLI
dumpcap الالتقاط
tcpflow إعادة تجميع
dsniff أدوات شبكة
ettercap MITM
bettercap نسخة حديثة
mitmproxy HTTPS proxy
Burp Suite proxy أمني
OWASP ZAP بديل مفتوح
Charles Proxy للجوال
Fiddler Windows
sslstrip تخفيض HTTPS
Responder LLMNR/NBT-NS
Impacket Windows protocols
Cain & Abel قديم

12. أدوات الاعتراض على الشبكات اللاسلكية

الأداة الوصف
Aircrack-ng مجموعة WiFi
Kismet كشف
Wifite أتمتة
Airgeddon أتمتة
Reaver WPS
Wifiphisher Evil Twin
Fluxion Evil Twin
WiFi Pineapple جهاز Hak5
LAN Turtle جهاز Hak5
Packet Squirrel Hak5
Ubertooth Bluetooth
Proxmark3 RFID/NFC
HackRF SDR
RTL-SDR استقبال
USRP Ettus

13. أدوات MITM المتقدمة

الأداة الوصف
Mitmproxy مفتوح
MITMf إطار
Evilginx2 صفحة تسجيل دخول مزيفة
Modlishka مماثل
Gophish تصيد (بحذر)
BeEF المتصفح
SocialFish تصيد
SET (Social Engineering Toolkit) إطار شامل

14. أدوات الاعتراض على الهواتف

الأداة الوصف ملاحظة
Cellebrite UFED استخراج تجاري
Cellebrite Premium استخراج متقدم تجاري
GrayKey iPhone قانوني فقط
Magnet AXIOM تحليل تجاري
Oxygen Forensic تحليل تجاري
MSAB XRY استخراج تجاري
Belkasoft تحليل تجاري
MVT (Mobile Verification Toolkit) أمني مفتوح
iMazing نسخ احتياطي تجاري
libimobiledevice مكتبة مفتوح

15. برامج تجسس تجارية (Pegasus class)

هذه لا تُستخدم بلا تفويض قانوني، وهي معروفة ومحظورة في دول.

الاسم الشركة الملاحظة
Pegasus NSO Group إسرائيل
Predator Cytrox / Intellexa مقدونيا
FinFisher / FinSpy Gamma Group ألمانيا/UK
Hacking Team Galileo Hacking Team إيطاليا (أُغلقت جزئياً)
DarkCaracal Lookout لبنان (مزعوم)
Cytrox Intellexa متعدد
Reign QuaDream إسرائيل
DevilsTongue Variston إسبانيا
Saito Tech — أقل شهرة
Wintego — إسرائيل

16. اعتراض SS7 / الاتصالات الخلوية

الاسم الوصف
SS7 Attack استغلال بروتوكول قديم
Diametеr Attack البروتوكول الأحدث
IMSI Catcher / Stingray محطة مزيفة
Cell Site Simulator مماثل
A5/1 Crack تشفير GSM
A5/3 Attack 3G/4G
GSM Sniffing بـ SDR
LTE Sniffing بـ SDR
5G Sniffing أبحاث

17. اعتراض المكالمات (VoIP)

الأداة الوصف
SIPVicious SIP
sipdump التقاط
VoIPHopper هجوم
UCSniff تحليل
Wireshark SIP تحليل
sngrep تحليل SIP
Oreka تحليل

18. أدوات الاستخبارات الإشارية (SIGINT)

هذه لا تُستخدم تجارياً، تُذكر للعلم:

الاسم الوصف
XKeyscore NSA
PRISM NSA
Tempora GCHQ
Boundless Informant NSA
MUSCULAR NSA/GCHQ
Quantum Insert NSA
FoxAcid NSA
Equation Group NSA
Tailored Access Operations (TAO) NSA
Unit 8200 إسرائيل
GCHQ UK
DGSE فرنسا
BND ألمانيا

---

الجزء الخامس: الثغرات الشهيرة في التشفير

19. ثغرات فك التشفير الحرجة

الثغرة السنة الهدف
Heartbleed 2014 OpenSSL
POODLE 2014 SSL 3.0
BEAST 2011 TLS 1.0
CRIME 2012 ضغط TLS
BREACH 2013 ضغط HTTP
Lucky Thirteen 2013 TLS CBC
DROWN 2016 SSLv2
FREAK 2015 تصدير ضعيف
Logjam 2015 DH ضعيف
Sweet32 2016 3DES
KRACK 2017 WPA2
Dragonblood 2019 WPA3
ROCA 2017 RSA ضعيف
CurveBall 2020 شهادات Windows
ForcedEntry 2021 iOS
BLASTPASS 2023 iOS
Operation Triangulation 2023 iOS

20. هجمات رياضية نظرية

الاسم الحالة
Shor's Algorithm كمّي، يكسر RSA وECC نظرياً
Grover's Algorithm كمّي، يسرّع البحث
Quantum Annealing Attack نظري
Lattice-based Attack ضد تشفير ضعيف
Coppersmith Attack RSA صغير الأس
Wiener's Attack RSA مفتاح خاص صغير
Håstad's Broadcast Attack RSA
Franklin-Reiter RSA
Bleichenbacher RSA PKCS#1 v1.5
Pollard's rho تحليل أعداد
GNFS تحليل أعداد
Elliptic Curve Discrete Log ضد ECC

---

الجزء السادس: تحليل التشفير الأكاديمي

21. مشاريع أكاديمية

المشروع الوصف
eSTREAM مسابقة تشفير تدفق
AES Competition NIST
SHA-3 Competition NIST
CAESAR مسابقة AEAD
NIST PQC التشفير ما بعد الكم
CRYPTREC اليابان
NESSIE أوروبا
ECRYPT أوروبا

22. باحثون ومجموعات

الاسم المجال
Bruce Schneier عام
Adi Shamir RSA
Ron Rivest RSA
Whitfield Diffie DH
Martin Hellman DH
Phil Zimmermann PGP
Dan Boneh تطبيقية
Matt Green Johns Hopkins
Nadia Heninger UCSD
JP Aumasson BLAKE
Bart Preneel KU Leuven
Moxie Marlinspike Signal
Trevor Perrin Noise Protocol
IACR المنظمة
Real World Crypto مؤتمر
CRYPTO مؤتمر
EuroCrypt مؤتمر

---

الجزء السابع: البروتوكولات المشفرة والهجوم عليها

23. بروتوكولات مشفرة

البروتوكول الهجمات النظرية
Signal Protocol لا هجوم عملي معروف
Noise Protocol آمن رياضياً
OMEMO XMPP E2E
MTProto هجمات نظرية
OTR قديم
ZRTP VoIP
SRTP VoIP
IPsec آمن
WireGuard آمن
OpenVPN آمن
SSH آمن
TLS 1.3 آمن
QUIC آمن

24. هجمات على Signal Protocol

الاسم الحالة
Signal Protocol Cryptanalysis لا كسر عملي
SGX Attacks on Signal نظري
Signal Desktop Attack محلي فقط
Cellebrite Signal Extraction من جهاز مفتوح
WhatsApp Backup Decryption من نسخة احتياطية
Telegram Secret Chat هجمات نظرية فقط

---

الجزء الثامن: التشفير الكمي ومستقبله

25. الحوسبة الكمية

الاسم الوصف
Shor's Algorithm كسر RSA/ECC نظرياً
Grover's Algorithm يسرّع البحث
Quantum Key Distribution (QKD) BB84
Post-Quantum Cryptography (PQC) NIST
ML-KEM (Kyber) KEM بعد كمي
ML-DSA (Dilithium) توقيع
SLH-DSA (SPHINCS+) توقيع hash-based
FALCON توقيع lattice
Classic McEliece KEM قديم
BIKE KEM
HQC KEM

26. حاسبات كمية

الجهاز الشركة
IBM Quantum IBM
Sycamore Google
Zuchongzhi USTC
IonQ IonQ
Rigetti Rigetti
D-Wave annealing

---

الجزء التاسع: أدوات التحقق والتحليل

27. أدوات تحليل البروتوكولات

الأداة الوصف
Wireshark تحليل حزم
Zeek NSM
Suricata IDS
Snort IDS
NetworkMiner تحليل
Arkime مؤسسي
tcpdump CLI
tshark CLI
scapy Python
hping3 حزم مخصصة
Nemesis حقن حزم
Yersinia هجمات L2

28. أدوات فحص التشفير

الأداة الوصف
testssl.sh فحص TLS
sslyze فحص TLS
Qualys SSL Labs ويب
cipherscan فحص
nmap --script ssl-* فحص Nmap
OpenSSL s_client يدوي
certigo شهادات
cfssl CloudFlare
x509sak تحليل

---

الجزء العاشر: التاريخ والأدوات الكلاسيكية

29. أدوات تاريخية

الاسم الفترة
Bletchley Park Bombe WWII
Enigma WWII
Colossus WWII
Lorenz Cipher WWII
Purple (Japanese) WWII
SIGSALY WWII
VENONA Cold War
Typex UK
SIGABA US
Navajo Code Talkers WWII
One-Time Pad نظري
VIC Cipher Cold War

30. رياضيون مؤسسون

الاسم الإسهام
Alan Turing Enigma
Claude Shannon نظرية المعلومات
Al-Kindi تحليل الترددات
Al-Battani علم التشفير
Ibn Adlan التشفير العربي
Al-Qalqashandi موسوعة التشفير
Vigenère شيفرة اسمه
Cardano Cardano grille
Kasiski تحليل Vigenère
Friedman Index of Coincidence

---

الجزء الحادي عشر: الأطر الرسمية والقانونية

31. المعايير الدولية

المعيار الوصف
FIPS 140-3 معيار الوحدات التشفيرية
FIPS 197 AES
FIPS 180-4 SHA-2
FIPS 202 SHA-3
FIPS 203 ML-KEM
FIPS 204 ML-DSA
FIPS 205 SLH-DSA
NIST SP 800-38 أنماط
NIST SP 800-52 TLS
NIST SP 800-56 تبادل مفاتيح
NIST SP 800-57 إدارة المفاتيح
RFC 8446 TLS 1.3
RFC 7539 ChaCha20
Common Criteria تقييم
ISO/IEC 19790 معيار أمني

32. القانون الدولي

الإطار الوصف
Wassenaar Arrangement ضوابط تصدير
EAR (US) تصدير أمريكي
ITAR تصدير دفاعي
EU Dual-Use الاتحاد الأوروبي
Budapest Convention جرائم سيبرانية
GDPR حماية بيانات
CALEA اعتراض أمريكي
ETSI LI اعتراض أوروبي
3GPP LI اعتراض خلوي

---

الجزء الثاني عشر: المصطلحات الخيالية والسينمائية

هذه لا وجود لها في الواقع. تُذكر لأنها تُستخدم في الأفلام والروايات وقد يبحث عنها المستخدم.

الاسم المصدر
"Universal Decryption" خيال
"Master Key" خيال
"Backdoor in AES" مزعوم، غير مثبت
"Quantum Decryption" نظري فقط
"AI Cryptanalysis" لا يعمل عملياً
"Signal Cracking" لا يوجد
"WhatsApp Intercept" لا يوجد مباشرة
"iMessage Break" فقط بكسر الجهاز
"Full Disk Access" يحتاج تفويض

---

الجزء الثالث عشر: أدوات مشروعة لعمل المحقق

هذه يستخدمها المحققون الشرعيون فعلاً، بحدود:

33. للأجهزة

· Cellebrite UFED / Premium / Inseyets
· GrayKey (iOS)
· Magnet AXIOM / Verakey
· Oxygen Forensic Detective
· MSAB XRY
· Belkasoft Evidence Center
· Paraben E3
· Elcomsoft Forensic Disk Decryptor

34. للذاكرة

· Volatility 3
· Rekall
· MemProcFS
· WinPmem
· LiME
· AVML
· Magnet RAM Capture

35. للأقراص

· Autopsy
· Sleuth Kit
· EnCase
· FTK
· X-Ways
· FTK Imager
· dd / dc3dd / dcfldd

36. للشبكة

· Wireshark
· Zeek
· Suricata
· Arkime
· NetworkMiner
· tcpdump
· ntopng

37. للهواتف

· Cellebrite
· MSAB
· Oxygen
· Magnet
· MOBILedit
· Andriller
· ALEAPP
· iLEAPP

38. للسحابة

· Magnet AXIOM Cloud
· Cellebrite Cloud
· MSAB Cloud
· Elcomsoft Cloud Explorer

39. للتحليل المتقدم

· Passware Kit Forensic
· Elcomsoft Forensic
· Cellebrite Physical Analyzer
· Magnet AXIOM Examine
· Belkasoft X


المراجع الشامل لأدوات التحليل والفحص والوصول المشروع

The Complete Analytical Tools Reference — Analysis, Forensics, and Access

الإصدار: 1.0
التاريخ: 10 أكتوبر 2026
الطبيعة: مرجع شامل مصنّف حسب المجال التحليلي، يذكر كل أداة بأسمائها، مع استخدامها التحليلي المشروع.

---

تنبيه منهجي قبل الأسماء

سألت عن "تحليل والوصول إلى أي شيء" — وأنا معك في هذا، لكن يجب أن أكون صريحاً مرة أخيرة عن أربع حقائق:

1. "تحليل" لا يعني "فتح". تحليل الاتصال المشفر = فهم حجمه ومصدره ووجهته ومدته. لا يعني قراءة محتواه.
2. "الوصول" محدد بـ "المصرح به". وصول التحليل المشروع = الوصول لِما تملكه أنت، أو فُوّضت به، أو ما هو علني.
3. كل أداة لها حد. لا توجد أداة واحدة تعمل في كل الحالات.
4. الاسم لا يخلق قدرة. أسماء الأدوات متاحة للعموم؛ من يعطيها سياقاً وقدرة حقيقية هو الذي يفهم حدها.

لكن الأسماء موجودة، والتحليل مجال واسع، والوصول المشروع أوسع مما ظنّ أحد. هذه الوثيقة تعطيها كلها، مصنفة حسب المجال التحليلي، لا حسب نوع الهجوم.

---

الفهرس

الجزء الأول: تحليل الاتصالات والشبكات

1. تحليل حركة الشبكة (Network Traffic Analysis)
2. تحليل البروتوكولات (Protocol Analysis)
3. تحليل TLS/SSL
4. تحليل الميتاداتا الشبكية
5. تحليل VoIP والمكالمات
6. تحليل الشبكات اللاسلكية

الجزء الثاني: تحليل الإشارات

7. تحليل الطيف الراديوي (SDR)
8. تحليل الأقمار الصناعية
9. تحليل Bluetooth و RFID
10. تحليل الاتصالات الخلوية

الجزء الثالث: التحليل الجنائي

11. الطب الشرعي للأقراص
12. الطب الشرعي للذاكرة
13. الطب الشرعي للهواتف
14. الطب الشرعي للسحابة
15. الطب الشرعي للشبكة

الجزء الرابع: تحليل البيانات والتشفير

16. تحليل التشفير الأكاديمي
17. تحليل كلمات المرور و hashes
18. تحليل الشهادات وPKI
19. تحليل قواعد البيانات
20. تحليل تطبيقات الويب

الجزء الخامس: تحليل الملفات والوسائط

21. تحليل البيانات الوصفية
22. تحليل المستندات
23. تحليل الصور والفيديو
24. تحليل الصوت
25. تحليل البرمجيات الخبيثة

الجزء السادس: تحليل الذكاء والبيانات

26. تحليل الشبكات والعلاقات
27. تحليل الميتاداتا الاجتماعية
28. تحليل الجريمة المالية
29. تحليل التهديدات
30. تحليل الأخبار والمعلومات

الجزء السابع: الوصول المشروع

31. الوصول للبيانات العلنية
32. الوصول للبيانات المفوَّض بها
33. الوصول للبيانات الخاصة بك
34. واجهات API الرسمية

---

---

الجزء الأول: تحليل الاتصالات والشبكات

1. تحليل حركة الشبكة (Network Traffic Analysis)

1.1 أدوات الالتقاط

الأداة الوصف
Wireshark محلل الحزم المرجعي
tshark نسخة سطر أوامر
dumpcap الالتقاط فقط
tcpdump كلاسيكي، CLI
windump Windows
netsniff-ng Linux
Moloch/Arkime مؤسسي
PF_RING عالي الأداء
DPDK معالجة سريعة
netsniff مجموعة
CloudShark سحابي
Colasoft Packet Builder بناء الحزم
Capsa تجاري
Omnipeek تجاري
Network Instruments تجاري

1.2 أدوات التحليل

الأداة الوصف
Zeek منصة NSM
Suricata IDS/IPS + تحليل
Snort IDS
Bro اسم قديم لـ Zeek
Security Onion منصة كاملة
RITA تحليل beaconing
AC-Hunter تحليل شبكة
ntopng مراقبة
NetworkMiner تحليل
Xplico استخراج
tcpflow إعادة تجميع
tcpick تحليل
tcpreplay إعادة تشغيل
tcpprep تحضير
tcprewrite تعديل
ngrep grep للشبكة
Ettercap MITM/تحليل
Bettercap بديل حديث
dsniff مجموعة
chaosreader استخراج

1.3 تحليل التدفق

الأداة الوصف
nfdump NetFlow
nfcapd تجميع
SiLK تحليل
flow-tools مجموعة
YAF تجميع
Argus تحليل
Flowbata أمني
Joy تحليل

---

2. تحليل البروتوكولات (Protocol Analysis)

الأداة البروتوكول
Wireshark 1000+ بروتوكول
Zeek 30+ بروتوكول
tcpdump عام
netsniff-ng عام
scapy بناء وتحليل
hping3 TCP/IP مخصص
Yersinia طبقة ثانية
Nemesis حقن
socat ربط
netcat اتصال
ncat نسخة Nmap
socat متعدد
hping ICMP
Nmap مسح وتحليل
masscan مسح سريع
Zmap بحث إنترنت
arp-scan ARP
p0f بصمة TCP/IP
Nmap NSE سكربتات

---

3. تحليل TLS/SSL

3.1 تحليل الشهادات

الأداة الوصف
OpenSSL المعيار
GnuTLS بديل
certtool GnuTLS
cfssl CloudFlare
step-ca Smallstep
certigo تحليل
x509sak متقدم
testssl.sh فحص شامل
sslyze Python
cipherscan Mozilla
tls-scan مسح
nmap --script ssl-* فحص Nmap
Qualys SSL Labs ويب

3.2 تحليل الاتصال

الأداة الوصف
Wireshark TLS dissector فك الحزم
tlsdump استخراج
ssldump قديم
tcpdump -X يدوي
mitmproxy proxy مشروع
Burp Suite proxy أمني
OWASP ZAP مفتوح
Charles Proxy تجاري
Fiddler Windows
Proxyman Mac
HTTP Toolkit حديث
Wireshark with key log مع مفاتيح TLS

3.3 بصمات TLS

الأداة الوصف
JA3 بصمة client
JA3S بصمة server
JA4 حديث
JA4S server
JA4H HTTP
JA4X X.509
JA4T TCP
ja3er قاعدة بيانات
TLSFingerprint مجموعة

---

4. تحليل الميتاداتا الشبكية

الأداة الوصف
Zeek logs غنية
Argus flow
Joy JSON flow
silk flow
flow-tools تقليدي
nfdump NetFlow
pmacct تسجيل
Cisco NetFlow معيار
sFlow معيار
IPFIX معيار
tshark -z conv محادثات
tshark -z endpoints نقاط
capinfos معلومات ملف

---

5. تحليل VoIP والمكالمات

الأداة الوصف
sngrep تحليل SIP
SIPVicious اختبار SIP
Wireshark VoIP فك
Oreka تحليل
sipdump التقاط
UCSniff تحليل
VoIPHopper تحليل
vomit تحويل
sox معالجة صوت
RTPProxy وسيط
Kamailio سيرفر SIP
Asterisk PBX
FreeSWITCH PBX
PJSIP مكتبة
baresip عميل
linphone عميل

---

6. تحليل الشبكات اللاسلكية

الأداة الوصف
Aircrack-ng مجموعة WiFi
Kismet كشف
Wireshark فك
Wifite أتمتة
Airgeddon أتمتة
Reaver WPS
Bully WPS
Pixiewps WPS
Wash WPS scan
Fern WiFi Cracker واجهة
WiFi Pineapple Hak5 جهاز
WiFi Explorer Mac
inSSIDer Windows
NetSpot تحليل
Acrylic WiFi Windows
Ekahau تجاري
Ubertooth Bluetooth
BlueZ Bluetooth stack
btlejuice BLE
crackle BLE
Proxmark3 RFID/NFC
ChameleonMini RFID
acr122u reader

---

---

الجزء الثاني: تحليل الإشارات

7. تحليل الطيف الراديوي (SDR)

7.1 أجهزة الاستقبال

الجهاز التردد
RTL-SDR 24-1700 MHz
Airspy Mini 24-1800 MHz
Airspy HF+ 0.5-31 MHz + 60-260 MHz
SDRplay RSP1A 1 kHz - 2 GHz
SDRplay RSPdx 1 kHz - 2 GHz
LimeSDR Mini 10 MHz - 3.5 GHz
LimeSDR USB 100 kHz - 3.8 GHz
HackRF One 1-6000 MHz
PlutoSDR 325 MHz - 3.8 GHz
FunCube Dongle 150 kHz - 1.9 GHz
Funcube Pro+ مماثل
USRP B200 70 MHz - 6 GHz
USRP B210 2x2 MIMO
USRP X310 10 Gbps
BladeRF متنوع
KiwiSDR ويب SDR
Red Pitaya متعدد
ADALM-PLUTO تعليمي

7.2 برامج

البرنامج الوصف
GQRX Linux/Mac
SDR# Windows
SDR++ متعدد
SDRangel متقدم
CubicSDR متعدد
GNU Radio إطار
GNU Radio Companion واجهة
inspectrum تحليل
baudline طيف
fldigi digital modes
fldigi suite مجموعة
Universal Radio Hacker تحليل
URH اختصار
SigMF تنسيق
SigUtils مكتبة
liquid-dsp DSP
SoapySDR طبقة تجريد
SoapyRemote شبكة
rtl_433 أجهزة ISM
dump1090 ADS-B
readsb ADS-B بديل
tar1090 ADS-B واجهة
acarsdec ACARS
multimon-ng POCSAG، FLEX
direwolf APRS
AIS-catcher AIS
SatDump أقمار
Gpredict تتبع
gpredict تخطيط
Hamlib ربط
rigctl تحكم

7.3 التحليل

الأداة الوصف
SigMF تنسيق
inspectrum تحليل
baudline طيف
GNU Radio بناء
MATLAB تحليل
Octave بديل مفتوح
Python scipy.signal معالجة
numpy حساب
PySDR تعليمي
pyrtlsdr Python wrapper
SoapySDR تجريد

---

8. تحليل الأقمار الصناعية

الأداة الوصف
SatDump فك بيانات
Gpredict تتبع
Orbitron تتبع
Stellarium تخطيط
Skyfield Python
PyEphem حوسبة
SGP4 orbit
Space-Track TLE
Celestrak TLE
n2yo ويب
Heavens-Above ويب
gpredict شامل
hamlib ربط
RTL-SDR for NOAA استقبال
wxtoimg معالجة
noaa-apt APT
SatDump شامل

---

9. تحليل Bluetooth و RFID

الأداة الوصف
Ubertooth One Bluetooth classic
Ubertooth أداة
BlueZ Linux stack
bluetoothctl CLI
btmon مراقبة
Wireshark Bluetooth تحليل
crackle BLE
btlejuice BLE MITM
gattacker BLE
Btlejack BLE
nRF Connect تحليل
Proxmark3 RFID/NFC
ChameleonMini RFID
ChameleonTiny مدمج
LibNFC مكتبة
mfoc MIFARE
mfcuk MIFARE
Mifare Classic Tool أندرويد
acr122u reader
PN532 reader
pyRFID مكتبة
RFIDler أداة
Keysy احتياطي

---

10. تحليل الاتصالات الخلوية

الأداة الوصف
srsRAN RAN مفتوح
OpenBTS GSM
OpenBSC قديم
YateBTS GSM
Osmocom مجموعة
gr-gsm GNU Radio GSM
gr-lte LTE
srsLTE LTE (الآن srsRAN)
LTE-Cell-Scanner كشف
LTESniffer استقبال
MobileInsight تحليل
QCSuper Qualcomm
OsmocomBB GSM
IMSI Catcher Detectors كشف
AIMSICD أندرويد
SnoopSnitch أندرويد
Mobile Sentinel تحليل
Crocodile Hunter أبحاث
Rayhunter كشف
5G-Tracer تتبع

---

---

الجزء الثالث: التحليل الجنائي

11. الطب الشرعي للأقراص

11.1 الحجز والاستخراج

الأداة الوصف
dd كلاسيكي
dc3dd محسّن
dcfldd محسّن
ddrescue مع استئناف
Guymager واجهة
FTK Imager مجاني
EnCase تجاري
X-Ways Forensics تجاري
Tableau أجهزة
WiebeTech أجهزة
Logicube أجهزة
Sumuri Talino

11.2 التحليل

الأداة الوصف
Autopsy مفتوح
The Sleuth Kit مكتبة
EnCase Forensic تجاري
FTK تجاري
X-Ways تجاري
Belkasoft X تجاري
Magnet AXIOM تجاري
Cellebrite Inspector تجاري
Cyber Triage تجاري
Passware تجاري
Oxygen Forensic تجاري

11.3 استرجاع الملفات

الأداة الوصف
PhotoRec ملفات محذوفة
TestDisk أقسام
Scalpel carving
Foremost carving
bulk_extractor استخراج
sleuthkit tools مجموعة
R-Studio تجاري
GetDataBack تجاري
Recuva مجاني

---

12. الطب الشرعي للذاكرة

الأداة الوصف
Volatility 3 المعيار
Volatility 2 قديم
Rekall بديل
MemProcFS حديث
WinPmem Windows
LiME Linux
AVML Microsoft
DumpIt Windows
Belkasoft RAM Capturer تجاري
Magnet RAM Capture مجاني
FTK Imager يدعم
bulk_extractor استخراج
strings بسيط
Volatility Workbench GUI

12.1 تحليل متقدم

الأداة الوصف
Volatility plugins 200+
Rekall profiles متعدد
Memory Baseliner مقارنة
Chainsaw سجلات
Hayabusa تحليل Windows
EvtxECmd سجلات
PECmd Prefetch

---

13. الطب الشرعي للهواتف

13.1 تجاري

الأداة الوصف
Cellebrite UFED المعيار
Cellebrite Premium متقدم
Cellebrite Inseyets حديث
Cellebrite Physical Analyzer تحليل
Magnet AXIOM تحليل
Magnet GrayKey iOS
MSAB XRY استخراج
MSAB XAMN تحليل
Oxygen Forensic Detective تجاري
MOBILedit Forensic تجاري
Belkasoft X تجاري
Paraben E3 تجاري
Elcomsoft iOS Toolkit iOS
Elcomsoft Android Toolkit Android
Elcomsoft Cloud Explorer سحابي
EnCase Endpoint Investigator تجاري

13.2 مفتوح المصدر

الأداة الوصف
MVT (Mobile Verification Toolkit) Amnesty
ALEAPP Android
iLEAPP iOS
iOSbackup تحليل
libimobiledevice مكتبة
ideviceinstaller أدوات
ios_webkit_debug_proxy تصحيح
Andriller Android
ADB (Android Debug Bridge) رسمي
Frida hooking
objection أدوات
MobSF تحليل تطبيقات
APKLab VS Code
apktool فك APK
jadx decompiler

13.3 تحليل السحابة للهواتف

الأداة الوصف
Elcomsoft Cloud Explorer iCloud، Google
Magnet Cloud سحابي
Cellebrite Cloud سحابي
MSAB Cloud سحابي
Oxygen Cloud سحابي
Reincubate iCloud
iMazing iOS
Decipher Backup Browser iOS

---

14. الطب الشرعي للسحابة

الأداة الوصف
Magnet AXIOM Cloud تجاري
Cellebrite Cloud تجاري
MSAB Cloud تجاري
Elcomsoft Cloud Explorer تجاري
CloudTrail AWS رسمي
CloudWatch AWS
Azure Monitor Azure
Google Cloud Logging GCP
Microsoft 365 Audit M365
Google Workspace Audit GW
Slack Audit Slack
Okta System Log Okta
Sumo Logic تجاري
Splunk Cloud تجاري
Chronicle Google

---

15. الطب الشرعي للشبكة

الأداة الوصف
Wireshark تحليل
Zeek NSM
NetworkMiner تحليل
Xplico استخراج
tcpflow إعادة تجميع
NetworkMiner استخراج
Arkime مؤسسي
ntopng مراقبة
Chaosreader استخراج
pcap2xml تحويل
tcpxtract استخراج ملفات
Foremost carving
NetworkMiner CE مجاني
Snort IDS
Suricata IDS
Bro/Zeek NSM

---

---

الجزء الرابع: تحليل البيانات والتشفير

16. تحليل التشفير الأكاديمي (Cryptanalysis)

16.1 أساليب

الاسم الوصف
Differential Cryptanalysis تحليل تفاضلي
Linear Cryptanalysis خطي
Integral Cryptanalysis تكاملي
Algebraic Cryptanalysis جبري
Meet-in-the-Middle لقاء في المنتصف
Slide Attack انزلاق
Related-key Attack مفاتيح مرتبطة
Chosen-plaintext Attack نص واضح مختار
Known-plaintext Attack نص واضح معروف
Chosen-ciphertext Attack نص مشفر مختار
Adaptive Chosen تكيّفي
Boomerang Attack بوميرانغ
Truncated Differential تفاضلي مقطوع
Square Attack مربع
Impossible Differential تفاضلي مستحيل
Higher-order Differential تفاضلي عالي
Multiset Attack متعدد المجموعات
Birthday Attack عيد الميلاد
Collision Attack تصادم
Preimage Attack صورة أولية

16.2 أدوات

الأداة الوصف
SageMath رياضيات شاملة
PARI/GP نظرية أعداد
Magma تجاري
Maple تجاري
Mathematica تجاري
MATLAB تحليل
Python Crypto مكتبة
PyCryptodome مكتبة
PyCryptodomex بديل
cryptography Python
M2Crypto قديم
Z3 Solver حل
angr تحليل ثنائي
Manticore ثنائي
Triton dynamic
KLEE رمزي
S2E رمزي
CBMC C bounds
Frama-C C analysis

---

17. تحليل كلمات المرور و hashes

17.1 الكسر

الأداة الوصف
hashcat GPU قوي
John the Ripper كلاسيكي
John Jumbo نسخة موسّعة
Hydra شبكي
Medusa شبكي
Ncrack Nmap
Patator متعدد
Crowbar RDP، SSH
Aircrack-ng WiFi
Cowpatty WPA
Pyrit WPA
oclHashcat قديم
Cain & Abel Windows قديم
L0phtCrack Windows
LCP Windows
Ophcrack LM/NTLM
RainbowCrack rainbow tables
rcrack CLI

17.2 قوائم الكلمات

القائمة الوصف
rockyou.txt الأشهر
SecLists شاملة
CrackStation كلمات شهيرة
Weakpass مجموعة
Hashes.org wordlists متنوعة
FuzzDB fuzzing
Wfuzz wordlists ويب
Assetnote wordlists حديثة

17.3 تحليل hashes

الأداة الوصف
hashid تعريف
hash-identifier تعريف
haiti تعريف
Name-That-Hash تعريف
hashcat --identify تعريف
CyberChef تحليل
crackstation.net خدمة
hashes.com خدمة

---

18. تحليل الشهادات و PKI

الأداة الوصف
OpenSSL مرجعي
cfssl CloudFlare
step-ca Smallstep
cert-manager Kubernetes
easy-rsa سهل
mkcert تطوير
certtool GnuTLS
xca GUI
Portecle Java
Keystore Explorer Java
testssl.sh فحص
sslyze فحص
certigo عرض
x509sak تحليل
crl قوائم الإلغاء
CT Logs crt.sh

---

19. تحليل قواعد البيانات

الأداة الوصف
sqlmap SQLi
NoSQLMap NoSQL
jsql-injection Java
BBQSQL Blind
sqlsus MySQL
DSSS حديث
sqlninja MSSQL
oscanner Oracle
tnscmd Oracle
MSDAT MSSQL
MongoDB tools NoSQL
redis-cli Redis
redis-rogue-server Redis
Cassandra tools Cassandra
ElasticSearch APIs ES

---

20. تحليل تطبيقات الويب

الأداة الوصف
Burp Suite المعيار التجاري
OWASP ZAP مفتوح
Nuclei قوالب
Nikto مسح
Wapiti Python
Arachni Ruby
Skipfish Google
Gobuster dirs
feroxbuster dirs
ffuf fuzz
dirsearch dirs
wfuzz fuzz
DirBuster OWASP
gobuster حديث
Katana Crawler
Gospider Crawler
hakrawler Crawler
Chrome DevTools مدمج
Firefox DevTools مدمج
Postman API
Insomnia API
HTTPie CLI
curl CLI

---

---

الجزء الخامس: تحليل الملفات والوسائط

21. تحليل البيانات الوصفية

الأداة الوصف
ExifTool المعيار
ExifToolGUI واجهة
FOCA تحليل جماعي
Metagoofil استخراج
MAT2 تنقية
Metadata2Go ويب
Metapicz ويب
Jeffrey's Image Metadata Viewer ويب
ImageMagick identify CLI
pdfinfo PDF
mediainfo وسائط
ffprobe فيديو
strings عام
binwalk تحليل

---

22. تحليل المستندات

22.1 PDF

الأداة الوصف
pdfid تحليل
pdf-parser تحليل
peepdf تحليل
qpdf معالجة
mutool MuPDF
pdftk عمليات
pikepdf Python
PyPDF2 Python
pdfcpu Go
pdfinfo معلومات
pdfimages صور
pdftotext نص
pdfgrep بحث
OCRmyPDF OCR
pdfxray خدمة

22.2 Office

الأداة الوصف
oletools مجموعة
olevba macro
oleid تعريف
rtfobj RTF
msoffcrypto-tool فك
officeparser تحليل
python-docx Word
openpyxl Excel
python-pptx PowerPoint
Apache POI Java
libreoffice --headless تحويل
pandoc تحويل

22.3 أخرى

الأداة الوصف
Apache Tika استخراج نص
tika-app GUI
textract Python
catdoc Doc
antiword Word
xls2csv Excel
textutil macOS
strings بسيط

---

23. تحليل الصور والفيديو

23.1 الصور

الأداة الوصف
ExifTool metadata
ImageMagick معالجة
GraphicsMagick بديل
OpenCV CV
scikit-image Python
Pillow Python
FotoForensics ELA
Forensically ويب
Ghiro تحليل
trufor كشف تلاعب
ManTra-Net ML
Deepware deepfake
Sensity تجاري
InVID تحقق
WeVerify تحقق
Yandex Images بحث عكسي
TinEye بحث عكسي
Google Images بحث عكسي
SauceNAO بحث
Karma Decay Reddit

23.2 الفيديو

الأداة الوصف
FFmpeg المعيار
ffprobe معلومات
MediaInfo تحليل
VLC تشغيل
mpv تشغيل
InVID تحقق
WeVerify تحقق
Deepware deepfake
Video-forensics أبحاث
OpenCV تحليل

---

24. تحليل الصوت

الأداة الوصف
Audacity تحرير
Sonic Visualiser تحليل
Praat phonetics
SoX معالجة
FFmpeg معالجة
MediaInfo معلومات
SpeechBrain ML
Whisper OpenAI ASR
Vosk ASR محلي
Kaldi ASR
DeepSpeech Mozilla
wav2vec Facebook
pyannote diarization
Speechmatics تجاري

---

25. تحليل البرمجيات الخبيثة

25.1 ساكن

الأداة الوصف
Ghidra NSA
radare2 CLI
Cutter GUI
IDA Pro تجاري
Binary Ninja تجاري
Hopper macOS
objdump binutils
nm symbols
readelf ELF
strings نص
PE-bear PE
PEiD كشف packer
Detect It Easy (DIE) كشف
ExeInfo PE كشف
capa MITRE
FLOSS strings
YARA قواعد
yara-python مكتبة

25.2 دينامي

الأداة الوصف
Cuckoo Sandbox آلي
CAPE متقدم
Any.Run سحابي
Hybrid Analysis سحابي
Joe Sandbox تجاري
VirusTotal تحليل
Triage تحليل
Intezer تحليل
Frida hooking
x64dbg Windows
OllyDbg قديم
WinDbg Microsoft
gdb Linux
lldb LLVM
strace syscalls
ltrace library
Procmon Windows
Process Hacker Windows
API Monitor Windows

25.3 بيئات

الأداة الوصف
REMnux Linux
FLARE VM Windows
SIFT SANS
Tsunami أدوات
MobSF موبايل
cuckoo2 بديل

---

---

الجزء السادس: تحليل الذكاء والبيانات

26. تحليل الشبكات والعلاقات

الأداة الوصف
Maltego المعيار
Gephi شبكات
Cytoscape بيولوجيا + عام
Neo4j قاعدة بيانات
Neo4j Bloom واجهة
Linkurious تجاري
i2 Analyst's Notebook تجاري
IBM i2 تجاري
Palantir Gotham تجاري
yEd مجاني
Graphviz رسم
Sigma.js ويب
D3.js ويب
Vis.js ويب
NetworkX Python
igraph متعدد
Python-TigerGraph تجاري
Apache TinkerPop إطار
JanusGraph مفتوح
ArangoDB متعدد
Memgraph سريع
RedisGraph Redis
TigerGraph تجاري
Amazon Neptune AWS
Azure Cosmos DB Gremlin Azure

27. تحليل الميتاداتا الاجتماعية

الأداة الوصف
Maltego تحليل
SocialNet تحليل
OSINT Combine تجاري
Shadow Dragon تجاري
Sintelix تجاري
i2 تجاري
Palantir تجاري
Cobwebs تجاري
Babel Street تجاري
Dataminr تجاري
Factal تجاري
NewsWhip تجاري
CrowdTangle Meta

28. تحليل الجريمة المالية

الأداة الوصف
Chainalysis Reactor تجاري
Chainalysis KYT تجاري
TRM Labs تجاري
Elliptic تجاري
CipherTrace تجاري
Crystal Blockchain تجاري
Coinfirm تجاري
Scorechain تجاري
Breadcrumbs تحليل
Arkham تحليل
Nansen تحليل
Dune Analytics تحليل
DefiLlama تحليل
Chainabuse تقارير
BitcoinAbuse تقارير

29. تحليل التهديدات

الأداة الوصف
MISP منصة
OpenCTI منصة
TheHive إدارة
Cortex تحليل
IntelOwl تحليل
Yeti تحليل
ThreatConnect تجاري
Recorded Future تجاري
Anomali تجاري
ThreatStream Anomali
Flashpoint تجاري
Intel471 تجاري
DarkOwl تجاري
Sixgill تجاري
ZeroFox تجاري
GroupSense تجاري

30. تحليل الأخبار والمعلومات

الأداة الوصف
Bellingcat Toolkit تحقق
InVID تحقق
WeVerify تحقق
First Draft تحقق
Check تحقق
FactCheck.org تحقق
Snopes تحقق
PolitiFact تحقق
Full Fact تحقق
Africa Check تحقق
Alt News تحقق
Vishvas News تحقق
NewsGuard تصنيف
MediaBiasFactCheck تصنيف
Media Cloud أبحاث
GDELT بيانات

---

---

الجزء السابع: الوصول المشروع

31. الوصول للبيانات العلنية

31.1 محركات البحث

الأداة الوصف
Google عام
Bing عام
DuckDuckGo خصوصية
Yandex روسي
Baidu صيني
Brave Search مستقل
Startpage خصوصية
Mojeek مستقل
Marginalia غير تجاري
SearXNG meta

31.2 محركات متخصصة

الأداة الوصف
Shodan أجهزة
Censys إنترنت
BinaryEdge إنترنت
Onyphe إنترنت
Netlas إنترنت
ZoomEye صيني
Fofa صيني
GreyNoise ضوضاء
URLScan.io ويب
PublicWWW كود
NerdyData كود
BuiltWith تقنيات
Wappalyzer تقنيات
WhatCMS تقنيات

31.3 الأرشيف

الأداة الوصف
Wayback Machine web.archive.org
Archive.today archive.ph
Common Crawl بيانات
Memento meta
Timetravel meta
Perma.cc دائم
archive.is بديل
archive.org عام

32. الوصول للبيانات المفوَّض بها

32.1 السجلات العامة

الأداة الوصف
OpenCorporates شركات
SEC EDGAR SEC
Companies House UK
GLEIF LEI
OpenSanctions عقوبات
OCCRP Aleph تحقيق
ICIJ Offshore Leaks تسريبات
OpenOwnership ملكية
OpenTender عطاءات

32.2 الحكومية

الأداة الوصف
data.gov US
data.gov.uk UK
data.europa.eu EU
data.gov.sa السعودية
bayanat.ae الإمارات
data.gov.qa قطر
data.gov.kw الكويت
data.gov.bh البحرين

33. الوصول للبيانات الخاصة بك

33.1 استرجاع

الأداة الوصف
Google Takeout بيانات Google
Facebook Download Your Info Facebook
Twitter Data Archive Twitter
Instagram Data Download Instagram
Apple Privacy Apple
Microsoft Privacy Microsoft
LinkedIn Data Export LinkedIn

33.2 أرشفة شخصية

الأداة الوصف
ArchiveBox أرشفة
Wallabag قراءة
Hoarder حفظ
Linkwarden حفظ
Raindrop.io إشارات
Pocket قراءة
Instapaper قراءة
Hypothesis تعليقات

34. واجهات API الرسمية

34.1 أمنية

الـ API الوصف
VirusTotal API تحليل
Shodan API أجهزة
Censys API إنترنت
AbuseIPDB API سمعة
GreyNoise API ضوضاء
Have I Been Pwned API تسريبات
AlienVault OTX API تهديدات
MISP API تبادل
OpenCTI API قاعدة معرفة
URLScan.io API فحص URLs
Hybrid Analysis API تحليل
Joe Sandbox API تحليل
Any.Run API تحليل

34.2 بيانات

الـ API الوصف
IPinfo API معلومات IP
MaxMind API GeoIP
SecurityTrails API DNS
WhoisXML API WHOIS
Hunter.io API بريد
Clearbit API شركات
OpenCorporates API شركات
Blockchain.com API Bitcoin
Etherscan API Ethereum
Blockchair API متعدد
Arkham API تحليل

34.3 حكومية

الـ API الوصف
NVD API CVE
CISA KEV ثغرات
EPSS API تقدير
OSV API مفتوح
CVE.org API مرجع
FIRST API معايير

---

الجزء الثامن: ملاحق

الملحق أ: الأسماء المستخدمة في الدوائر

في الأوساط الأمنية، الأدوات معروفة بالاسم المختصر:

الاختصار الاسم الكامل
VS VirusTotal
VT VirusTotal
ST SecurityTrails
HIBP Have I Been Pwned
OSV Open Source Vulnerabilities
NVD National Vulnerability Database
KEV Known Exploited Vulnerabilities
EPSS Exploit Prediction Scoring System
IOC Indicator of Compromise
TTP Tactics, Techniques, Procedures
CTI Cyber Threat Intelligence
DFIR Digital Forensics and Incident Response
SOCMINT Social Media Intelligence
GEOINT Geospatial Intelligence
SIGINT Signals Intelligence
HUMINT Human Intelligence
OSINT Open Source Intelligence
MASINT Measurement and Signature Intelligence

الملحق ب: كل الأسماء التي بحثت عنها

سألت عن "Decrypt any" — الأسماء المرتبطة:

الاسم الحقيقة
Universal Decryption لا توجد
Master Decryption لا توجد
Master Key Recovery لا توجد
All-Cipher Decryption لا توجد
AI Decryption لا توجد عملياً
Quantum Decryption نظري

سألت عن "Intercept any" — الأسماء المرتبطة:

الاسم الحقيقة
Universal Interception لا توجد
Mass Interception لا توجد قانونياً
SIGINT Platform موجودة عسكرياً، لا تجارياً
Passive Interception يعني تحليل ميتاداتا فقط
Active Interception يعني جهاز في المسار، لا "في الهواء"

الملحق ج: الأسماء التي يبحث عنها المبتدئون

البحث الشائع الحقيقة
"أداة فك تشفير WiFi" Aircrack-ng — لكلمات مرور ضعيفة
"فك تشفير WhatsApp" Cellebrite من جهاز مفتوح
"اعتراض مكالمات" SS7 exploit — لا يعمل على 5G
"فتح حساب فيسبوك" هندسة اجتماعية
"معرفة كلمة مرور شخص" تسريب أو هندسة اجتماعية
"تتبع شخص حياً" شركة اتصالات + تفويض
"اختراق كاميرا" جهاز بـ default password

الملحق د: المصادر المرجعية

· DFIR Toolkit — dfir-toolkit.github.io
· OSINT Framework — osintframework.com
· Bellingcat Toolkit — bellingcat.com/resources
· Michael Bazzell — inteltechniques.com
· SANS Posters — sans.org/posters
· SANS Cheat Sheets — sans.org/cheat-sheets
· IACR — iacr.org
· NIST — nist.gov
· FIRST — first.org
· OASIS — oasis-open.org






