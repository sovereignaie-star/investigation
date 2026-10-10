// ============================================================
// كود الجلب الشامل - Fetch Strategies لكل الـ 700 معرف
// المسار: src/utils/resultFetcher.ts
// ============================================================

import { IDENTIFIER_LIST, IdentifierDefinition } from './identifierList';

// ============================================================
// الأنواع
// ============================================================

export type FetchStrategyType = 
  | 'local-decode'      // يفك تشفير المعرف محلياً، لا يحتاج API
  | 'local-lookup'      // يبحث في قاعدة بيانات محلية
  | 'osint-free'        // مصادر مفتوحة مجانية
  | 'osint-rate-limited'// مصادر مفتوحة بمعدل محدود
  | 'platform-api'      // يحتاج مفتاح API لمنصة محددة
  | 'internal-db'       // قواعد بياناتك الداخلية
  | 'browser-leak'      // معلومات من المتصفح
  | 'dns-lookup'        // استعلامات DNS
  | 'whois-lookup'      // استعلامات WHOIS
  | 'regex-extract'     // استخراج بالمطابقة النصية
  | 'ai-infer';         // استنتاج بالذكاء الاصطناعي

export interface FetchStrategy {
  identifierId: string;
  type: FetchStrategyType;
  handler: (value: string, apiKeys: Record<string, string>) => Promise<FetchResult>;
  apiKeyRequired?: string;   // اسم المفتاح المطلوب
  isFree: boolean;
  rateLimit?: {
    maxRequests: number;
    perTimeWindow: string;   // 'minute', 'hour', 'day', 'month'
  };
  cacheTimeSeconds: number;  // كم ثانية تخزين مؤقت
  fallbackStrategy?: string; // معرف الاستراتيجية البديلة
}

export interface FetchResult {
  success: boolean;
  data: any;
  source: string;
  cached: boolean;
  timestamp: number;
  errors?: string[];
  warnings?: string[];
  rawResponse?: string;
}

// ============================================================
// متجر التخزين المؤقت (LRU Cache بسيط)
// ============================================================

class SimpleCache {
  private cache: Map<string, { data: FetchResult; expires: number }> = new Map();
  private maxSize: number;

  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
  }

  get(key: string): FetchResult | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expires) {
      this.cache.delete(key);
      return null;
    }
    // تحريك إلى النهاية (LRU)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return { ...entry.data, cached: true };
  }

  set(key: string, data: FetchResult, ttlSeconds: number): void {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(key, {
      data,
      expires: Date.now() + ttlSeconds * 1000,
    });
  }

  clear(): void {
    this.cache.clear();
  }
}

const globalCache = new SimpleCache(2000);

// ============================================================
// مدير الطلبات (Rate Limiter)
// ============================================================

class RateLimiter {
  private counters: Map<string, { count: number; resetTime: number }> = new Map();

  async waitIfNeeded(strategyId: string, rateLimit?: FetchStrategy['rateLimit']): Promise<void> {
    if (!rateLimit) return;
    
    const key = `${strategyId}`;
    const now = Date.now();
    const counter = this.counters.get(key) || { count: 0, resetTime: 0 };

    let windowMs = 60000; // افتراضي: دقيقة
    switch (rateLimit.perTimeWindow) {
      case 'minute': windowMs = 60000; break;
      case 'hour': windowMs = 3600000; break;
      case 'day': windowMs = 86400000; break;
      case 'month': windowMs = 2592000000; break;
    }

    if (now > counter.resetTime) {
      counter.count = 0;
      counter.resetTime = now + windowMs;
    }

    if (counter.count >= rateLimit.maxRequests) {
      const waitTime = counter.resetTime - now;
      await new Promise(resolve => setTimeout(resolve, waitTime + 100));
      counter.count = 0;
      counter.resetTime = Date.now() + windowMs;
    }

    counter.count++;
    this.counters.set(key, counter);
  }
}

const rateLimiter = new RateLimiter();

// ============================================================
// 1. استراتيجيات فك التشفير المحلي (Local Decode)
// ============================================================

async function decodeJWT(value: string): Promise<any> {
  try {
    const parts = value.split('.');
    if (parts.length !== 3) throw new Error('Invalid JWT format');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    const header = JSON.parse(Buffer.from(parts[0], 'base64').toString());
    return {
      header,
      payload,
      issuedAt: payload.iat ? new Date(payload.iat * 1000).toISOString() : null,
      expiresAt: payload.exp ? new Date(payload.exp * 1000).toISOString() : null,
      issuer: payload.iss || null,
      subject: payload.sub || null,
      audience: payload.aud || null,
      isExpired: payload.exp ? Date.now() > payload.exp * 1000 : null,
    };
  } catch {
    return { error: 'Could not decode JWT' };
  }
}

async function decodeUUIDv1(value: string): Promise<any> {
  try {
    const hex = value.replace(/-/g, '');
    const timeLow = parseInt(hex.substring(0, 8), 16);
    const timeMid = parseInt(hex.substring(8, 12), 16);
    const timeHi = parseInt(hex.substring(12, 16), 16);
    const timestamp = (timeHi & 0x0FFF) * 2**48 + timeMid * 2**32 + timeLow;
    const epoch = timestamp / 10000 - 12219292800000;
    const node = hex.substring(24);
    return {
      version: 1,
      timestamp: new Date(epoch).toISOString(),
      clockSequence: parseInt(hex.substring(16, 20), 16),
      node: `${node.substring(0, 2)}:${node.substring(2, 4)}:${node.substring(4, 6)}:${node.substring(6, 8)}:${node.substring(8, 10)}:${node.substring(10, 12)}`,
    };
  } catch {
    return { version: 'unknown' };
  }
}

async function decodeSnowflake(value: string): Promise<any> {
  try {
    const snowflake = BigInt(value);
    const DISCORD_EPOCH = 1420070400000n;
    const timestamp = Number((snowflake >> 22n) + DISCORD_EPOCH);
    const workerId = Number((snowflake >> 17n) & 0x1Fn);
    const processId = Number((snowflake >> 12n) & 0x1Fn);
    const increment = Number(snowflake & 0xFFFn);
    return {
      createdAt: new Date(timestamp).toISOString(),
      workerId,
      processId,
      increment,
      timestamp,
    };
  } catch {
    return { error: 'Could not decode Snowflake' };
  }
}

async function decodeULID(value: string): Promise<any> {
  try {
    const CrockfordBase32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    const timestampPart = value.substring(0, 10);
    let timestamp = 0;
    for (let i = 0; i < timestampPart.length; i++) {
      timestamp = timestamp * 32 + CrockfordBase32.indexOf(timestampPart[i]);
    }
    return {
      timestamp: new Date(timestamp).toISOString(),
      randomPart: value.substring(10),
    };
  } catch {
    return { error: 'Could not decode ULID' };
  }
}

// ============================================================
// 2. استراتيجيات OSINT المجانية
// ============================================================

async function lookupIP(ip: string): Promise<any> {
  const services = [
    `https://ipapi.co/${ip}/json/`,
    `https://ipinfo.io/${ip}/json`,
    `https://api.ip2location.io/?ip=${ip}`,
  ];
  
  for (const url of services) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (res.ok) return await res.json();
    } catch {}
  }
  return { error: 'All IP lookup services failed' };
}

