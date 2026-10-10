> المصدر: `docs/ROADMAP2.md` — مصنّف حسب المجال التحليلي (2026-10-10).

# تحليل الاتصالات والشبكات (NETWORK ANALYSIS)


1. تحليل حركة الشبكة (Network Traffic Analysis)
2. تحليل البروتوكولات (Protocol Analysis)
3. تحليل TLS/SSL
4. تحليل الميتاداتا الشبكية
5. تحليل VoIP والمكالمات
6. تحليل الشبكات اللاسلكية


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

