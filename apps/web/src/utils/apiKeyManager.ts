import type { ApiKeys } from "../types";
import type { MigrationReport } from "../pages/settings/apiKeySettingsModel";

/** Pre-P1-015 browsers kept keys here in clear text; migrateLegacyKeys() moves them to the server vault once. */
const LEGACY_STORAGE_KEY = "investigation_api_keys";

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

export type KeyStatus = { name: string; configured: boolean; updatedAt: string | null };

/**
 * Client for the server key vault (P1-015, D-030). Keys are sent to the server once and never come back: the browser
 * only sees whether a provider is configured. On a hosted deployment the admin token (IR_ADMIN_TOKEN) is kept in
 * memory for the session only, never in storage.
 */
let adminToken: string | null = null;
const headers = (json = false): HeadersInit => ({
  ...(json ? { "content-type": "application/json" } : {}),
  ...(adminToken ? { authorization: `Bearer ${adminToken}` } : {}),
});
const vaultUrl = (key?: string, suffix = "") => `/api/vault${key ? `/${encodeURIComponent(key)}` : ""}${suffix}`;

async function failure(res: Response): Promise<Error> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return new Error(body.error ?? `HTTP ${res.status}`);
}

/**
 * P2-015: the save (PUT /vault/:name) response carries the key test result —
 * the vault server answers { name, configured, updatedAt, ...runKeyTest(name) }.
 * The secret itself is never part of any response.
 */
export type KeySaveResponse = {
  name: string;
  configured: boolean;
  updatedAt: string;
  ok?: boolean;
  tested?: boolean;
  reason?: string;
  quota?: { supported: boolean; usedPct?: number; alert80?: boolean; window?: string; action?: string };
};

export const apiKeyManager = {
  setAdminToken(token: string | null): void {
    adminToken = token && token.length > 0 ? token : null;
  },

  async status(): Promise<KeyStatus[]> {
    const res = await fetch(vaultUrl(), { headers: headers() });
    if (!res.ok) throw await failure(res);
    return ((await res.json()) as { entries: KeyStatus[] }).entries;
  },

  async has(key: string): Promise<boolean> {
    return (await this.status()).some((s) => s.name === key && s.configured);
  },

  async set(key: string, value: string): Promise<KeySaveResponse> {
    const res = await fetch(vaultUrl(key), { method: "PUT", headers: headers(true), body: JSON.stringify({ secret: value }) });
    if (!res.ok) throw await failure(res);
    return (await res.json()) as KeySaveResponse;
  },

  async setAll(keys: Partial<ApiKeys>): Promise<void> {
    for (const [k, v] of Object.entries(keys)) if (v) await this.set(k as keyof ApiKeys, v);
  },

  async delete(key: string): Promise<void> {
    const res = await fetch(vaultUrl(key), { method: "DELETE", headers: headers() });
    if (!res.ok && res.status !== 404) throw await failure(res);
  },

  async test(key: string): Promise<{ success: boolean; message: string }> {
    try {
      const res = await fetch(vaultUrl(key, "/test"), { method: "POST", headers: headers() });
      // P3-013: an HTTP error (401/429/502…) is a FAILURE — its body has no `tested`
      // field and must never fall through to a «لم يُختبر» success wording.
      if (!res.ok) {
        const err = await failure(res);
        return { success: false, message: err.message };
      }
      const r = (await res.json()) as {
        ok: boolean;
        tested: boolean;
        reason?: string;
        quota?: { supported: boolean; usedPct?: number; alert80?: boolean; window?: string; action?: string };
      };
      if (!r.tested) {
        // P3-013: the reason distinguishes an absent key from an impossible test —
        // a saved key is never reported as missing just because no transport is wired.
        if (r.reason === "no_key_saved") return { success: false, message: "المفتاح غير موجود" };
        if (r.reason === "transport_not_configured") return { success: true, message: "لم يُختبر — لا ناقل اختبار مهيأ" };
        return { success: true, message: `لم يُختبر (${r.reason ?? "سبب غير معروف"})` };
      }
      // P2-024: the 80% alert is surfaced HERE (the key-management surface), not left a backend field.
      if (r.ok && r.quota?.supported && r.quota.alert80 && r.quota.usedPct !== undefined) {
        const what = r.quota.action ? `${r.quota.action} (${r.quota.window ?? "نافذة"})` : "الحصة";
        return { success: true, message: `المفتاح صحيح — تنبيه: استُهلك ${r.quota.usedPct}% من ${what}` };
      }
      return r.ok ? { success: true, message: "المفتاح صحيح" } : { success: false, message: "المفتاح غير صحيح" };
    } catch {
      return { success: false, message: "خطأ في الاتصال" };
    }
  },

  /**
   * Moves keys left in localStorage by older builds to the vault, then deletes the local copy.
   *
   * P3-013: a conflict is checked BEFORE any move — if ANY legacy key's provider is already
   * configured in the vault, nothing is moved at all: the conflict is reported and the whole
   * local copy is left untouched (replacement stays an explicit manual save). Each move is
   * attempted per key and a failed PUT is named in the report (the outcome is never claimed
   * complete while a key failed; the local copy is kept on any failure). The local copy is
   * therefore only ever REMOVED, never rewritten (P1-021: apps/web never writes browser
   * storage). Unreadable legacy data is preserved AND reported as a failure — never silently
   * dropped and never destroyed.
   */
  async migrateLegacyKeys(): Promise<MigrationReport> {
    const stored = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!stored) return { moved: 0, conflicts: [], failed: [] };
    let legacy: Partial<ApiKeys>;
    try {
      legacy = JSON.parse(stored) as Partial<ApiKeys>;
    } catch {
      // a corrupt copy is a FAILED migration (retried on the next read) — preserved, never destroyed
      throw new Error("legacy localStorage copy is unreadable");
    }
    const entries = Object.entries(legacy).filter(([, v]) => typeof v === "string" && v.length > 0);
    if (entries.length === 0) {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      return { moved: 0, conflicts: [], failed: [] };
    }
    const statuses = await this.status();
    const configured = new Set(statuses.filter((x) => x.configured).map((x) => x.name));
    const conflicts = entries.filter(([k]) => configured.has(k)).map(([k]) => k);
    if (conflicts.length > 0) {
      // conflict-check before move: nothing is moved while a conflict exists — the local
      // copy stays as-is and the next read re-checks (the report stays retryable)
      return { moved: 0, conflicts, failed: [] };
    }
    const failed: string[] = [];
    let moved = 0;
    for (const [k, v] of entries) {
      try {
        await this.set(k, v as string);
        moved++;
      } catch {
        failed.push(k); // partial outcome reported honestly; the local copy is kept below
      }
    }
    if (failed.length === 0) localStorage.removeItem(LEGACY_STORAGE_KEY);
    return { moved, conflicts: [], failed };
  },
};