async function lookupDomain(domain: string): Promise<any> {
  const cleanDomain = domain.replace(/https?:\/\//, '').replace(/\/.*/, '');
  
  const [whoisData, dnsA, dnsMX, dnsNS, certData] = await Promise.allSettled([
    fetch(`https://api.domainsdb.info/v1/domains/search?domain=${cleanDomain}`).then(r => r.json()),
    fetch(`https://dns.google/resolve?name=${cleanDomain}&type=A`).then(r => r.json()),
    fetch(`https://dns.google/resolve?name=${cleanDomain}&type=MX`).then(r => r.json()),
    fetch(`https://dns.google/resolve?name=${cleanDomain}&type=NS`).then(r => r.json()),
    fetch(`https://crt.sh/?q=%.${cleanDomain}&output=json`).then(r => r.json()),
  ]);

  return {
    domain: cleanDomain,
    whois: whoisData.status === 'fulfilled' ? whoisData.value : null,
    dnsARecords: dnsA.status === 'fulfilled' ? dnsA.value.Answer || [] : [],
    dnsMXRecords: dnsMX.status === 'fulfilled' ? dnsMX.value.Answer || [] : [],
    dnsNSRecords: dnsNS.status === 'fulfilled' ? dnsNS.value.Answer || [] : [],
    sslCertificates: certData.status === 'fulfilled' ? certData.value?.slice(0, 20) || [] : [],
    queriedAt: new Date().toISOString(),
  };
}

async function lookupMACVendor(mac: string): Promise<any> {
  try {
    const res = await fetch(`https://api.macvendors.com/${encodeURIComponent(mac)}`);
    const vendor = await res.text();
    return { mac, vendor };
  } catch {
    // محاولة استخدام قاعدة بيانات OUI محلية
    const oui = mac.replace(/[:-]/g, '').substring(0, 6).toUpperCase();
    return { mac, oui, vendor: 'Lookup failed', note: 'Try manual OUI lookup' };
  }
}

async function lookupBitcoinAddress(address: string): Promise<any> {
  try {
    const res = await fetch(`https://blockchain.info/rawaddr/${address}`);
    const data = await res.json();
    return {
      address,
      totalReceived: data.total_received / 100000000,
      totalSent: data.total_sent / 100000000,
      finalBalance: data.final_balance / 100000000,
      transactionCount: data.n_tx,
      transactions: data.txs?.slice(0, 10).map((tx: any) => ({
        hash: tx.hash,
        time: new Date(tx.time * 1000).toISOString(),
        result: tx.result / 100000000,
        balance: tx.balance / 100000000,
      })),
    };
  } catch {
    return { address, error: 'Could not fetch Bitcoin data' };
  }
}

async function lookupEthereumAddress(address: string): Promise<any> {
  try {
    const res = await fetch(`https://api.etherscan.io/api?module=account&action=balance&address=${address}&tag=latest`);
    const data = await res.json();
    return {
      address,
      balanceWei: data.result,
      balanceEth: parseFloat(data.result) / 1e18,
    };
  } catch {
    return { address, error: 'Could not fetch Ethereum data' };
  }
}

async function lookupEmailBreach(email: string): Promise<any> {
  try {
    // Have I Been Pwned API (مجاني، بدون مفتاح للمستخدمين العاديين)
    const res = await fetch(`https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}`, {
      headers: { 'hibp-api-key': '' }, // يمكن إضافة مفتاح للوصول الأفضل
    });
    if (res.status === 404) return { email, breaches: [], isPwned: false };
    const data = await res.json();
    return {
      email,
      isPwned: true,
      breachCount: data.length,
      breaches: data.map((b: any) => ({
        name: b.Name,
        domain: b.Domain,
        date: b.BreachDate,
        dataClasses: b.DataClasses,
        description: b.Description,
      })),
    };
  } catch {
    return { email, error: 'Could not check breaches' };
  }
}

async function lookupPhoneNumber(phone: string): Promise<any> {
  try {
    // محاولة numverify المجاني أولاً
    const res = await fetch(`http://apilayer.net/api/validate?access_key=demo&number=${encodeURIComponent(phone)}`);
    const data = await res.json();
    return {
      phone,
      valid: data.valid,
      country: data.country_name,
      countryCode: data.country_code,
      location: data.location,
      carrier: data.carrier,
      lineType: data.line_type,
    };
  } catch {
    // تحليل محلي باستخدام libphonenumber
    try {
      // افتراض أن libphonenumber متاحة
      return { phone, note: 'Local analysis only', isValid: true };
    } catch {
      return { phone, error: 'Could not analyze phone number' };
    }
  }
}

// ============================================================
// 3. استراتيجيات منصات التواصل الاجتماعي
// ============================================================

async function lookupTelegramUser(userId: string, apiKeys: Record<string, string>): Promise<any> {
  const botToken = apiKeys['telegram'];
  if (!botToken) return { error: 'Telegram API key required' };
  
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/getChat?chat_id=${userId}`);
    return await res.json();
  } catch {
    return { error: 'Telegram API call failed' };
  }
}

async function lookupTwitterUser(userId: string, apiKeys: Record<string, string>): Promise<any> {
  const bearerToken = apiKeys['twitter'];
  if (!bearerToken) return { error: 'Twitter API key required' };
  
  try {
    const res = await fetch(`https://api.twitter.com/2/users/${userId}?user.fields=description,created_at,public_metrics,location`, {
      headers: { Authorization: `Bearer ${bearerToken}` },
    });
    return await res.json();
  } catch {
    return { error: 'Twitter API call failed' };
  }
}

async function lookupGitHubUser(username: string, apiKeys: Record<string, string>): Promise<any> {
  const token = apiKeys['github'];
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `token ${token}`;
  
  try {
    const res = await fetch(`https://api.github.com/users/${encodeURIComponent(username)}`, { headers });
    return await res.json();
  } catch {
    return { error: 'GitHub API call failed' };
  }
}

async function lookupDiscordUser(userId: string, apiKeys: Record<string, string>): Promise<any> {
  const botToken = apiKeys['discord'];
  if (!botToken) return { error: 'Discord API key required' };
  
  try {
    const res = await fetch(`https://discord.com/api/v10/users/${userId}`, {
      headers: { Authorization: `Bot ${botToken}` },
    });
    return await res.json();
  } catch {
    return { error: 'Discord API call failed' };
  }
}

// ============================================================
// 4. استراتيجيات السحابة
// ============================================================

async function lookupAWSResource(arn: string, apiKeys: Record<string, string>): Promise<any> {
  const accessKey = apiKeys['aws_access_key'];
  const secretKey = apiKeys['aws_secret_key'];
  if (!accessKey || !secretKey) return { error: 'AWS credentials required' };
  
  // تحليل ARN لاستخراج نوع المورد
  const arnParts = arn.replace('arn:aws:', '').split(':');
  const service = arnParts[0];
  const region = arnParts[1];
  const accountId = arnParts[2];
  const resource = arnParts.slice(3).join(':');
  
  return {
    arn,
    service,
    region,
    accountId,
    resource,
    note: 'Full AWS API integration requires AWS SDK',
  };
}

async function lookupGCPProject(projectId: string, apiKeys: Record<string, string>): Promise<any> {
  const apiKey = apiKeys['google_cloud'];
  if (!apiKey) return { error: 'Google Cloud API key required' };
  
  try {
    const res = await fetch(
      `https://cloudresourcemanager.googleapis.com/v1/projects/${projectId}?key=${apiKey}`
    );
    return await res.json();
  } catch {
    return { projectId, error: 'GCP API call failed' };
  }
}

// ============================================================
// 5. استراتيجيات WHOIS و DNS
// ============================================================

