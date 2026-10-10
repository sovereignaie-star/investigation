> المصدر: `docs/ROADMAP2.md` — مصنّف حسب المجال التحليلي (2026-10-10).

# تحليل البيانات والتشفير (DATA & CRYPTO ANALYSIS)


16. تحليل التشفير الأكاديمي
17. تحليل كلمات المرور و hashes
18. تحليل الشهادات وPKI
19. تحليل قواعد البيانات
20. تحليل تطبيقات الويب


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

