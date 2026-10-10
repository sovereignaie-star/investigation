// ============================================================
// كود المحقق الذكي - Smart Investigator Engine
// المسار: src/utils/smartInvestigator.ts
// ============================================================
// هذا الكود هو قلب النظام. يستقبل أي معرف، يجلب بياناته،
// يستخرج المعرفات المرتبطة، يجلب بياناتها، وهكذا في
// حلقة ذكية حتى يستنفذ كل المسارات الممكنة.
// ============================================================

import { detectIdentifier, IDENTIFIER_LIST } from './identifierList';
import { fetchIdentifierData, FETCH_STRATEGIES } from './resultFetcher';
import type { FetchResult } from './resultFetcher';

// ============================================================
// الأنواع الأساسية
// ============================================================

export interface InvestigationNode {
  id: string;
  identifierType: string;
  identifierName: string;
  identifierValue: string;
  data: FetchResult;
  parentId: string | null;
  childrenIds: string[];
  depth: number;
  timestamp: number;
  status: 'pending' | 'fetched' | 'error' | 'skipped';
}

export interface InvestigationLink {
  sourceId: string;
  targetId: string;
  relationType: string;
  confidence: number;
  metadata: any;
}

export interface InvestigationGraph {
  nodes: Map<string, InvestigationNode>;
  links: InvestigationLink[];
  rootNodeId: string;
  startTime: number;
  lastUpdateTime: number;
  totalFetched: number;
  totalErrors: number;
  maxDepth: number;
}

export interface InvestigationConfig {
  maxDepth: number;
  maxNodes: number;
  maxConcurrentFetches: number;
  timeoutPerFetch: number;
  cacheResults: boolean;
  includeLowConfidence: boolean;
  confidenceThreshold: number;
  allowedCategories: string[];
  excludedCategories: string[];
  apiKeys: Record<string, string>;
  onProgress?: (graph: InvestigationGraph) => void;
  onNodeFetched?: (node: InvestigationNode) => void;
  onComplete?: (graph: InvestigationGraph) => void;
  onError?: (nodeId: string, error: Error) => void;
}

// ============================================================
// مستخرج المعرفات من البيانات (Identifier Extractor)
// ============================================================

interface ExtractedIdentifier {
  value: string;
  identifierId: string;
  identifierName: string;
  confidence: number;
  sourcePath: string;  // مسار استخراجها من البيانات
  context: string;     // السياق الذي وجدت فيه
}