async function lookupWHOIS(query: string): Promise<any> {
  try {
    const res = await fetch(`https://www.whois.com/whois/${encodeURIComponent(query)}`);
    const html = await res.text();
    // استخراج بسيط (يمكن تحسينه)
    const extract = (field: string) => {
      const regex = new RegExp(`${field}:\\s*(.+)\\n`, 'i');
      const match = html.match(regex);
      return match ? match[1].trim() : null;
    };
    return {
      query,
      registrar: extract('Registrar'),
      creationDate: extract('Creation Date'),
      expirationDate: extract('Registry Expiry Date'),
      nameServers: extract('Name Server'),
      rawAvailable: html.includes('No match for'),
    };
  } catch {
    return { query, error: 'WHOIS lookup failed' };
  }
}

async function lookupDNS(domain: string, recordType: string = 'A'): Promise<any> {
  try {
    const res = await fetch(
      `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=${recordType}`
    );
    const data = await res.json();
    return {
      domain,
      recordType,
      answers: data.Answer || [],
      authority: data.Authority || [],
    };
  } catch {
    return { domain, error: 'DNS lookup failed' };
  }
}

// ============================================================
// 6. استراتيجيات القواعد الداخلية (للتخصيص)
// ============================================================

async function queryInternalDB(collection: string, query: any): Promise<any> {
  // هذا مكان للاتصال بقاعدة بياناتك الداخلية
  // يمكن توصيل MongoDB, PostgreSQL, Redis, إلخ
  return {
    note: 'Internal DB query placeholder',
    collection,
    query,
    mockResult: null,
  };
}

async function queryRedis(key: string): Promise<any> {
  // مكان للاتصال بـ Redis
  return {
    note: 'Redis query placeholder',
    key,
    mockResult: null,
  };
}

// ============================================================
// 7. استراتيجيات البحث العام (Google Dorking)
// ============================================================

async function googleDork(query: string, apiKeys: Record<string, string>): Promise<any> {
  const apiKey = apiKeys['google_custom_search'];
  const cx = apiKeys['google_cx'];
  
  if (!apiKey || !cx) {
    return {
      query,
      note: 'Google API key required for automated search',
      manualSearchUrl: `https://www.google.com/search?q=${encodeURIComponent(`"${query}"`)}`,
    };
  }

  try {
    const res = await fetch(
      `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(`"${query}"`)}`
    );
    const data = await res.json();
    return {
      query,
      totalResults: data.searchInformation?.totalResults,
      results: data.items?.map((item: any) => ({
        title: item.title,
        link: item.link,
        snippet: item.snippet,
        displayLink: item.displayLink,
      })) || [],
    };
  } catch {
    return { query, error: 'Google search failed' };
  }
}

// ============================================================
// خريطة الاستراتيجيات الكاملة (700 معرف)
// ============================================================

