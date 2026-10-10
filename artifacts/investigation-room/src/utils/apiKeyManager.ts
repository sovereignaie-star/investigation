import type { ApiKeys } from "../types";

const STORAGE_KEY = "investigation_api_keys";

export const API_KEY_DEFINITIONS: Array<{
  key: keyof ApiKeys;
  label: string;
  labelAr: string;
  description: string;
  link: string;
  placeholder: string;
}> = [
  {
    key: "shodan",
    label: "Shodan API Key",
    labelAr: "مفتاح Shodan",
    description: "بحث في الأجهزة المتصلة بالإنترنت، الكاميرات، الخوادم، IoT",
    link: "https://account.shodan.io/",
    placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  },
  {
    key: "virustotal",
    label: "VirusTotal API Key",
    labelAr: "مفتاح VirusTotal",
    description: "فحص الروابط والملفات والعناوين بحثاً عن البرمجيات الخبيثة",
    link: "https://www.virustotal.com/gui/my-apikey",
    placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  },
  {
    key: "ipinfo",
    label: "IPInfo API Key",
    labelAr: "مفتاح IPInfo",
    description: "معلومات تفصيلية عن عناوين IP: المدينة، الدولة، مزود الخدمة، ASN",
    link: "https://ipinfo.io/account",
    placeholder: "xxxxxxxxxxxxxxxx",
  },
  {
    key: "abuseipdb",
    label: "AbuseIPDB API Key",
    labelAr: "مفتاح AbuseIPDB",
    description: "فحص سمعة عناوين IP وتقارير الإساءة",
    link: "https://www.abuseipdb.com/account/api",
    placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  },
  {
    key: "hunter",
    label: "Hunter.io API Key",
    labelAr: "مفتاح Hunter.io",
    description: "البحث عن عناوين البريد الإلكتروني المرتبطة بنطاق معين",
    link: "https://hunter.io/api-keys",
    placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  },
  {
    key: "haveibeenpwned",
    label: "HaveIBeenPwned API Key",
    labelAr: "مفتاح HaveIBeenPwned",
    description: "فحص تسريب البريد الإلكتروني في قواعد البيانات المخترقة",
    link: "https://haveibeenpwned.com/API/Key",
    placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  },
  {
    key: "numverify",
    label: "Numverify API Key",
    labelAr: "مفتاح Numverify",
    description: "التحقق من أرقام الهاتف وتحديد الدولة والمزود والنوع",
    link: "https://numverify.com/dashboard",
    placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  },
  {
    key: "ipgeolocation",
    label: "IPGeolocation API Key",
    labelAr: "مفتاح IPGeolocation",
    description: "تحديد الموقع الجغرافي لعناوين IP بدقة عالية",
    link: "https://app.ipgeolocation.io/",
    placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  },
  {
    key: "clearbit",
    label: "Clearbit API Key",
    labelAr: "مفتاح Clearbit",
    description: "معلومات الشركات والأشخاص من عناوين البريد الإلكتروني",
    link: "https://clearbit.com/keys",
    placeholder: "sk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  },
  {
    key: "fullcontact",
    label: "FullContact API Key",
    labelAr: "مفتاح FullContact",
    description: "إثراء بيانات الاتصال والملفات الشخصية",
    link: "https://app.fullcontact.com/settings/api",
    placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  },
  {
    key: "censys",
    label: "Censys API Key",
    labelAr: "مفتاح Censys",
    description: "استكشاف الأصول الرقمية، الشهادات، المنافذ المفتوحة",
    link: "https://search.censys.io/account/api",
    placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  },
  {
    key: "binaryedge",
    label: "BinaryEdge API Key",
    labelAr: "مفتاح BinaryEdge",
    description: "مسح الإنترنت للبحث عن نقاط الضعف والخدمات المكشوفة",
    link: "https://app.binaryedge.io/account/api",
    placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  },
  {
    key: "greynoise",
    label: "GreyNoise API Key",
    labelAr: "مفتاح GreyNoise",
    description: "تحليل سلوك عناوين IP وتصنيفها كبوت أو مهاجم أو طبيعي",
    link: "https://viz.greynoise.io/account/api-key",
    placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  },
  {
    key: "securitytrails",
    label: "SecurityTrails API Key",
    labelAr: "مفتاح SecurityTrails",
    description: "السجلات التاريخية للنطاقات وعناوين IP والـ DNS",
    link: "https://securitytrails.com/app/account/credentials",
    placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  },
  {
    key: "whoisxml",
    label: "WhoisXML API Key",
    labelAr: "مفتاح WhoisXML",
    description: "بيانات WHOIS التفصيلية للنطاقات وعناوين IP",
    link: "https://user.whoisxmlapi.com/products",
    placeholder: "at_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  },
];

export const apiKeyManager = {
  getAll(): ApiKeys {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return {} as ApiKeys;
      return JSON.parse(stored) as ApiKeys;
    } catch {
      return {} as ApiKeys;
    }
  },

  get(key: keyof ApiKeys): string {
    const all = this.getAll();
    return all[key] || "";
  },

  set(key: keyof ApiKeys, value: string): void {
    const all = this.getAll();
    all[key] = value;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  },

  setAll(keys: Partial<ApiKeys>): void {
    const all = this.getAll();
    Object.assign(all, keys);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  },

  delete(key: keyof ApiKeys): void {
    const { [key]: _removed, ...all } = this.getAll();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  },

  has(key: keyof ApiKeys): boolean {
    return Boolean(this.get(key));
  },

  async test(key: keyof ApiKeys): Promise<{ success: boolean; message: string }> {
    const value = this.get(key);
    if (!value) return { success: false, message: "المفتاح غير موجود" };

    try {
      switch (key) {
        case "ipinfo": {
          const res = await fetch(`https://ipinfo.io/8.8.8.8?token=${value}`);
          return res.ok ? { success: true, message: "المفتاح صحيح ✓" } : { success: false, message: "المفتاح غير صحيح" };
        }
        case "virustotal": {
          const res = await fetch("https://www.virustotal.com/api/v3/ip_addresses/8.8.8.8", {
            headers: { "x-apikey": value },
          });
          return res.ok ? { success: true, message: "المفتاح صحيح ✓" } : { success: false, message: "المفتاح غير صحيح" };
        }
        default:
          return { success: true, message: "تم الحفظ (لم يتم الاختبار)" };
      }
    } catch {
      return { success: false, message: "خطأ في الاتصال" };
    }
  },
};