class IdentifierExtractor {
  // أنماط Regex إضافية لاستخراج المعرفات من النصوص
  private extractionPatterns: Array<{
    pattern: RegExp;
    identifierId: string;
    confidence: number;
  }> = [
    // إيميلات
    { pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, identifierId: 'email', confidence: 0.95 },
    // روابط
    { pattern: /https?:\/\/[^\s<>"']+/g, identifierId: 'url', confidence: 0.85 },
    // عناوين IP
    { pattern: /\b(\d{1,3}\.){3}\d{1,3}\b/g, identifierId: 'ipv4', confidence: 0.8 },
    // MAC Addresses
    { pattern: /([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})/g, identifierId: 'mac-address', confidence: 0.9 },
    // Ethereum Addresses
    { pattern: /0x[a-fA-F0-9]{40}/g, identifierId: 'ethereum-address', confidence: 0.9 },
    // Bitcoin Addresses
    { pattern: /\b[13][a-km-zA-HJ-NP-Z1-9]{25,34}\b/g, identifierId: 'bitcoin-address', confidence: 0.85 },
    // UUIDs
    { pattern: /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, identifierId: 'uuid-v4', confidence: 0.85 },
    // JWT Tokens
    { pattern: /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, identifierId: 'jwt', confidence: 0.9 },
    // أرقام هواتف
    { pattern: /\+\d{1,3}[-\s]?\d{3,14}/g, identifierId: 'phone-number', confidence: 0.7 },
    // IMEI
    { pattern: /\b[0-9]{15}\b/g, identifierId: 'imei', confidence: 0.6 },
    // معرفات تيليجرام
    { pattern: /@[a-zA-Z0-9_]{5,32}/g, identifierId: 'telegram-user-id', confidence: 0.6 },
    // معرفات تويتر
    { pattern: /@[a-zA-Z0-9_]{1,15}/g, identifierId: 'twitter-id', confidence: 0.6 },
    // ASN
    { pattern: /AS[0-9]{1,10}/g, identifierId: 'asn', confidence: 0.9 },
    // VIN
    { pattern: /\b[A-HJ-NPR-Z0-9]{17}\b/g, identifierId: 'vin', confidence: 0.8 },
    // عناوين سولانا
    { pattern: /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g, identifierId: 'solana-public-key', confidence: 0.7 },
    // Hash SHA256
    { pattern: /\b[a-f0-9]{64}\b/gi, identifierId: 'sha256-hash', confidence: 0.5 },
    // Hash SHA1
    { pattern: /\b[a-f0-9]{40}\b/gi, identifierId: 'sha1-hash', confidence: 0.5 },
    // MongoDB ObjectId
    { pattern: /\b[a-f0-9]{24}\b/gi, identifierId: 'mongodb-objectid', confidence: 0.6 },
    // أسماء نطاقات
    { pattern: /\b[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}\b/g, identifierId: 'domain', confidence: 0.5 },
    // IBAN
    { pattern: /\b[A-Z]{2}[0-9]{2}[a-zA-Z0-9]{4}[0-9]{7}([a-zA-Z0-9]?){0,16}\b/g, identifierId: 'iban', confidence: 0.8 },
    // SWIFT/BIC
    { pattern: /\b[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?\b/g, identifierId: 'swift-bic', confidence: 0.8 },
    // DUNS Number
    { pattern: /\b[0-9]{9}\b/g, identifierId: 'duns-number', confidence: 0.3 },
    // ISIN
    { pattern: /\b[A-Z]{2}[A-Z0-9]{9}[0-9]\b/g, identifierId: 'isin', confidence: 0.8 },
    // SSN
    { pattern: /\b[0-9]{3}-[0-9]{2}-[0-9]{4}\b/g, identifierId: 'ssn', confidence: 0.8 },
    // Passport
    { pattern: /\b[A-Z0-9]{6,12}\b/g, identifierId: 'passport-number', confidence: 0.3 },
    // Snowflake IDs
    { pattern: /\b[0-9]{17,19}\b/g, identifierId: 'snowflake-id', confidence: 0.5 },
    // ULID
    { pattern: /\b[0-9A-HJKMNP-TV-Z]{26}\b/g, identifierId: 'ulid', confidence: 0.8 },
  ];

  /**
   * استخراج جميع المعرفات من أي بيانات (نص، كائن، مصفوفة)
   */
  extractIdentifiers(data: any, context: string = 'root'): ExtractedIdentifier[] {
    const results: ExtractedIdentifier[] = [];
    const seen = new Set<string>();

    const extract = (value: any, path: string) => {
      if (value === null || value === undefined) return;

      if (typeof value === 'string') {
        this.extractFromString(value, path, seen, results);
      } else if (Array.isArray(value)) {
        value.forEach((item, index) => extract(item, `${path}[${index}]`));
      } else if (typeof value === 'object') {
        // استخراج مفاتيح الكائن أيضاً (قد تحتوي على معرفات)
        Object.entries(value).forEach(([key, val]) => {
          // تحقق مما إذا كان المفتاح نفسه معرفاً
          extract(key, `${path}.keys`);
          // تحقق من القيمة
          extract(val, `${path}.${key}`);
        });
      } else if (typeof value === 'number') {
        extract(String(value), path);
      } else if (typeof value === 'boolean') {
        // لا نستخرج من القيم المنطقية
      }
    };

    extract(data, context);
    return results;
  }

  /**
   * استخراج المعرفات من نص
   */
  private extractFromString(
    text: string,
    path: string,
    seen: Set<string>,
    results: ExtractedIdentifier[]
  ): void {
    if (!text || text.length < 2 || text.length > 10000) return;

    // 1. استخدام أنماط Regex المخصصة
    for (const extractor of this.extractionPatterns) {
      const matches = text.matchAll(extractor.pattern);
      for (const match of matches) {
        const value = match[0];
        if (seen.has(`${extractor.identifierId}:${value}`)) continue;
        if (value.length < 3 || value.length > 500) continue;

        // تحقق إضافي باستخدام كاشف المعرفات
        const detection = detectIdentifier(value);
        const finalConfidence = detection.confidence === 'high'
          ? Math.min(extractor.confidence * 1.1, 1)
          : extractor.confidence * 0.7;

        if (finalConfidence >= 0.3) {
          seen.add(`${extractor.identifierId}:${value}`);
          results.push({
            value,
            identifierId: detection.identifierId !== 'general' ? detection.identifierId : extractor.identifierId,
            identifierName: detection.identifierName || extractor.identifierId,
            confidence: finalConfidence,
            sourcePath: path,
            context: this.getSurroundingContext(text, match.index!, 100),
          });
        }
      }
    }

    // 2. استخدام كاشف المعرفات العام على أجزاء النص
    // تقسيم النص إلى كلمات/رموز والتحقق منها
    const tokens = text.split(/[\s,;:()\[\]{}"'\n\r\t<>]+/);
    for (const token of tokens) {
      if (token.length < 3 || token.length > 200) continue;
      if (seen.has(`direct:${token}`)) continue;

      const detection = detectIdentifier(token);
      if (detection.confidence === 'high' && detection.identifierId !== 'general') {
        seen.add(`direct:${token}`);
        results.push({
          value: token,
          identifierId: detection.identifierId,
          identifierName: detection.identifierName,
          confidence: 0.9,
          sourcePath: path,
          context: text.substring(Math.max(0, text.indexOf(token) - 50), text.indexOf(token) + token.length + 50),
        });
      }
    }
  }

  /**
   * الحصول على السياق المحيط بالمطابقة
   */
  private getSurroundingContext(text: string, position: number, radius: number): string {
    const start = Math.max(0, position - radius);
    const end = Math.min(text.length, position + radius);
    return text.substring(start, end);
  }
}

// ============================================================
// محلل العلاقات (Relationship Analyzer)
// ============================================================

interface Relationship {
  sourceValue: string;
  targetValue: string;
  relationType: string;
  confidence: number;
  evidence: string;
}

class RelationshipAnalyzer {
  // أنواع العلاقات المعروفة
  private relationPatterns: Array<{
    type: string;
    sourceType: string;
    targetType: string;
    confidence: number;
  }> = [
    // إيميل ↔ نطاق
    { type: 'BELONGS_TO_DOMAIN', sourceType: 'email', targetType: 'domain', confidence: 1.0 },
    // نطاق ↔ IP
    { type: 'RESOLVES_TO', sourceType: 'domain', targetType: 'ipv4', confidence: 0.9 },
    { type: 'RESOLVES_TO', sourceType: 'domain', targetType: 'ipv6', confidence: 0.9 },
    // IP ↔ ASN
    { type: 'BELONGS_TO_ASN', sourceType: 'ipv4', targetType: 'asn', confidence: 0.85 },
    { type: 'BELONGS_TO_ASN', sourceType: 'ipv6', targetType: 'asn', confidence: 0.85 },
    // جهاز ↔ MAC
    { type: 'HAS_MAC', sourceType: 'imei', targetType: 'mac-address', confidence: 0.6 },
    // شخص ↔ إيميل
    { type: 'OWNS', sourceType: 'full-name', targetType: 'email', confidence: 0.5 },
    // شخص ↔ هاتف
    { type: 'OWNS', sourceType: 'full-name', targetType: 'phone-number', confidence: 0.5 },
    // إيميل ↔ هاتف
    { type: 'LINKED_TO', sourceType: 'email', targetType: 'phone-number', confidence: 0.4 },
    // محفظة ↔ عنوان
    { type: 'OWNS', sourceType: 'full-name', targetType: 'ethereum-address', confidence: 0.4 },
    // سوشيال ميديا
    { type: 'SOCIAL_PROFILE', sourceType: 'email', targetType: 'twitter-id', confidence: 0.3 },
    { type: 'SOCIAL_PROFILE', sourceType: 'email', targetType: 'github-user-id', confidence: 0.4 },
    // URL ↔ Domain
    { type: 'CONTAINS_DOMAIN', sourceType: 'url', targetType: 'domain', confidence: 1.0 },
    // IPFS ↔ Content
    { type: 'POINTS_TO', sourceType: 'ipfs-cid', targetType: 'url', confidence: 0.7 },
    // TX Hash ↔ عنوان
    { type: 'INVOLVES_ADDRESS', sourceType: 'tx-hash', targetType: 'bitcoin-address', confidence: 0.95 },
    { type: 'INVOLVES_ADDRESS', sourceType: 'tx-hash', targetType: 'ethereum-address', confidence: 0.95 },
    // Contract ↔ Token
    { type: 'DEPLOYS_TOKEN', sourceType: 'contract-address', targetType: 'token-contract-address', confidence: 0.8 },
    // IMEI ↔ ICCID
    { type: 'PAIRED_WITH', sourceType: 'imei', targetType: 'iccid', confidence: 0.7 },
    // IMSI ↔ ICCID
    { type: 'STORED_ON', sourceType: 'imsi', targetType: 'iccid', confidence: 0.9 },
    // شخص ↔ SSN
    { type: 'IDENTIFIES', sourceType: 'full-name', targetType: 'ssn', confidence: 0.6 },
    // شخص ↔ Passport
    { type: 'IDENTIFIES', sourceType: 'full-name', targetType: 'passport-number', confidence: 0.6 },
    // Windows SID ↔ Hostname
    { type: 'BELONGS_TO_MACHINE', sourceType: 'windows-sid', targetType: 'hostname', confidence: 0.7 },
    // عملية ↔ PID
    { type: 'HAS_PID', sourceType: 'hostname', targetType: 'process-id', confidence: 0.5 },
    // Docker Container ↔ Hostname
    { type: 'RUNS_ON', sourceType: 'docker-container-id', targetType: 'hostname', confidence: 0.8 },
    // AWS ARN ↔ Account
    { type: 'IN_ACCOUNT', sourceType: 'aws-arn', targetType: 'aws-account-id', confidence: 1.0 },
    // GCP Resource ↔ Project
    { type: 'IN_PROJECT', sourceType: 'gcp-resource-name', targetType: 'gcp-project-id', confidence: 0.9 },
    // Azure Resource ↔ Subscription
    { type: 'IN_SUBSCRIPTION', sourceType: 'azure-resource-id', targetType: 'azure-subscription-id', confidence: 0.9 },
    // ISBN ↔ مؤلف
    { type: 'AUTHORED_BY', sourceType: 'isbn-13', targetType: 'full-name', confidence: 0.4 },
    // VIN ↔ مالك
    { type: 'OWNED_BY', sourceType: 'vin', targetType: 'full-name', confidence: 0.3 },
    // رقم تتبع ↔ شحنة
    { type: 'TRACKS', sourceType: 'tracking-number', targetType: 'url', confidence: 0.7 },
    // PGP ↔ إيميل
    { type: 'BELONGS_TO', sourceType: 'pgp-fingerprint', targetType: 'email', confidence: 0.8 },
    // SSH ↔ Hostname
    { type: 'AUTHENTICATES_TO', sourceType: 'ssh-key-sha256', targetType: 'hostname', confidence: 0.6 },
  ];

  /**
   * تحليل العلاقات بين معرفين
   */
  analyzeRelationship(
    sourceType: string,
    sourceValue: string,
    targetType: string,
    targetValue: string,
    evidence: string
  ): Relationship | null {
    // البحث عن نمط علاقة مباشر
    const directPattern = this.relationPatterns.find(
      p => p.sourceType === sourceType && p.targetType === targetType
    );
    if (directPattern) {
      return {
        sourceValue,
        targetValue,
        relationType: directPattern.type,
        confidence: directPattern.confidence,
        evidence,
      };
    }

    // البحث عن نمط عكسي
    const reversePattern = this.relationPatterns.find(
      p => p.sourceType === targetType && p.targetType === sourceType
    );
    if (reversePattern) {
      return {
        sourceValue,
        targetValue,
        relationType: `REVERSE_${reversePattern.type}`,
        confidence: reversePattern.confidence * 0.8,
        evidence,
      };
    }

    // علاقات عامة بناءً على الفئات
    const sourceCategory = this.getCategoryForType(sourceType);
    const targetCategory = this.getCategoryForType(targetType);

    if (sourceCategory === 'email-messaging' && targetCategory === 'social') {
      return { sourceValue, targetValue, relationType: 'POSSIBLE_SOCIAL_LINK', confidence: 0.2, evidence };
    }
    if (sourceCategory === 'biometric' && targetCategory === 'biometric') {
      return { sourceValue, targetValue, relationType: 'SAME_PERSON_INDICATOR', confidence: 0.3, evidence };
    }
    if (sourceCategory === 'network' && targetCategory === 'network') {
      return { sourceValue, targetValue, relationType: 'NETWORK_RELATED', confidence: 0.5, evidence };
    }
    if (sourceCategory === 'crypto' && targetCategory === 'crypto') {
      return { sourceValue, targetValue, relationType: 'CRYPTO_RELATED', confidence: 0.4, evidence };
    }

    return null;
  }

  private getCategoryForType(identifierType: string): string {
    const identifier = IDENTIFIER_LIST.find(i => i.id === identifierType);
    return identifier?.category || 'unknown';
  }
}

// ============================================================
// المحقق الذكي الرئيسي (Smart Investigator)
// ============================================================

export class SmartInvestigator {
  private config: InvestigationConfig;
  private graph: InvestigationGraph;
  private extractor: IdentifierExtractor;
  private analyzer: RelationshipAnalyzer;
  private running: boolean;
  private queue: Array<{ nodeId: string; priority: number }>;
  private processedValues: Set<string>;
  private activeFetches: number;

  constructor(config: InvestigationConfig) {
    this.config = {
      maxDepth: 5,
      maxNodes: 500,
      maxConcurrentFetches: 8,
      timeoutPerFetch: 15000,
      cacheResults: true,
      includeLowConfidence: false,
      confidenceThreshold: 0.4,
      allowedCategories: [],
      excludedCategories: [],
      ...config,
    };

    this.graph = {
      nodes: new Map(),
      links: [],
      rootNodeId: '',
      startTime: 0,
      lastUpdateTime: 0,
      totalFetched: 0,
      totalErrors: 0,
      maxDepth: 0,
    };

    this.extractor = new IdentifierExtractor();
    this.analyzer = new RelationshipAnalyzer();
    this.running = false;
    this.queue = [];
    this.processedValues = new Set();
    this.activeFetches = 0;
  }

  /**
   * بدء التحقيق من معرف أولي
   */
  async investigate(identifierValue: string): Promise<InvestigationGraph> {
    // إعادة تعيين
    this.graph = {
      nodes: new Map(),
      links: [],
      rootNodeId: '',
      startTime: Date.now(),
      lastUpdateTime: Date.now(),
      totalFetched: 0,
      totalErrors: 0,
      maxDepth: 0,
    };
    this.queue = [];
    this.processedValues = new Set();
    this.activeFetches = 0;
    this.running = true;

    // اكتشاف نوع المعرف
    const detection = detectIdentifier(identifierValue);
    const identifierId = detection.identifierId !== 'general' ? detection.identifierId : 'full-name';
    const identifierName = detection.identifierName || 'General';

    // إنشاء العقدة الجذرية
    const rootNode: InvestigationNode = {
      id: this.generateNodeId(),
      identifierType: identifierId,
      identifierName,
      identifierValue,
      data: {
        success: false,
        data: { raw: identifierValue, detectedType: identifierId },
        source: 'initial-input',
        cached: false,
        timestamp: Date.now(),
      },
      parentId: null,
      childrenIds: [],
      depth: 0,
      timestamp: Date.now(),
      status: 'pending',
    };

    this.graph.rootNodeId = rootNode.id;
    this.graph.nodes.set(rootNode.id, rootNode);
    this.processedValues.add(this.getUniqueKey(identifierId, identifierValue));

    // جلب بيانات العقدة الجذرية
    await this.fetchNodeData(rootNode);

    // بدء حلقة المعالجة
    await this.processQueue();

    this.running = false;
    this.config.onComplete?.(this.graph);
    return this.graph;
  }

  /**
   * مواصلة التحقيق من رسم بياني موجود
   */
  async continueInvestigation(graph: InvestigationGraph): Promise<InvestigationGraph> {
    this.graph = graph;
    this.running = true;

    // إعادة بناء قائمة الانتظار من العقد غير المعالجة
    for (const node of this.graph.nodes.values()) {
      if (node.status === 'pending') {
        this.queue.push({ nodeId: node.id, priority: node.depth });
      }
      this.processedValues.add(this.getUniqueKey(node.identifierType, node.identifierValue));
    }

    await this.processQueue();

    this.running = false;
    this.config.onComplete?.(this.graph);
    return this.graph;
  }

  /**
   * إيقاف التحقيق
   */
  stop(): void {
    this.running = false;
    this.queue = [];
  }

  /**
   * الحصول على الرسم البياني الحالي
   */
  getGraph(): InvestigationGraph {
    return this.graph;
  }

  /**
   * حلقة المعالجة الرئيسية
   */
  private async processQueue(): Promise<void> {
    while (this.running && (this.queue.length > 0 || this.activeFetches > 0)) {
      // معالجة العقد في قائمة الانتظار
      while (this.running && this.queue.length > 0 && this.activeFetches < this.config.maxConcurrentFetches) {
        const next = this.queue.shift()!;
        const node = this.graph.nodes.get(next.nodeId);
        if (!node || node.status === 'fetched' || node.status === 'error') continue;
        if (node.depth >= this.config.maxDepth) {
          node.status = 'skipped';
          continue;
        }
        if (this.graph.nodes.size >= this.config.maxNodes) {
          node.status = 'skipped';
          continue;
        }

        this.activeFetches++;
        this.fetchAndExpandNode(node).finally(() => {
          this.activeFetches--;
        });
      }

      // انتظار قليل قبل التحقق مرة أخرى
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /**
   * جلب بيانات عقدة وتوسيعها
   */
  private async fetchAndExpandNode(node: InvestigationNode): Promise<void> {
    try {
      // جلب البيانات إذا لم تكن مجلوبة
      if (node.status === 'pending') {
        await this.fetchNodeData(node);
      }

      // إذا نجح الجلب، استخرج المعرفات المرتبطة
      if (node.status === 'fetched' && node.data?.success) {
        await this.expandNode(node);
      }

      this.graph.lastUpdateTime = Date.now();
      this.config.onProgress?.(this.graph);
    } catch (error: any) {
      node.status = 'error';
      this.graph.totalErrors++;
      this.config.onError?.(node.id, error);
    }
  }

  /**
   * جلب بيانات عقدة واحدة
   */
  private async fetchNodeData(node: InvestigationNode): Promise<void> {
    try {
      const result = await fetchIdentifierData(
        node.identifierType,
        node.identifierValue,
        {
          apiKeys: this.config.apiKeys,
          timeout: this.config.timeoutPerFetch,
        }
      );

      node.data = result;
      node.status = result.success ? 'fetched' : 'error';
      if (result.success) {
        this.graph.totalFetched++;
      } else {
        this.graph.totalErrors++;
      }
      this.config.onNodeFetched?.(node);
    } catch (error: any) {
      node.status = 'error';
      node.data = {
        success: false,
        data: { error: error.message },
        source: 'fetch-error',
        cached: false,
        timestamp: Date.now(),
        errors: [error.message],
      };
      this.graph.totalErrors++;
    }
  }

  /**
   * توسيع عقدة: استخراج المعرفات المرتبطة وإنشاء عقد جديدة
   */
  private async expandNode(node: InvestigationNode): Promise<void> {
    if (node.depth >= this.config.maxDepth) return;
    if (!node.data?.data) return;

    // استخراج المعرفات من بيانات العقدة
    const extractedIdentifiers = this.extractor.extractIdentifiers(
      node.data.data,
      `node.${node.id}.data`
    );

    // تصفية المعرفات المستخرجة
    const validIdentifiers = extractedIdentifiers.filter(extracted => {
      // تجاهل القيم المعالجة مسبقاً
      const key = this.getUniqueKey(extracted.identifierId, extracted.value);
      if (this.processedValues.has(key)) return false;

      // تجاهل نفس قيمة العقدة الحالية
      if (extracted.value === node.identifierValue && extracted.identifierId === node.identifierType) return false;

      // تطبيق حد الثقة
      if (!this.config.includeLowConfidence && extracted.confidence < this.config.confidenceThreshold) return false;

      // تطبيق تصفية الفئات
      if (this.config.allowedCategories.length > 0) {
        const identifier = IDENTIFIER_LIST.find(i => i.id === extracted.identifierId);
        if (!identifier || !this.config.allowedCategories.includes(identifier.category)) return false;
      }
      if (this.config.excludedCategories.length > 0) {
        const identifier = IDENTIFIER_LIST.find(i => i.id === extracted.identifierId);
        if (identifier && this.config.excludedCategories.includes(identifier.category)) return false;
      }

      return true;
    });

    // ترتيب حسب الثقة
    validIdentifiers.sort((a, b) => b.confidence - a.confidence);

    // إنشاء عقد جديدة
    for (const extracted of validIdentifiers) {
      if (this.graph.nodes.size >= this.config.maxNodes) break;

      const childNode: InvestigationNode = {
        id: this.generateNodeId(),
        identifierType: extracted.identifierId,
        identifierName: extracted.identifierName,
        identifierValue: extracted.value,
        data: {
          success: false,
          data: {
            extractedFrom: node.identifierValue,
            sourcePath: extracted.sourcePath,
            context: extracted.context,
            confidence: extracted.confidence,
          },
          source: 'extracted',
          cached: false,
          timestamp: Date.now(),
        },
        parentId: node.id,
        childrenIds: [],
        depth: node.depth + 1,
        timestamp: Date.now(),
        status: 'pending',
      };

      // إضافة العلاقة
      const relationship = this.analyzer.analyzeRelationship(
        node.identifierType,
        node.identifierValue,
        extracted.identifierId,
        extracted.value,
        extracted.sourcePath
      );

      if (relationship) {
        this.graph.links.push({
          sourceId: node.id,
          targetId: childNode.id,
          relationType: relationship.relationType,
          confidence: relationship.confidence,
          metadata: {
            sourceValue: relationship.sourceValue,
            targetValue: relationship.targetValue,
            evidence: relationship.evidence,
          },
        });
      } else {
        // علاقة عامة
        this.graph.links.push({
          sourceId: node.id,
          targetId: childNode.id,
          relationType: 'EXTRACTED_FROM_DATA',
          confidence: extracted.confidence,
          metadata: {
            extractionMethod: 'regex-pattern-matching',
            sourcePath: extracted.sourcePath,
          },
        });
      }

      this.graph.nodes.set(childNode.id, childNode);
      node.childrenIds.push(childNode.id);
      this.processedValues.add(this.getUniqueKey(extracted.identifierId, extracted.value));

      // إضافة إلى قائمة الانتظار
      this.queue.push({ nodeId: childNode.id, priority: childNode.depth });

      // تحديث أقصى عمق
      if (childNode.depth > this.graph.maxDepth) {
        this.graph.maxDepth = childNode.depth;
      }
    }
  }

  /**
   * توليد معرف فريد لعقدة
   */
  private generateNodeId(): string {
    return `node-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * توليد مفتاح فريد لقيمة معرف
   */
  private getUniqueKey(identifierType: string, value: string): string {
    return `${identifierType}:${value.toLowerCase().trim()}`;
  }
}

// ============================================================
// دوال مساعدة
// ============================================================

/**
 * تحويل الرسم البياني إلى تنسيق React Flow
 */
export function graphToReactFlow(graph: InvestigationGraph): { nodes: any[]; edges: any[] } {
  const nodes: any[] = [];
  const edges: any[] = [];

  for (const node of graph.nodes.values()) {
    nodes.push({
      id: node.id,
      type: getNodeTypeForIdentifier(node.identifierType),
      position: calculateNodePosition(node, graph),
      data: {
        label: node.identifierValue.substring(0, 30),
        identifierType: node.identifierName,
        identifierValue: node.identifierValue,
        depth: node.depth,
        status: node.status,
        fetchedData: node.data?.data,
        isRoot: node.id === graph.rootNodeId,
      },
    });
  }

  for (const link of graph.links) {
    edges.push({
      id: `edge-${link.sourceId}-${link.targetId}`,
      source: link.sourceId,
      target: link.targetId,
      label: link.relationType,
      animated: true,
      style: {
        stroke: getRelationColor(link.confidence),
        strokeWidth: Math.max(1, link.confidence * 3),
      },
      data: {
        relationType: link.relationType,
        confidence: link.confidence,
      },
    });
  }

  return { nodes, edges };
}

function getNodeTypeForIdentifier(identifierType: string): string {
  const mapping: Record<string, string> = {
    'email': 'text',
    'url': 'link',
    'youtube-video-id': 'video',
    'ipv4': 'location',
    'ipv6': 'location',
    'image': 'image',
  };
  return mapping[identifierType] || 'default';
}

function calculateNodePosition(node: InvestigationNode, graph: InvestigationGraph): { x: number; y: number } {
  if (node.id === graph.rootNodeId) {
    return { x: 400, y: 300 };
  }

  // ترتيب دائري حول العقدة الأم
  const parent = node.parentId ? graph.nodes.get(node.parentId) : null;
  if (parent && parent.childrenIds.length > 0) {
    const index = parent.childrenIds.indexOf(node.id);
    const total = parent.childrenIds.length;
    const angle = (index / total) * Math.PI * 2;
    const radius = 200 + node.depth * 50;
    return {
      x: (parent.data?.success ? 400 : 400) + Math.cos(angle) * radius,
      y: (parent.data?.success ? 300 : 300) + Math.sin(angle) * radius,
    };
  }

  return { x: 400 + Math.random() * 200, y: 300 + Math.random() * 200 };
}

function getRelationColor(confidence: number): string {
  if (confidence >= 0.8) return '#22c55e';
  if (confidence >= 0.6) return '#3b82f6';
  if (confidence >= 0.4) return '#f59e0b';
  return '#71717a';
}

/**
 * تصدير الرسم البياني إلى JSON
 */
export function exportGraphToJson(graph: InvestigationGraph): string {
  const data = {
    rootNodeId: graph.rootNodeId,
    startTime: graph.startTime,
    lastUpdateTime: graph.lastUpdateTime,
    totalFetched: graph.totalFetched,
    totalErrors: graph.totalErrors,
    maxDepth: graph.maxDepth,
    nodes: Array.from(graph.nodes.entries()).map(([id, node]) => ({
      id,
      identifierType: node.identifierType,
      identifierName: node.identifierName,
      identifierValue: node.identifierValue,
      parentId: node.parentId,
      childrenIds: node.childrenIds,
      depth: node.depth,
      status: node.status,
      data: node.data,
      timestamp: node.timestamp,
    })),
    links: graph.links,
  };
  return JSON.stringify(data, null, 2);
}

/**
 * استيراد الرسم البياني من JSON
 */
export function importGraphFromJson(json: string): InvestigationGraph {
  const data = JSON.parse(json);
  const graph: InvestigationGraph = {
    nodes: new Map(),
    links: data.links,
    rootNodeId: data.rootNodeId,
    startTime: data.startTime,
    lastUpdateTime: data.lastUpdateTime,
    totalFetched: data.totalFetched,
    totalErrors: data.totalErrors,
    maxDepth: data.maxDepth,
  };

  for (const nodeData of data.nodes) {
    graph.nodes.set(nodeData.id, nodeData);
  }

  return graph;
}

/**
 * الحصول على إحصائيات التحقيق
 */
export function getInvestigationStats(graph: InvestigationGraph): {
  totalNodes: number;
  fetchedNodes: number;
  errorNodes: number;
  pendingNodes: number;
  skippedNodes: number;
  totalLinks: number;
  maxDepth: number;
  duration: number;
  identifiersByType: Record<string, number>;
  identifiersByCategory: Record<string, number>;
  highConfidenceLinks: number;
  mediumConfidenceLinks: number;
  lowConfidenceLinks: number;
} {
  const identifiersByType: Record<string, number> = {};
  const identifiersByCategory: Record<string, number> = {};
  let fetchedNodes = 0;
  let errorNodes = 0;
  let pendingNodes = 0;
  let skippedNodes = 0;
  let highConfidenceLinks = 0;
  let mediumConfidenceLinks = 0;
  let lowConfidenceLinks = 0;

  for (const node of graph.nodes.values()) {
    identifiersByType[node.identifierType] = (identifiersByType[node.identifierType] || 0) + 1;
    const identifier = IDENTIFIER_LIST.find(i => i.id === node.identifierType);
    if (identifier) {
      identifiersByCategory[identifier.category] = (identifiersByCategory[identifier.category] || 0) + 1;
    }

    switch (node.status) {
      case 'fetched': fetchedNodes++; break;
      case 'error': errorNodes++; break;
      case 'pending': pendingNodes++; break;
      case 'skipped': skippedNodes++; break;
    }
  }

  for (const link of graph.links) {
    if (link.confidence >= 0.8) highConfidenceLinks++;
    else if (link.confidence >= 0.5) mediumConfidenceLinks++;
    else lowConfidenceLinks++;
  }

  return {
    totalNodes: graph.nodes.size,
    fetchedNodes,
    errorNodes,
    pendingNodes,
    skippedNodes,
    totalLinks: graph.links.length,
    maxDepth: graph.maxDepth,
    duration: Date.now() - graph.startTime,
    identifiersByType,
    identifiersByCategory,
    highConfidenceLinks,
    mediumConfidenceLinks,
    lowConfidenceLinks,
  };
}

// ============================================================
// دالة البدء السريع
// ============================================================

export async function quickInvestigate(
  value: string,
  apiKeys: Record<string, string>,
  options?: Partial<InvestigationConfig>
): Promise<InvestigationGraph> {
  const investigator = new SmartInvestigator({
    apiKeys,
    maxDepth: options?.maxDepth || 3,
    maxNodes: options?.maxNodes || 200,
    maxConcurrentFetches: options?.maxConcurrentFetches || 6,
    timeoutPerFetch: options?.timeoutPerFetch || 10000,
    includeLowConfidence: options?.includeLowConfidence || false,
    confidenceThreshold: options?.confidenceThreshold || 0.4,
    ...options,
  });

  return investigator.investigate(value);
}

// ============================================================
// تصدير كل شيء
// ============================================================

export default {
  SmartInvestigator,
  IdentifierExtractor,
  RelationshipAnalyzer,
  graphToReactFlow,
  exportGraphToJson,
  importGraphFromJson,
  getInvestigationStats,
  quickInvestigate,
};