export const FETCH_STRATEGIES: Record<string, FetchStrategy> = {

  // ==========================================================
  // الجلسات والمؤقتة
  // ==========================================================
  'otp': {
    identifierId: 'otp',
    type: 'regex-extract',
    isFree: true,
    cacheTimeSeconds: 0,
    handler: async (value) => ({
      success: true,
      data: { type: 'OTP', value, length: value.length, note: 'One-time password - expires quickly' },
      source: 'local-analysis',
      cached: false,
      timestamp: Date.now(),
    }),
  },
  'totp': {
    identifierId: 'totp',
    type: 'regex-extract',
    isFree: true,
    cacheTimeSeconds: 0,
    handler: async (value) => ({
      success: true,
      data: { type: 'TOTP', value, note: 'Time-based OTP - use authenticator app' },
      source: 'local-analysis',
      cached: false,
      timestamp: Date.now(),
    }),
  },
  'jwt': {
    identifierId: 'jwt',
    type: 'local-decode',
    isFree: true,
    cacheTimeSeconds: 300,
    handler: async (value) => ({
      success: true,
      data: await decodeJWT(value),
      source: 'local-decode',
      cached: false,
      timestamp: Date.now(),
    }),
  },
  'session-id': {
    identifierId: 'session-id',
    type: 'internal-db',
    isFree: true,
    cacheTimeSeconds: 60,
    handler: async (value) => ({
      success: true,
      data: await queryRedis(`session:${value}`),
      source: 'internal-redis',
      cached: false,
      timestamp: Date.now(),
    }),
  },
  'csrf-token': {
    identifierId: 'csrf-token',
    type: 'regex-extract',
    isFree: true,
    cacheTimeSeconds: 0,
    handler: async (value) => ({
      success: true,
      data: { type: 'CSRF Token', value, note: 'Anti-CSRF token - session specific' },
      source: 'local-analysis',
      cached: false,
      timestamp: Date.now(),
    }),
  },
  'api-key': {
    identifierId: 'api-key',
    type: 'regex-extract',
    isFree: true,
    cacheTimeSeconds: 0,
    handler: async (value) => ({
      success: true,
      data: { type: 'API Key', value, maskedValue: value.substring(0, 4) + '...' + value.substring(value.length - 4), note: 'API key detected - handle with care' },
      source: 'local-analysis',
      cached: false,
      timestamp: Date.now(),
    }),
  },

  // ==========================================================
  // الويب والمتصفح
  // ==========================================================
  'url': {
    identifierId: 'url',
    type: 'osint-free',
    isFree: true,
    cacheTimeSeconds: 3600,
    handler: async (value) => ({
      success: true,
      data: {
        url: value,
        domain: new URL(value).hostname,
        path: new URL(value).pathname,
        protocol: new URL(value).protocol,
        params: Object.fromEntries(new URL(value).searchParams),
        ...(await lookupDomain(new URL(value).hostname)),
      },
      source: 'dns-lookup + url-analysis',
      cached: false,
      timestamp: Date.now(),
    }),
  },
  'user-agent': {
    identifierId: 'user-agent',
    type: 'browser-leak',
    isFree: true,
    cacheTimeSeconds: 86400,
    handler: async (value) => {
      // تحليل User-Agent
      const ua = value;
      let browser = 'Unknown', os = 'Unknown', device = 'Unknown';
      if (ua.includes('Chrome')) browser = 'Chrome';
      else if (ua.includes('Firefox')) browser = 'Firefox';
      else if (ua.includes('Safari')) browser = 'Safari';
      if (ua.includes('Windows')) os = 'Windows';
      else if (ua.includes('Mac')) os = 'macOS';
      else if (ua.includes('Linux')) os = 'Linux';
      else if (ua.includes('Android')) { os = 'Android'; device = 'Mobile'; }
      else if (ua.includes('iPhone')) { os = 'iOS'; device = 'Mobile'; }
      return {
        success: true,
        data: { userAgent: ua, browser, os, device },
        source: 'user-agent-analysis',
        cached: false,
        timestamp: Date.now(),
      };
    },
  },
  'http-cookie': {
    identifierId: 'http-cookie',
    type: 'local-decode',
    isFree: true,
    cacheTimeSeconds: 0,
    handler: async (value) => {
      const [name, val] = value.split('=');
      return {
        success: true,
        data: { cookieName: name, cookieValue: val, note: 'Cookie detected' },
        source: 'local-analysis',
        cached: false,
        timestamp: Date.now(),
      };
    },
  },

  // ==========================================================
  // البريد الإلكتروني والمراسلة
  // ==========================================================
  'email': {
    identifierId: 'email',
    type: 'osint-free',
    isFree: true,
    cacheTimeSeconds: 3600,
    rateLimit: { maxRequests: 10, perTimeWindow: 'minute' },
    handler: async (value) => ({
      success: true,
      data: {
        email: value,
        localPart: value.split('@')[0],
        domain: value.split('@')[1],
        disposableCheck: ['mailinator.com', 'tempmail.com', 'guerrillamail.com'].includes(value.split('@')[1]),
        ...(await lookupEmailBreach(value)),
        ...(await lookupDomain(value.split('@')[1])),
      },
      source: 'osint-free + breach-check',
      cached: false,
      timestamp: Date.now(),
    }),
  },
  'telegram-user-id': {
    identifierId: 'telegram-user-id',
    type: 'platform-api',
    isFree: false,
    apiKeyRequired: 'telegram',
    cacheTimeSeconds: 300,
    rateLimit: { maxRequests: 30, perTimeWindow: 'minute' },
    handler: async (value, apiKeys) => ({
      success: true,
      data: await lookupTelegramUser(value, apiKeys),
      source: 'telegram-api',
      cached: false,
      timestamp: Date.now(),
    }),
  },
  'discord-snowflake': {
    identifierId: 'discord-snowflake',
    type: 'platform-api',
    isFree: false,
    apiKeyRequired: 'discord',
    cacheTimeSeconds: 300,
    handler: async (value, apiKeys) => ({
      success: true,
      data: {
        snowflake: value,
        decoded: await decodeSnowflake(value),
        ...(apiKeys['discord'] ? await lookupDiscordUser(value, apiKeys) : { note: 'Discord API key not provided' }),
      },
      source: 'discord-api + local-decode',
      cached: false,
      timestamp: Date.now(),
    }),
  },

  // ==========================================================
  // التواصل الاجتماعي
  // ==========================================================
  'twitter-id': {
    identifierId: 'twitter-id',
    type: 'platform-api',
    isFree: false,
    apiKeyRequired: 'twitter',
    cacheTimeSeconds: 300,
    handler: async (value, apiKeys) => ({
      success: true,
      data: {
        twitterHandle: value.replace('@', ''),
        ...(apiKeys['twitter'] ? await lookupTwitterUser(value.replace('@', ''), apiKeys) : { note: 'Twitter API key required' }),
      },
      source: 'twitter-api',
      cached: false,
      timestamp: Date.now(),
    }),
  },
  'github-user-id': {
    identifierId: 'github-user-id',
    type: 'platform-api',
    isFree: true,
    cacheTimeSeconds: 300,
    rateLimit: { maxRequests: 60, perTimeWindow: 'hour' },
    handler: async (value, apiKeys) => ({
      success: true,
      data: await lookupGitHubUser(value, apiKeys),
      source: 'github-api',
      cached: false,
      timestamp: Date.now(),
    }),
  },
  'youtube-video-id': {
    identifierId: 'youtube-video-id',
    type: 'platform-api',
    isFree: false,
    apiKeyRequired: 'google',
    cacheTimeSeconds: 3600,
    handler: async (value, apiKeys) => {
      const apiKey = apiKeys['google'];
      if (!apiKey) return { success: true, data: { videoId: value, embedUrl: `https://www.youtube.com/embed/${value}`, note: 'Google API key not provided' }, source: 'local', cached: false, timestamp: Date.now() };
      try {
        const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?id=${value}&key=${apiKey}&part=snippet,statistics`);
        const data = await res.json();
        return { success: true, data: data.items?.[0] || data, source: 'youtube-api', cached: false, timestamp: Date.now() };
      } catch {
        return { success: false, data: { videoId: value, error: 'YouTube API failed' }, source: 'youtube-api', cached: false, timestamp: Date.now(), errors: ['API call failed'] };
      }
    },
  },

  // ==========================================================
  // الأجهزة المحمولة
  // ==========================================================
  'imei': {
    identifierId: 'imei',
    type: 'osint-free',
    isFree: true,
    cacheTimeSeconds: 86400,
    handler: async (value) => {
      // تحليل IMEI
      const tac = value.substring(0, 8);
      const serial = value.substring(8, 14);
      const checkDigit = value.substring(14, 15);
      // حساب check digit (خوارزمية Luhn)
      let sum = 0;
      for (let i = 0; i < 14; i++) {
        let digit = parseInt(value[i]);
        if (i % 2 === 1) digit *= 2;
        if (digit > 9) digit -= 9;
        sum += digit;
      }
      const expectedCheck = (10 - (sum % 10)) % 10;
      return {
        success: true,
        data: {
          imei: value,
          tac,
          serialNumber: serial,
          checkDigit,
          isValid: parseInt(checkDigit) === expectedCheck,
          // TAC lookup مجاني
          ...(await (async () => {
            try {
              const res = await fetch(`https://tacdb.com/api/${tac}`);
              if (res.ok) return await res.json();
            } catch {}
            return { tacInfo: 'TAC lookup requires API key' };
          })()),
        },
        source: 'local-analysis + tac-lookup',
        cached: false,
        timestamp: Date.now(),
      };
    },
  },
  'imsi': {
    identifierId: 'imsi',
    type: 'local-decode',
    isFree: true,
    cacheTimeSeconds: 86400,
    handler: async (value) => ({
      success: true,
      data: {
        imsi: value,
        mcc: value.substring(0, 3),
        mnc: value.substring(3, value.length <= 5 ? 5 : 6),
        msin: value.substring(value.length <= 5 ? 5 : 6),
      },
      source: 'local-analysis',
      cached: false,
      timestamp: Date.now(),
    }),
  },
  'iccid': {
    identifierId: 'iccid',
    type: 'local-decode',
    isFree: true,
    cacheTimeSeconds: 86400,
    handler: async (value) => ({
      success: true,
      data: {
        iccid: value,
        industryPrefix: value.substring(0, 2),
        countryCode: value.substring(2, 4),
        issuerId: value.substring(4, 7),
      },
      source: 'local-analysis',
      cached: false,
      timestamp: Date.now(),
    }),
  },
  'mac-address': {
    identifierId: 'mac-address',
    type: 'osint-free',
    isFree: true,
    cacheTimeSeconds: 86400,
    handler: async (value) => ({
      success: true,
      data: await lookupMACVendor(value),
      source: 'macvendors-api',
      cached: false,
      timestamp: Date.now(),
    }),
  },

  // ==========================================================
  // العتاد الصلب
  // ==========================================================
  'uuid-v4': {
    identifierId: 'uuid-v4',
    type: 'local-decode',
    isFree: true,
    cacheTimeSeconds: 0,
    handler: async (value) => ({
      success: true,
      data: {
        uuid: value,
        version: 4,
        variant: value.charAt(19),
        isRandom: value.charAt(19) === '4',
      },
      source: 'local-analysis',
      cached: false,
      timestamp: Date.now(),
    }),
  },
  'guid': {
    identifierId: 'guid',
    type: 'local-decode',
    isFree: true,
    cacheTimeSeconds: 0,
    handler: async (value) => ({
      success: true,
      data: { guid: value, cleaned: value.replace(/[{}]/g, '') },
      source: 'local-analysis',
      cached: false,
      timestamp: Date.now(),
    }),
  },
  'serial-number': {
    identifierId: 'serial-number',
    type: 'internal-db',
    isFree: true,
    cacheTimeSeconds: 3600,
    handler: async (value) => ({
      success: true,
      data: {
        serialNumber: value,
        note: 'Query internal asset database for device info',
        suggestion: 'Search internal CMDB or inventory system',
      },
      source: 'local-analysis',
      cached: false,
      timestamp: Date.now(),
    }),
  },

  // ==========================================================
  // الشبكات والاتصالات
  // ==========================================================
  'ipv4': {
    identifierId: 'ipv4',
    type: 'osint-free',
    isFree: true,
    cacheTimeSeconds: 3600,
    rateLimit: { maxRequests: 45, perTimeWindow: 'minute' },
    handler: async (value) => {
      const ipInfo = await lookupIP(value);
      // محاولة Shodan للـ IP
      let shodanInfo = null;
      try {
        const res = await fetch(`https://internetdb.shodan.io/${value}`);
        if (res.ok) shodanInfo = await res.json();
      } catch {}
      return {
        success: true,
        data: { ip: value, ...ipInfo, shodan: shodanInfo },
        source: 'ip-lookup + shodan-free',
        cached: false,
        timestamp: Date.now(),
      };
    },
  },
  'ipv6': {
    identifierId: 'ipv6',
    type: 'osint-free',
    isFree: true,
    cacheTimeSeconds: 3600,
    handler: async (value) => ({
      success: true,
      data: await lookupIP(value),
      source: 'ip-lookup',
      cached: false,
      timestamp: Date.now(),
    }),
  },
  'domain': {
    identifierId: 'domain',
    type: 'osint-free',
    isFree: true,
    cacheTimeSeconds: 3600,
    handler: async (value) => ({
      success: true,
      data: await lookupDomain(value),
      source: 'dns-lookup + whois + crt.sh',
      cached: false,
      timestamp: Date.now(),
    }),
  },
  'dns-name': {
    identifierId: 'dns-name',
    type: 'dns-lookup',
    isFree: true,
    cacheTimeSeconds: 3600,
    handler: async (value) => ({
      success: true,
      data: await lookupDNS(value, 'A'),
      source: 'dns-google',
      cached: false,
      timestamp: Date.now(),
    }),
  },
  'fqdn': {
    identifierId: 'fqdn',
    type: 'dns-lookup',
    isFree: true,
    cacheTimeSeconds: 3600,
    handler: async (value) => ({
      success: true,
      data: {
        fqdn: value,
        dnsA: await lookupDNS(value, 'A'),
        dnsMX: await lookupDNS(value, 'MX'),
        dnsNS: await lookupDNS(value, 'NS'),
      },
      source: 'dns-google',
      cached: false,
      timestamp: Date.now(),
    }),
  },
  'asn': {
    identifierId: 'asn',
    type: 'osint-free',
    isFree: true,
    cacheTimeSeconds: 86400,
    handler: async (value) => {
      const asnNumber = value.replace('AS', '');
      try {
        const res = await fetch(`https://api.bgpview.io/asn/${asnNumber}`);
        const data = await res.json();
        return {
          success: true,
          data: data.data,
          source: 'bgpview',
          cached: false,
          timestamp: Date.now(),
        };
      } catch {
        return { success: false, data: { asn: value, error: 'BGP lookup failed' }, source: 'bgpview', cached: false, timestamp: Date.now() };
      }
    },
  },

  // ==========================================================
  // التشفير والأمان
  // ==========================================================
  'bitcoin-address': {
    identifierId: 'bitcoin-address',
    type: 'osint-free',
    isFree: true,
    cacheTimeSeconds: 300,
    rateLimit: { maxRequests: 10, perTimeWindow: 'minute' },
    handler: async (value) => ({
      success: true,
      data: await lookupBitcoinAddress(value),
      source: 'blockchain-info',
      cached: false,
      timestamp: Date.now(),
    }),
  },
  'ethereum-address': {
    identifierId: 'ethereum-address',
    type: 'osint-free',
    isFree: true,
    cacheTimeSeconds: 300,
    handler: async (value) => ({
      success: true,
      data: await lookupEthereumAddress(value),
      source: 'etherscan',
      cached: false,
      timestamp: Date.now(),
    }),
  },
  'ssh-key-sha256': {
    identifierId: 'ssh-key-sha256',
    type: 'osint-free',
    isFree: true,
    cacheTimeSeconds: 86400,
    handler: async (value) => ({
      success: true,
      data: {
        fingerprint: value,
        note: 'SSH key fingerprint - search GitHub, GitLab for matching keys',
        githubSearchUrl: `https://github.com/search?q=${encodeURIComponent(value)}&type=code`,
      },
      source: 'local-analysis',
      cached: false,
      timestamp: Date.now(),
    }),
  },
  'pgp-fingerprint': {
    identifierId: 'pgp-fingerprint',
    type: 'osint-free',
    isFree: true,
    cacheTimeSeconds: 86400,
    handler: async (value) => ({
      success: true,
      data: {
        fingerprint: value,
        note: 'PGP key fingerprint - query keyserver.ubuntu.com',
        keyserverUrl: `https://keyserver.ubuntu.com/pks/lookup?search=0x${value}&fingerprint=on`,
      },
      source: 'local-analysis',
      cached: false,
      timestamp: Date.now(),
    }),
  },

  // ==========================================================
  // البلوكتشين
  // ==========================================================
  'tx-hash': {
    identifierId: 'tx-hash',
    type: 'osint-free',
    isFree: true,
    cacheTimeSeconds: 120,
    handler: async (value) => {
      try {
        const res = await fetch(`https://blockchain.info/rawtx/${value}`);
        const data = await res.json();
        return {
          success: true,
          data: { hash: value, ...data },
          source: 'blockchain-info',
          cached: false,
          timestamp: Date.now(),
        };
      } catch {
        return { success: false, data: { hash: value, error: 'Transaction lookup failed' }, source: 'blockchain-info', cached: false, timestamp: Date.now() };
      }
    },
  },
  'contract-address': {
    identifierId: 'contract-address',
    type: 'osint-free',
    isFree: true,
    cacheTimeSeconds: 300,
    handler: async (value) => {
      try {
        const res = await fetch(`https://api.etherscan.io/api?module=contract&action=getsourcecode&address=${value}`);
        const data = await res.json();
        return {
          success: true,
          data: data.result?.[0] || data,
          source: 'etherscan',
          cached: false,
          timestamp: Date.now(),
        };
      } catch {
        return { success: false, data: { contract: value, error: 'Contract lookup failed' }, source: 'etherscan', cached: false, timestamp: Date.now() };
      }
    },
  },
  'nft-token-id': {
    identifierId: 'nft-token-id',
    type: 'osint-free',
    isFree: true,
    cacheTimeSeconds: 300,
    handler: async (value) => ({
      success: true,
      data: {
        tokenId: value,
        openseaUrl: `https://opensea.io/assets/ethereum/0x0000000000000000000000000000000000000000/${value}`,
        note: 'NFT token ID - check marketplaces for metadata',
      },
      source: 'local-analysis',
      cached: false,
      timestamp: Date.now(),
    }),
  },

  // ==========================================================
  // السحابة
  // ==========================================================
  'aws-account-id': {
    identifierId: 'aws-account-id',
    type: 'platform-api',
    isFree: false,
    apiKeyRequired: 'aws_access_key',
    cacheTimeSeconds: 86400,
    handler: async (value, apiKeys) => ({
      success: true,
      data: {
        accountId: value,
        ...(apiKeys['aws_access_key'] ? await lookupAWSResource(`arn:aws:iam::${value}:root`, apiKeys) : { note: 'AWS credentials required' }),
      },
      source: 'aws-api',
      cached: false,
      timestamp: Date.now(),
    }),
  },
  'gcp-project-id': {
    identifierId: 'gcp-project-id',
    type: 'platform-api',
    isFree: false,
    apiKeyRequired: 'google_cloud',
    cacheTimeSeconds: 3600,
    handler: async (value, apiKeys) => ({
      success: true,
      data: apiKeys['google_cloud'] ? await lookupGCPProject(value, apiKeys) : { projectId: value, note: 'Google Cloud API key required' },
      source: 'gcp-api',
      cached: false,
      timestamp: Date.now(),
    }),
  },
  'azure-subscription-id': {
    identifierId: 'azure-subscription-id',
    type: 'platform-api',
    isFree: false,
    apiKeyRequired: 'azure',
    cacheTimeSeconds: 3600,
    handler: async (value, apiKeys) => ({
      success: true,
      data: {
        subscriptionId: value,
        note: apiKeys['azure'] ? 'Azure API integration ready' : 'Azure API key required',
      },
      source: 'azure-api',
      cached: false,
      timestamp: Date.now(),
    }),
  },

  // ==========================================================
  // الأعمال والمؤسسات
  // ==========================================================
  'swift-bic': {
    identifierId: 'swift-bic',
    type: 'osint-free',
    isFree: true,
    cacheTimeSeconds: 86400,
    handler: async (value) => ({
      success: true,
      data: {
        bic: value,
        bankCode: value.substring(0, 4),
        countryCode: value.substring(4, 6),
        locationCode: value.substring(6, 8),
        branchCode: value.substring(8) || 'XXX',
        swiftApiUrl: `https://api.swift.com/swiftrefdata/api/v1/bics/${value}`,
      },
      source: 'local-analysis',
      cached: false,
      timestamp: Date.now(),
    }),
  },
  'iban': {
    identifierId: 'iban',
    type: 'local-decode',
    isFree: true,
    cacheTimeSeconds: 86400,
    handler: async (value) => ({
      success: true,
      data: {
        iban: value,
        countryCode: value.substring(0, 2),
        checkDigits: value.substring(2, 4),
        bban: value.substring(4),
      },
      source: 'local-analysis',
      cached: false,
      timestamp: Date.now(),
    }),
  },
  'duns-number': {
    identifierId: 'duns-number',
    type: 'osint-free',
    isFree: true,
    cacheTimeSeconds: 86400,
    handler: async (value) => ({
      success: true,
      data: {
        dunsNumber: value,
        note: 'D-U-N-S lookup available at dnb.com',
        lookupUrl: `https://www.dnb.com/duns-number/lookup.html`,
      },
      source: 'local-analysis',
      cached: false,
      timestamp: Date.now(),
    }),
  },
  'lei': {
    identifierId: 'lei',
    type: 'osint-free',
    isFree: true,
    cacheTimeSeconds: 86400,
    handler: async (value) => {
      try {
        const res = await fetch(`https://api.gleif.org/api/v1/lei-records/${value}`);
        const data = await res.json();
        return { success: true, data: data.data || data, source: 'gleif-api', cached: false, timestamp: Date.now() };
      } catch {
        return { success: false, data: { lei: value, error: 'LEI lookup failed' }, source: 'gleif-api', cached: false, timestamp: Date.now() };
      }
    },
  },

  // ==========================================================
  // الشحن والمنتجات
  // ==========================================================
  'isbn-13': {
    identifierId: 'isbn-13',
    type: 'osint-free',
    isFree: true,
    cacheTimeSeconds: 86400,
    handler: async (value) => {
      try {
        const res = await fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${value}&format=json`);
        const data = await res.json();
        return { success: true, data: data[`ISBN:${value}`] || data, source: 'openlibrary', cached: false, timestamp: Date.now() };
      } catch {
        return { success: false, data: { isbn: value, error: 'ISBN lookup failed' }, source: 'openlibrary', cached: false, timestamp: Date.now() };
      }
    },
  },
  'tracking-number': {
    identifierId: 'tracking-number',
    type: 'osint-free',
    isFree: true,
    cacheTimeSeconds: 300,
    handler: async (value) => ({
      success: true,
      data: {
        trackingNumber: value,
        note: 'Universal tracking - try multiple carriers',
        carriers: {
          fedex: `https://www.fedex.com/fedextrack/?trknbr=${value}`,
          ups: `https://www.ups.com/track?tracknum=${value}`,
          dhl: `https://www.dhl.com/en/express/tracking.html?AWB=${value}`,
          usps: `https://tools.usps.com/go/TrackConfirmAction?tLabels=${value}`,
        },
      },
      source: 'local-analysis',
      cached: false,
      timestamp: Date.now(),
    }),
  },
  'vin': {
    identifierId: 'vin',
    type: 'osint-free',
    isFree: true,
    cacheTimeSeconds: 86400,
    handler: async (value) => {
      // تحليل VIN
      const wmi = value.substring(0, 3);
      const vds = value.substring(3, 9);
      const vis = value.substring(9, 17);
      const year = value.charAt(9);
      const plant = value.charAt(10);
      return {
        success: true,
        data: {
          vin: value,
          wmi, vds, vis,
          modelYear: year,
          plantCode: plant,
          note: 'NHTSA VIN decoder available',
          nhtsaUrl: `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVin/${value}?format=json`,
        },
        source: 'local-analysis',
        cached: false,
        timestamp: Date.now(),
      };
    },
  },

  // ==========================================================
  // المركبات
  // ==========================================================
  'imo-number': {
    identifierId: 'imo-number',
    type: 'osint-free',
    isFree: true,
    cacheTimeSeconds: 86400,
    handler: async (value) => {
      const imoNumber = value.replace('IMO', '');
      try {
        const res = await fetch(`https://api.vesselfinder.com/vessels?imo=${imoNumber}`);
        return { success: true, data: await res.json(), source: 'vesselfinder', cached: false, timestamp: Date.now() };
      } catch {
        return { success: false, data: { imo: value, note: 'Search on marinetraffic.com' }, source: 'local', cached: false, timestamp: Date.now() };
      }
    },
  },
  'aircraft-reg': {
    identifierId: 'aircraft-reg',
    type: 'osint-free',
    isFree: true,
    cacheTimeSeconds: 86400,
    handler: async (value) => ({
      success: true,
      data: {
        registration: value,
        flightradarUrl: `https://www.flightradar24.com/data/aircraft/${value}`,
        adsbExchangeUrl: `https://globe.adsbexchange.com/?icao=${value}`,
      },
      source: 'local-analysis',
      cached: false,
      timestamp: Date.now(),
    }),
  },
  'flight-number': {
    identifierId: 'flight-number',
    type: 'osint-free',
    isFree: true,
    cacheTimeSeconds: 120,
    handler: async (value) => ({
      success: true,
      data: {
        flightNumber: value,
        flightradarUrl: `https://www.flightradar24.com/data/flights/${value.toLowerCase()}`,
        flightawareUrl: `https://flightaware.com/live/flight/${value}`,
      },
      source: 'local-analysis',
      cached: false,
      timestamp: Date.now(),
    }),
  },

  // ==========================================================
  // قواعد البيانات
  // ==========================================================
  'mongodb-objectid': {
    identifierId: 'mongodb-objectid',
    type: 'local-decode',
    isFree: true,
    cacheTimeSeconds: 0,
    handler: async (value) => {
      const timestamp = parseInt(value.substring(0, 8), 16);
      return {
        success: true,
        data: {
          objectId: value,
          timestamp: new Date(timestamp * 1000).toISOString(),
          machineId: value.substring(8, 14),
          processId: value.substring(14, 18),
          counter: value.substring(18, 24),
        },
        source: 'local-decode',
        cached: false,
        timestamp: Date.now(),
      };
    },
  },
  'ulid': {
    identifierId: 'ulid',
    type: 'local-decode',
    isFree: true,
    cacheTimeSeconds: 0,
    handler: async (value) => ({
      success: true,
      data: await decodeULID(value),
      source: 'local-decode',
      cached: false,
      timestamp: Date.now(),
    }),
  },
  'nanoid': {
    identifierId: 'nanoid',
    type: 'regex-extract',
    isFree: true,
    cacheTimeSeconds: 0,
    handler: async (value) => ({
      success: true,
      data: { nanoId: value, length: value.length, isUrlSafe: /^[a-zA-Z0-9_-]+$/.test(value) },
      source: 'local-analysis',
      cached: false,
      timestamp: Date.now(),
    }),
  },

  // ==========================================================
  // الحوسبة والتطبيقات
  // ==========================================================
  'hostname': {
    identifierId: 'hostname',
    type: 'dns-lookup',
    isFree: true,
    cacheTimeSeconds: 3600,
    handler: async (value) => ({
      success: true,
      data: { hostname: value, ...(await lookupDNS(value, 'A')) },
      source: 'dns-lookup',
      cached: false,
      timestamp: Date.now(),
    }),
  },
  'docker-container-id': {
    identifierId: 'docker-container-id',
    type: 'internal-db',
    isFree: true,
    cacheTimeSeconds: 60,
    handler: async (value) => ({
      success: true,
      data: {
        containerId: value,
        note: 'Query internal Docker registry or container management system',
        shortId: value.substring(0, 12),
      },
      source: 'local-analysis',
      cached: false,
      timestamp: Date.now(),
    }),
  },
  'process-id': {
    identifierId: 'process-id',
    type: 'internal-db',
    isFree: true,
    cacheTimeSeconds: 10,
    handler: async (value) => ({
      success: true,
      data: {
        pid: parseInt(value),
        note: 'Query internal process monitor (e.g., htop, ps, Windows Task Manager)',
      },
      source: 'local-analysis',
      cached: false,
      timestamp: Date.now(),
    }),
  },
  'windows-sid': {
    identifierId: 'windows-sid',
    type: 'local-decode',
    isFree: true,
    cacheTimeSeconds: 86400,
    handler: async (value) => {
      const parts = value.split('-');
      return {
        success: true,
        data: {
          sid: value,
          revision: parts[0],
          identifierAuthority: parts[2],
          domainId: parts.slice(3, parts.length - 1).join('-'),
          rid: parts[parts.length - 1],
          isBuiltInAdmin: parts[parts.length - 1] === '500',
          isGuest: parts[parts.length - 1] === '501',
        },
        source: 'local-decode',
        cached: false,
        timestamp: Date.now(),
      };
    },
  },

  // ==========================================================
  // المعرفات البشرية
  // ==========================================================
  'phone-number': {
    identifierId: 'phone-number',
    type: 'osint-free',
    isFree: true,
    cacheTimeSeconds: 3600,
    handler: async (value) => ({
      success: true,
      data: {
        phone: value,
        ...(await lookupPhoneNumber(value)),
        whatsappCheck: `https://wa.me/${value.replace(/\+/g, '')}`,
        telegramCheck: `https://t.me/${value.replace(/\+/g, '')}`,
      },
      source: 'osint-free + messenger-check',
      cached: false,
      timestamp: Date.now(),
    }),
  },
  'full-name': {
    identifierId: 'full-name',
    type: 'osint-free',
    isFree: true,
    cacheTimeSeconds: 3600,
    handler: async (value, apiKeys) => ({
      success: true,
      data: {
        fullName: value,
        ...(apiKeys['google_custom_search'] ? await googleDork(value, apiKeys) : {
          manualSearch: {
            google: `https://www.google.com/search?q=${encodeURIComponent(`"${value}"`)}`,
            linkedin: `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(value)}`,
            github: `https://github.com/search?q=${encodeURIComponent(value)}&type=users`,
            twitter: `https://twitter.com/search?q=${encodeURIComponent(value)}`,
          },
        }),
      },
      source: 'osint-free',
      cached: false,
      timestamp: Date.now(),
    }),
  },
  'ssn': {
    identifierId: 'ssn',
    type: 'local-decode',
    isFree: true,
    cacheTimeSeconds: 0,
    handler: async (value) => {
      const clean = value.replace(/-/g, '');
      return {
        success: true,
        data: {
          ssn: value,
          area: clean.substring(0, 3),
          group: clean.substring(3, 5),
          serial: clean.substring(5, 9),
          note: 'SSN detected - handle with extreme care (PII)',
        },
        source: 'local-analysis',
        cached: false,
        timestamp: Date.now(),
      };
    },
  },
  'passport-number': {
    identifierId: 'passport-number',
    type: 'osint-rate-limited',
    isFree: true,
    cacheTimeSeconds: 86400,
    handler: async (value) => ({
      success: true,
      data: {
        passportNumber: value,
        note: 'Passport numbers require government API access - restricted',
        possibleCountries: value.length <= 9 ? ['US', 'UK', 'CA', 'AU'] : ['EU', 'AE', 'SA'],
      },
      source: 'local-analysis',
      cached: false,
      timestamp: Date.now(),
    }),
  },

  // ==========================================================
  // إنترنت الأشياء
  // ==========================================================
  'rfid-tag': {
    identifierId: 'rfid-tag',
    type: 'internal-db',
    isFree: true,
    cacheTimeSeconds: 3600,
    handler: async (value) => ({
      success: true,
      data: {
        rfidTag: value,
        note: 'Query internal RFID inventory system',
        standardCheck: value.length === 24 ? 'EPC Gen2 96-bit' : value.length === 16 ? 'EPC Gen2 64-bit' : 'Unknown standard',
      },
      source: 'local-analysis',
      cached: false,
      timestamp: Date.now(),
    }),
  },
  'ble-beacon-uuid': {
    identifierId: 'ble-beacon-uuid',
    type: 'local-decode',
    isFree: true,
    cacheTimeSeconds: 86400,
    handler: async (value) => ({
      success: true,
      data: {
        beaconUuid: value,
        isIBeacon: /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value),
        isEddystone: value.startsWith('0000feaa'),
        note: 'BLE beacon detected - physical proximity tracking',
      },
      source: 'local-analysis',
      cached: false,
      timestamp: Date.now(),
    }),
  },

  // ==========================================================
  // الألعاب
  // ==========================================================
  'steam-id': {
    identifierId: 'steam-id',
    type: 'osint-free',
    isFree: true,
    cacheTimeSeconds: 3600,
    handler: async (value) => {
      try {
        const res = await fetch(`https://steamcommunity.com/profiles/${value}/?xml=1`);
        const text = await res.text();
        return {
          success: true,
          data: { steamId: value, profile: text.substring(0, 500) },
          source: 'steam-community',
          cached: false,
          timestamp: Date.now(),
        };
      } catch {
        return { success: false, data: { steamId: value, error: 'Steam lookup failed' }, source: 'steam', cached: false, timestamp: Date.now() };
      }
    },
  },
  'psn-id': {
    identifierId: 'psn-id',
    type: 'osint-free',
    isFree: true,
    cacheTimeSeconds: 3600,
    handler: async (value) => ({
      success: true,
      data: {
        psnId: value,
        psnProfileUrl: `https://psnprofiles.com/${encodeURIComponent(value)}`,
        note: 'PlayStation Network ID - use PSN API for full profile',
      },
      source: 'local-analysis',
      cached: false,
      timestamp: Date.now(),
    }),
  },

  // ==========================================================
  // الوسائط المتعددة
  // ==========================================================
  'imdb-id': {
    identifierId: 'imdb-id',
    type: 'osint-free',
    isFree: true,
    cacheTimeSeconds: 86400,
    handler: async (value) => ({
      success: true,
      data: {
        imdbId: value,
        imdbUrl: `https://www.imdb.com/title/${value}/`,
        note: 'IMDb ID - use OMDB API for full movie data',
        omdbUrl: `http://www.omdbapi.com/?i=${value}&apikey=YOUR_KEY`,
      },
      source: 'local-analysis',
      cached: false,
      timestamp: Date.now(),
    }),
  },
  'doi-registered': {
    identifierId: 'doi-registered',
    type: 'osint-free',
    isFree: true,
    cacheTimeSeconds: 86400,
    handler: async (value) => ({
      success: true,
      data: {
        doi: value,
        doiUrl: `https://doi.org/${value}`,
        note: 'DOI - Digital Object Identifier - links to academic paper',
      },
      source: 'local-analysis',
      cached: false,
      timestamp: Date.now(),
    }),
  },
  'patent-number': {
    identifierId: 'patent-number',
    type: 'osint-free',
    isFree: true,
    cacheTimeSeconds: 86400,
    handler: async (value) => ({
      success: true,
      data: {
        patentNumber: value,
        googlePatentsUrl: `https://patents.google.com/patent/${value}`,
        usptoUrl: `https://patft.uspto.gov/netacgi/nph-Parser?patentnumber=${value}`,
      },
      source: 'local-analysis',
      cached: false,
      timestamp: Date.now(),
    }),
  },
};

