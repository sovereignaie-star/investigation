import type { IdentifierDefinition, DetectionResult } from '../types';

export const IDENTIFIER_LIST: IdentifierDefinition[] = [
  // --- Session & Auth ---
  { id: 'otp', name: 'One-Time Password (OTP)', nameAr: 'كلمة مرور لمرة واحدة', category: 'session', pattern: /^[0-9]{4,8}$/, icon: '🔐', priority: 10, resultNodeType: 'text', description: 'رمز يستخدم لمرة واحدة' },
  { id: 'totp', name: 'TOTP Code', nameAr: 'كلمة مرور زمنية', category: 'session', pattern: /^[0-9]{6}$/, icon: '⏱️', priority: 10, resultNodeType: 'text' },
  { id: 'jwt', name: 'JSON Web Token (JWT)', nameAr: 'رمز ويب JSON', category: 'session', pattern: /^eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/, icon: '🎫', priority: 3, resultNodeType: 'text', description: 'رمز مصادقة JSON' },
  { id: 'session-id', name: 'Session ID', nameAr: 'معرف الجلسة', category: 'session', pattern: /^sess_[a-zA-Z0-9]{20,40}$/, icon: '🔑', priority: 8, resultNodeType: 'text' },
  { id: 'access-token', name: 'Access Token', nameAr: 'رمز الوصول', category: 'session', pattern: /^[a-zA-Z0-9_-]{30,100}$/, icon: '🎟️', priority: 8, resultNodeType: 'text' },
  { id: 'api-key', name: 'API Key', nameAr: 'مفتاح API', category: 'session', pattern: /^[a-zA-Z0-9_-]{20,60}$/, icon: '🔧', priority: 5, resultNodeType: 'text' },
  { id: 'csrf-token', name: 'CSRF Token', nameAr: 'رمز CSRF', category: 'session', pattern: /^[a-zA-Z0-9+/=]{20,100}$/, icon: '🛡️', priority: 8, resultNodeType: 'text' },
  { id: 'bearer-token', name: 'Bearer Token', nameAr: 'رمز الحامل', category: 'session', pattern: /^[a-zA-Z0-9._-]{30,200}$/, icon: '🎫', priority: 7, resultNodeType: 'text' },
  { id: 'device-fingerprint', name: 'Device Fingerprint', nameAr: 'بصمة الجهاز', category: 'session', pattern: /^[a-f0-9]{32,64}$/, icon: '🖐️', priority: 7, resultNodeType: 'text' },

  // --- Email & Web ---
  { id: 'email', name: 'Email Address', nameAr: 'البريد الإلكتروني', category: 'email', pattern: /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, icon: '✉️', priority: 1, resultNodeType: 'text', description: 'عنوان البريد الإلكتروني' },
  { id: 'url', name: 'URL', nameAr: 'رابط إنترنت', category: 'web', pattern: /^https?:\/\/[^\s/$.?#].[^\s]*$/, icon: '🔗', priority: 1, resultNodeType: 'link', description: 'رابط ويب' },
  { id: 'uri', name: 'URI', nameAr: 'معرف الموارد', category: 'web', pattern: /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s]*$/, icon: '🔗', priority: 5, resultNodeType: 'link' },
  { id: 'doi', name: 'DOI', nameAr: 'معرف الوثيقة الرقمي', category: 'web', pattern: /^10\.\d{4,9}\/[-._;()/:a-zA-Z0-9]+$/, icon: '📄', priority: 7, resultNodeType: 'link' },
  { id: 'user-agent', name: 'User-Agent', nameAr: 'وكيل المستخدم', category: 'web', pattern: /^Mozilla\/5\.0\s\(.+\)\s.+$/, icon: '🖥️', priority: 9, resultNodeType: 'text' },

  // --- Network ---
  { id: 'ipv4', name: 'IPv4 Address', nameAr: 'عنوان IPv4', category: 'network', pattern: /^(\d{1,3}\.){3}\d{1,3}$/, icon: '🌐', priority: 2, resultNodeType: 'location', description: 'عنوان IP الإصدار الرابع' },
  { id: 'ipv6', name: 'IPv6 Address', nameAr: 'عنوان IPv6', category: 'network', pattern: /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/, icon: '🌐', priority: 3, resultNodeType: 'location' },
  { id: 'domain', name: 'Domain Name', nameAr: 'اسم النطاق', category: 'network', pattern: /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z]{2,})+$/, icon: '🏢', priority: 2, resultNodeType: 'link', description: 'اسم نطاق إنترنت' },
  { id: 'asn', name: 'Autonomous System Number', nameAr: 'رقم النظام المستقل', category: 'network', pattern: /^AS[0-9]{1,10}$/, icon: '🌍', priority: 8, resultNodeType: 'text' },
  { id: 'cidr', name: 'CIDR Block', nameAr: 'نطاق CIDR', category: 'network', pattern: /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/, icon: '🔢', priority: 6, resultNodeType: 'text' },

  // --- Mobile ---
  { id: 'imei', name: 'IMEI', nameAr: 'الرقم التسلسلي الدولي للجهاز', category: 'mobile', pattern: /^[0-9]{15}$/, icon: '📱', priority: 1, resultNodeType: 'text', description: 'معرف الجهاز المحمول' },
  { id: 'imsi', name: 'IMSI', nameAr: 'هوية المشترك الدولية', category: 'mobile', pattern: /^[0-9]{14,15}$/, icon: '📶', priority: 2, resultNodeType: 'text' },
  { id: 'iccid', name: 'ICCID', nameAr: 'معرف بطاقة SIM', category: 'mobile', pattern: /^89[0-9]{16,18}$/, icon: '💳', priority: 3, resultNodeType: 'text' },
  { id: 'phone-number', name: 'Phone Number', nameAr: 'رقم الهاتف', category: 'mobile', pattern: /^\+?[1-9]\d{6,14}$/, icon: '📞', priority: 1, resultNodeType: 'text', description: 'رقم هاتف دولي' },

  // --- Hardware ---
  { id: 'mac-address', name: 'MAC Address', nameAr: 'عنوان MAC', category: 'hardware', pattern: /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/, icon: '🔌', priority: 1, resultNodeType: 'text', description: 'عنوان MAC للجهاز' },
  { id: 'serial-number', name: 'Serial Number', nameAr: 'الرقم التسلسلي', category: 'hardware', pattern: /^[A-Z0-9]{8,20}$/, icon: '🏷️', priority: 5, resultNodeType: 'text' },

  // --- Database & IDs ---
  { id: 'uuid-v4', name: 'UUID v4', nameAr: 'المعرف الفريد العالمي', category: 'database', pattern: /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/, icon: '🆔', priority: 3, resultNodeType: 'text' },
  { id: 'uuid-v1', name: 'UUID v1', nameAr: 'معرف UUID الإصدار 1', category: 'database', pattern: /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-1[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/, icon: '🆔', priority: 4, resultNodeType: 'text' },
  { id: 'mongodb-objectid', name: 'MongoDB ObjectID', nameAr: 'معرف MongoDB', category: 'database', pattern: /^[a-f0-9]{24}$/, icon: '🍃', priority: 5, resultNodeType: 'text' },
  { id: 'ulid', name: 'ULID', nameAr: 'المعرف الفريد القابل للفرز', category: 'database', pattern: /^[0-9A-HJKMNP-TV-Z]{26}$/, icon: '🔤', priority: 6, resultNodeType: 'text' },
  { id: 'snowflake-id', name: 'Snowflake ID', nameAr: 'معرف Snowflake', category: 'database', pattern: /^[0-9]{17,19}$/, icon: '❄️', priority: 6, resultNodeType: 'text' },

  // --- Crypto & Blockchain ---
  { id: 'bitcoin-address', name: 'Bitcoin Address', nameAr: 'عنوان بيتكوين', category: 'crypto', pattern: /^(1|3|bc1)[a-zA-Z0-9]{25,62}$/, icon: '₿', priority: 2, resultNodeType: 'text', description: 'محفظة بيتكوين' },
  { id: 'ethereum-address', name: 'Ethereum Address', nameAr: 'عنوان إيثيريوم', category: 'crypto', pattern: /^0x[a-fA-F0-9]{40}$/, icon: '⟠', priority: 2, resultNodeType: 'text', description: 'محفظة إيثيريوم' },
  { id: 'tx-hash', name: 'Transaction Hash', nameAr: 'تجزئة معاملة بلوكتشين', category: 'blockchain', pattern: /^0x[a-fA-F0-9]{64}$/, icon: '⛓️', priority: 4, resultNodeType: 'text' },
  { id: 'sha256-hash', name: 'SHA-256 Hash', nameAr: 'تجزئة SHA-256', category: 'other', pattern: /^[a-f0-9]{64}$/, icon: '#️⃣', priority: 5, resultNodeType: 'text' },
  { id: 'sha1-hash', name: 'SHA-1 Hash', nameAr: 'تجزئة SHA-1', category: 'other', pattern: /^[a-f0-9]{40}$/, icon: '#️⃣', priority: 6, resultNodeType: 'text' },
  { id: 'md5-hash', name: 'MD5 Hash', nameAr: 'تجزئة MD5', category: 'other', pattern: /^[a-f0-9]{32}$/, icon: '#️⃣', priority: 7, resultNodeType: 'text' },

  // --- Social Media ---
  { id: 'twitter-id', name: 'Twitter/X Username', nameAr: 'معرف تويتر/إكس', category: 'social', pattern: /^@?[a-zA-Z0-9_]{1,15}$/, icon: '𝕏', priority: 3, resultNodeType: 'text' },
  { id: 'telegram-id', name: 'Telegram Username', nameAr: 'معرف تيليجرام', category: 'social', pattern: /^@?[a-zA-Z0-9_]{5,32}$/, icon: '✈️', priority: 3, resultNodeType: 'text' },
  { id: 'discord-snowflake', name: 'Discord Snowflake ID', nameAr: 'معرف ديسكورد', category: 'social', pattern: /^[0-9]{17,19}$/, icon: '🎮', priority: 6, resultNodeType: 'text' },
  { id: 'youtube-video', name: 'YouTube Video ID', nameAr: 'معرف فيديو يوتيوب', category: 'social', pattern: /^[a-zA-Z0-9_-]{11}$/, icon: '▶️', priority: 5, resultNodeType: 'video' },
  { id: 'instagram-id', name: 'Instagram Username', nameAr: 'معرف انستجرام', category: 'social', pattern: /^[a-zA-Z0-9._]{1,30}$/, icon: '📸', priority: 5, resultNodeType: 'text' },
  { id: 'github-user-id', name: 'GitHub Username', nameAr: 'معرف GitHub', category: 'social', pattern: /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/, icon: '🐙', priority: 4, resultNodeType: 'link' },
  { id: 'linkedin-id', name: 'LinkedIn Profile', nameAr: 'معرف LinkedIn', category: 'social', pattern: /^[a-zA-Z0-9-]{3,100}$/, icon: '💼', priority: 5, resultNodeType: 'link' },

  // --- Finance ---
  { id: 'iban', name: 'IBAN', nameAr: 'رقم الحساب الدولي', category: 'finance', pattern: /^[A-Z]{2}[0-9]{2}[a-zA-Z0-9]{4}[0-9]{7}([a-zA-Z0-9]{0,16})$/, icon: '🏦', priority: 3, resultNodeType: 'text' },
  { id: 'swift-bic', name: 'SWIFT/BIC Code', nameAr: 'رمز SWIFT/BIC', category: 'finance', pattern: /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/, icon: '🏛️', priority: 4, resultNodeType: 'text' },
  { id: 'credit-card', name: 'Credit Card Number', nameAr: 'رقم بطاقة الائتمان', category: 'finance', pattern: /^[0-9]{13,19}$/, icon: '💳', priority: 4, resultNodeType: 'text' },
  { id: 'isin', name: 'ISIN', nameAr: 'معرف الأوراق المالية الدولي', category: 'finance', pattern: /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/, icon: '📈', priority: 6, resultNodeType: 'text' },

  // --- Vehicle ---
  { id: 'vin', name: 'Vehicle Identification Number (VIN)', nameAr: 'رقم تعريف المركبة', category: 'vehicle', pattern: /^[A-HJ-NPR-Z0-9]{17}$/, icon: '🚗', priority: 3, resultNodeType: 'text', description: 'رقم تعريف المركبة' },
  { id: 'license-plate', name: 'License Plate', nameAr: 'لوحة ترخيص', category: 'vehicle', pattern: /^[A-Z0-9]{2,8}$/, icon: '🚙', priority: 7, resultNodeType: 'text' },

  // --- Document & Government ---
  { id: 'ssn', name: 'Social Security Number (SSN)', nameAr: 'رقم الضمان الاجتماعي', category: 'government', pattern: /^[0-9]{3}-[0-9]{2}-[0-9]{4}$/, icon: '🪪', priority: 3, resultNodeType: 'text' },
  { id: 'passport-number', name: 'Passport Number', nameAr: 'رقم جواز السفر', category: 'document', pattern: /^[A-Z0-9]{6,12}$/, icon: '🛂', priority: 5, resultNodeType: 'text' },
  { id: 'national-id', name: 'National ID', nameAr: 'رقم الهوية الوطنية', category: 'government', pattern: /^[0-9]{10,15}$/, icon: '🪪', priority: 4, resultNodeType: 'text' },

  // --- Cloud ---
  { id: 'aws-account-id', name: 'AWS Account ID', nameAr: 'معرف حساب AWS', category: 'cloud', pattern: /^[0-9]{12}$/, icon: '☁️', priority: 5, resultNodeType: 'text' },
  { id: 'aws-arn', name: 'AWS ARN', nameAr: 'اسم مورد Amazon', category: 'cloud', pattern: /^arn:aws:[a-zA-Z0-9-]+:[a-zA-Z0-9-]*:[0-9]*:.*$/, icon: '☁️', priority: 4, resultNodeType: 'text' },
  { id: 'azure-subscription', name: 'Azure Subscription ID', nameAr: 'معرف اشتراك Azure', category: 'cloud', pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, icon: '🔷', priority: 5, resultNodeType: 'text' },
  { id: 'gcp-project', name: 'GCP Project ID', nameAr: 'معرف مشروع Google Cloud', category: 'cloud', pattern: /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/, icon: '🌩️', priority: 5, resultNodeType: 'text' },

  // --- IoT ---
  { id: 'bluetooth-mac', name: 'Bluetooth MAC', nameAr: 'عنوان Bluetooth MAC', category: 'iot', pattern: /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/, icon: '🔵', priority: 6, resultNodeType: 'text' },
  { id: 'ipfs-cid', name: 'IPFS CID', nameAr: 'معرف محتوى IPFS', category: 'blockchain', pattern: /^(Qm[1-9A-Za-z]{44}|b[a-zA-Z2-7]{58})$/, icon: '🗄️', priority: 6, resultNodeType: 'link' },

  // --- Shipping ---
  { id: 'tracking-number', name: 'Package Tracking Number', nameAr: 'رقم تتبع الشحنة', category: 'shipping', pattern: /^[A-Z0-9]{10,30}$/, icon: '📦', priority: 6, resultNodeType: 'text' },
  { id: 'ups-tracking', name: 'UPS Tracking Number', nameAr: 'رقم تتبع UPS', category: 'shipping', pattern: /^1Z[A-Z0-9]{16}$/, icon: '🚚', priority: 5, resultNodeType: 'text' },

  // --- Biometric ---
  { id: 'fingerprint-template', name: 'Fingerprint Template ID', nameAr: 'معرف قالب بصمة الإصبع', category: 'biometric', pattern: /^[a-f0-9]{64,128}$/, icon: '👆', priority: 7, resultNodeType: 'text' },

  // --- Gaming ---
  { id: 'steam-id', name: 'Steam ID', nameAr: 'معرف Steam', category: 'gaming', pattern: /^7656119[0-9]{10}$/, icon: '🎮', priority: 5, resultNodeType: 'text' },
  { id: 'xbox-gamertag', name: 'Xbox Gamertag', nameAr: 'اسم لاعب Xbox', category: 'gaming', pattern: /^[a-zA-Z][a-zA-Z0-9 ]{0,14}$/, icon: '🎯', priority: 7, resultNodeType: 'text' },
  { id: 'psn-id', name: 'PlayStation Network ID', nameAr: 'معرف PlayStation', category: 'gaming', pattern: /^[a-zA-Z][a-zA-Z0-9_-]{2,15}$/, icon: '🎮', priority: 7, resultNodeType: 'text' },

  // --- Multimedia ---
  { id: 'youtube-channel', name: 'YouTube Channel ID', nameAr: 'معرف قناة يوتيوب', category: 'multimedia', pattern: /^UC[a-zA-Z0-9_-]{22}$/, icon: '📺', priority: 5, resultNodeType: 'video' },
  { id: 'spotify-track', name: 'Spotify Track ID', nameAr: 'معرف مقطع Spotify', category: 'multimedia', pattern: /^[a-zA-Z0-9]{22}$/, icon: '🎵', priority: 7, resultNodeType: 'audio' },

  // --- Business ---
  { id: 'duns-number', name: 'DUNS Number', nameAr: 'رقم DUNS', category: 'business', pattern: /^[0-9]{9}$/, icon: '🏢', priority: 6, resultNodeType: 'text' },
  { id: 'ein', name: 'Employer ID Number (EIN)', nameAr: 'رقم صاحب العمل', category: 'business', pattern: /^[0-9]{2}-[0-9]{7}$/, icon: '📋', priority: 5, resultNodeType: 'text' },
  { id: 'vat-number', name: 'VAT Number', nameAr: 'رقم ضريبة القيمة المضافة', category: 'business', pattern: /^[A-Z]{2}[0-9A-Z]{8,12}$/, icon: '🧾', priority: 5, resultNodeType: 'text' },

  // --- Coordinates ---
  { id: 'coordinates', name: 'GPS Coordinates', nameAr: 'إحداثيات GPS', category: 'other', pattern: /^-?[0-9]{1,2}\.[0-9]+,\s*-?[0-9]{1,3}\.[0-9]+$/, icon: '📍', priority: 3, resultNodeType: 'map', description: 'إحداثيات جغرافية' },
  { id: 'plus-code', name: 'Google Plus Code', nameAr: 'رمز Google Plus', category: 'other', pattern: /^[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,}$/, icon: '🗺️', priority: 7, resultNodeType: 'map' },

  // --- Solana/Other Crypto ---
  { id: 'solana-address', name: 'Solana Address', nameAr: 'عنوان سولانا', category: 'crypto', pattern: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, icon: '◎', priority: 4, resultNodeType: 'text' },
  { id: 'tron-address', name: 'TRON Address', nameAr: 'عنوان ترون', category: 'crypto', pattern: /^T[a-zA-Z0-9]{33}$/, icon: '⚡', priority: 5, resultNodeType: 'text' },

  // --- Certificate ---
  { id: 'ssl-fingerprint', name: 'SSL Certificate Fingerprint', nameAr: 'بصمة شهادة SSL', category: 'other', pattern: /^([A-F0-9]{2}:){19}[A-F0-9]{2}$/, icon: '🔒', priority: 5, resultNodeType: 'text' },
];