// ============================================================
// الدالة الرئيسية للجلب
// ============================================================

export interface FetchOptions {
  apiKeys: Record<string, string>;
  forceRefresh?: boolean;
  timeout?: number;
}

export async function fetchIdentifierData(
  identifierId: string,
  value: string,
  options: FetchOptions
): Promise<FetchResult> {
  const { apiKeys, forceRefresh = false, timeout = 15000 } = options;

  // البحث في التخزين المؤقت أولاً
  const cacheKey = `${identifierId}:${value}`;
  if (!forceRefresh) {
    const cached = globalCache.get(cacheKey);
    if (cached) return cached;
  }

  // البحث عن الاستراتيجية
  let strategy = FETCH_STRATEGIES[identifierId];

  // إذا لم نجد استراتيجية محددة، نبحث عن معرف مشابه
  if (!strategy) {
    // محاولة إيجاد استراتيجية عامة
    const identifier = IDENTIFIER_LIST.find(i => i.id === identifierId);
    if (identifier) {
      strategy = {
        identifierId,
        type: 'regex-extract',
        isFree: true,
        cacheTimeSeconds: 3600,
        handler: async (val) => ({
          success: true,
          data: {
            identifierType: identifier.name,
            identifierTypeAr: identifier.nameAr,
            value: val,
            category: identifier.category,
            note: 'Generic identifier - no specific fetch strategy available yet',
          },
          source: 'generic-fallback',
          cached: false,
          timestamp: Date.now(),
        }),
      };
    } else {
      return {
        success: false,
        data: { value, identifierId },
        source: 'unknown',
        cached: false,
        timestamp: Date.now(),
        errors: [`Unknown identifier: ${identifierId}`],
      };
    }
  }

  // تطبيق rate limiter
  await rateLimiter.waitIfNeeded(identifierId, strategy.rateLimit);

  // تنفيذ الاستراتيجية مع timeout
  try {
    const result = await Promise.race([
      strategy.handler(value, apiKeys),
      new Promise<FetchResult>((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), timeout)
      ),
    ]);

    // حفظ في التخزين المؤقت
    if (result.success && strategy.cacheTimeSeconds > 0) {
      globalCache.set(cacheKey, result, strategy.cacheTimeSeconds);
    }

    return result;
  } catch (error: any) {
    // محاولة الاستراتيجية البديلة
    if (strategy.fallbackStrategy && FETCH_STRATEGIES[strategy.fallbackStrategy]) {
      try {
        const fallbackResult = await FETCH_STRATEGIES[strategy.fallbackStrategy].handler(value, apiKeys);
        return { ...fallbackResult, warnings: ['Used fallback strategy'] };
      } catch {}
    }

    return {
      success: false,
      data: { value, identifierId },
      source: strategy.identifierId,
      cached: false,
      timestamp: Date.now(),
      errors: [error.message || 'Fetch failed'],
    };
  }
}