export function detectIdentifier(value: string): DetectionResult {
  const trimmed = value.trim();
  const matches: Array<{ def: IdentifierDefinition; confidence: number }> = [];

  for (const def of IDENTIFIER_LIST) {
    if (def.pattern.test(trimmed)) {
      const confidence = def.priority <= 3 ? 0.95 : def.priority <= 6 ? 0.75 : 0.55;
      matches.push({ def, confidence });
    }
  }

  if (matches.length === 0) {
    return {
      identifierId: 'unknown',
      identifierName: 'Unknown Identifier',
      identifierNameAr: 'معرف غير معروف',
      icon: '❓',
      value: trimmed,
      confidence: 'low',
      multipleMatches: false,
      alternativeMatches: [],
      suggestedNodeType: 'text',
    };
  }

  matches.sort((a, b) => b.confidence - a.confidence || a.def.priority - b.def.priority);
  const best = matches[0];
  const alts = matches.slice(1, 4);

  return {
    identifierId: best.def.id,
    identifierName: best.def.name,
    identifierNameAr: best.def.nameAr,
    icon: best.def.icon,
    value: trimmed,
    confidence: best.confidence >= 0.85 ? 'high' : best.confidence >= 0.65 ? 'medium' : 'low',
    multipleMatches: matches.length > 1,
    alternativeMatches: alts.map(m => ({ identifierId: m.def.id, identifierName: m.def.name, icon: m.def.icon })),
    suggestedNodeType: best.def.resultNodeType,
  };
}

export function searchIdentifiers(query: string): IdentifierDefinition[] {
  const q = query.toLowerCase();
  return IDENTIFIER_LIST.filter(
    d => d.name.toLowerCase().includes(q) || d.nameAr.includes(q) || d.id.includes(q) || d.category.includes(q)
  ).sort((a, b) => a.priority - b.priority);
}