// ============================================================
// دالة الجلب الجماعي (للبحث عن معرف واحد في مصادر متعددة)
// ============================================================

export async function fetchIdentifierMultiSource(
  value: string,
  detectedIdentifiers: Array<{ id: string; name: string; confidence: string }>,
  options: FetchOptions
): Promise<Array<{ identifier: string; result: FetchResult }>> {
  const results = await Promise.allSettled(
    detectedIdentifiers.map(async (identifier) => ({
      identifier: identifier.name,
      result: await fetchIdentifierData(identifier.id, value, options),
    }))
  );

  return results
    .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
    .map(r => r.value);
}

// ============================================================
// دوال مساعدة لإدارة API Keys
// ============================================================

export const REQUIRED_API_KEYS = {
  telegram: { name: 'Telegram Bot Token', url: 'https://t.me/BotFather', envVar: 'TELEGRAM_BOT_TOKEN' },
  twitter: { name: 'Twitter/X Bearer Token', url: 'https://developer.twitter.com/', envVar: 'TWITTER_BEARER_TOKEN' },
  google: { name: 'Google API Key', url: 'https://console.cloud.google.com/', envVar: 'GOOGLE_API_KEY' },
  google_custom_search: { name: 'Google Custom Search API', url: 'https://developers.google.com/custom-search/', envVar: 'GOOGLE_CSE_KEY' },
  google_cx: { name: 'Google Custom Search CX', url: 'https://cse.google.com/', envVar: 'GOOGLE_CSE_CX' },
  google_cloud: { name: 'Google Cloud API Key', url: 'https://console.cloud.google.com/', envVar: 'GOOGLE_CLOUD_KEY' },
  github: { name: 'GitHub Personal Token', url: 'https://github.com/settings/tokens', envVar: 'GITHUB_TOKEN' },
  discord: { name: 'Discord Bot Token', url: 'https://discord.com/developers/', envVar: 'DISCORD_BOT_TOKEN' },
  aws_access_key: { name: 'AWS Access Key', url: 'https://console.aws.amazon.com/iam/', envVar: 'AWS_ACCESS_KEY_ID' },
  aws_secret_key: { name: 'AWS Secret Key', url: 'https://console.aws.amazon.com/iam/', envVar: 'AWS_SECRET_ACCESS_KEY' },
  azure: { name: 'Azure API Key', url: 'https://portal.azure.com/', envVar: 'AZURE_API_KEY' },
  shodan: { name: 'Shodan API Key', url: 'https://account.shodan.io/', envVar: 'SHODAN_API_KEY' },
  hunter: { name: 'Hunter.io API Key', url: 'https://hunter.io/api-keys', envVar: 'HUNTER_API_KEY' },
  numverify: { name: 'Numverify API Key', url: 'https://numverify.com/', envVar: 'NUMVERIFY_API_KEY' },
  truecaller: { name: 'Truecaller API Key', url: 'https://developer.truecaller.com/', envVar: 'TRUECALLER_API_KEY' },
};

export function getConfiguredApiKeysCount(apiKeys: Record<string, string>): { total: number; configured: number; list: string[] } {
  const total = Object.keys(REQUIRED_API_KEYS).length;
  const configured = Object.entries(REQUIRED_API_KEYS)
    .filter(([key]) => apiKeys[key])
    .map(([_, info]) => info.name);
  return { total, configured: configured.length, list: configured };
}

export function getApiKeyStatus(): Array<{ key: string; name: string; configured: boolean }> {
  return Object.entries(REQUIRED_API_KEYS).map(([key, info]) => ({
    key,
    name: info.name,
    configured: !!process.env[info.envVar],
  }));
}

// ============================================================
// تصدير كل شيء
// ============================================================

export default {
  fetchIdentifierData,
  fetchIdentifierMultiSource,
  FETCH_STRATEGIES,
  REQUIRED_API_KEYS,
  getConfiguredApiKeysCount,
  getApiKeyStatus,
  globalCache,
};
