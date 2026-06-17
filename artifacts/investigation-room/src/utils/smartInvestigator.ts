import { detectIdentifier } from './identifierList';
import { fetchIdentifierData } from './resultFetcher';
import type { InvestigationNode, InvestigationLink, InvestigationConfig, FetchResult } from '../types';

// Patterns for extracting identifiers from text
const EXTRACT_PATTERNS: Array<{ pattern: RegExp; identifierId: string; confidence: number }> = [
  { pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, identifierId: 'email', confidence: 0.95 },
  { pattern: /https?:\/\/[^\s<>"']+/g, identifierId: 'url', confidence: 0.85 },
  { pattern: /\b(\d{1,3}\.){3}\d{1,3}\b/g, identifierId: 'ipv4', confidence: 0.8 },
  { pattern: /([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})/g, identifierId: 'mac-address', confidence: 0.9 },
  { pattern: /0x[a-fA-F0-9]{40}/g, identifierId: 'ethereum-address', confidence: 0.9 },
  { pattern: /\b[13][a-km-zA-HJ-NP-Z1-9]{25,34}\b/g, identifierId: 'bitcoin-address', confidence: 0.85 },
  { pattern: /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, identifierId: 'uuid-v4', confidence: 0.85 },
  { pattern: /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, identifierId: 'jwt', confidence: 0.9 },
  { pattern: /\+\d{7,15}/g, identifierId: 'phone-number', confidence: 0.7 },
  { pattern: /\b[0-9]{15}\b/g, identifierId: 'imei', confidence: 0.6 },
  { pattern: /@[a-zA-Z0-9_]{5,32}/g, identifierId: 'telegram-id', confidence: 0.6 },
  { pattern: /AS[0-9]{1,10}/g, identifierId: 'asn', confidence: 0.9 },
  { pattern: /\b[A-HJ-NPR-Z0-9]{17}\b/g, identifierId: 'vin', confidence: 0.8 },
  { pattern: /\b[a-f0-9]{64}\b/gi, identifierId: 'sha256-hash', confidence: 0.7 },
  { pattern: /\b[a-f0-9]{40}\b/gi, identifierId: 'sha1-hash', confidence: 0.65 },
  { pattern: /\b[a-f0-9]{32}\b/gi, identifierId: 'md5-hash', confidence: 0.6 },
  { pattern: /\b[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z]{2,})+\b/g, identifierId: 'domain', confidence: 0.5 },
  { pattern: /-?[0-9]{1,2}\.[0-9]+,\s*-?[0-9]{1,3}\.[0-9]+/g, identifierId: 'coordinates', confidence: 0.9 },
];

function extractFromText(text: string): Array<{ value: string; identifierId: string; confidence: number }> {
  const found: Array<{ value: string; identifierId: string; confidence: number }> = [];
  const seen = new Set<string>();

  for (const { pattern, identifierId, confidence } of EXTRACT_PATTERNS) {
    const resetPattern = new RegExp(pattern.source, pattern.flags);
    const matches = text.matchAll(resetPattern);
    for (const match of matches) {
      const value = match[0];
      const key = `${identifierId}:${value}`;
      if (seen.has(key) || value.length < 3 || value.length > 500) continue;
      seen.add(key);
      found.push({ value, identifierId, confidence });
    }
  }

  return found;
}

function extractFromData(data: unknown, depth = 0): string[] {
  if (depth > 5) return [];
  if (typeof data === 'string') return [data];
  if (Array.isArray(data)) return data.flatMap(item => extractFromData(item, depth + 1));
  if (data && typeof data === 'object') {
    return Object.values(data as Record<string, unknown>).flatMap(v => extractFromData(v, depth + 1));
  }
  return [];
}

export interface InvestigationProgress {
  nodesTotal: number;
  nodesFetched: number;
  currentValue: string;
  depth: number;
  status: 'running' | 'completed' | 'stopped' | 'error';
}

export interface SmartInvestigatorResult {
  nodes: InvestigationNode[];
  links: InvestigationLink[];
  rootId: string;
}

export async function investigate(
  rootValue: string,
  config: Partial<InvestigationConfig> & {
    onProgress?: (p: InvestigationProgress) => void;
    onNodeAdded?: (node: InvestigationNode) => void;
    onNodeUpdated?: (node: InvestigationNode) => void;
    stopSignal?: { stop: boolean };
  } = {}
): Promise<SmartInvestigatorResult> {
  const maxDepth = config.maxDepth ?? 2;
  const maxNodes = config.maxNodes ?? 50;
  const apiKeys = config.apiKeys ?? {};
  const confidenceThreshold = config.confidenceThreshold ?? 0.5;

  const nodes = new Map<string, InvestigationNode>();
  const links: InvestigationLink[] = [];
  let nodeCounter = 0;

  function makeId(): string {
    return `node-${++nodeCounter}`;
  }

  function makeNode(
    value: string,
    fetchResult: FetchResult | null,
    detection: ReturnType<typeof detectIdentifier>,
    depth: number,
    parentId: string | null
  ): InvestigationNode {
    const id = makeId();
    const angle = Math.random() * Math.PI * 2;
    const radius = 200 + depth * 200 + Math.random() * 100;
    const px = parentId ? 600 : 600;
    const py = parentId ? 400 : 400;

    return {
      id,
      type: detection.suggestedNodeType,
      identifierType: detection.identifierId,
      identifierTypeName: detection.identifierName,
      identifierTypeNameAr: detection.identifierNameAr,
      identifierTypeIcon: detection.icon,
      identifierValue: value,
      data: {
        id,
        searchTerm: value,
        detectedType: detection.identifierId,
        detectedTypeName: detection.identifierName,
        detectedTypeNameAr: detection.identifierNameAr,
        detectedTypeIcon: detection.icon,
        timestamp: Date.now(),
        rawResult: fetchResult,
        metadata: fetchResult?.data ?? {},
      },
      position: {
        x: px + Math.cos(angle) * radius * (depth || 0.1),
        y: py + Math.sin(angle) * radius * (depth || 0.1),
      },
      depth,
      parentId,
      childrenIds: [],
      status: fetchResult ? 'fetched' : 'pending',
    };
  }

  // BFS queue
  const queue: Array<{ value: string; depth: number; parentId: string | null }> = [
    { value: rootValue, depth: 0, parentId: null }
  ];
  const visitedValues = new Set<string>();
  let rootId = '';

  while (queue.length > 0 && nodes.size < maxNodes) {
    if (config.stopSignal?.stop) break;

    const item = queue.shift()!;
    if (visitedValues.has(item.value)) continue;
    visitedValues.add(item.value);

    const detection = detectIdentifier(item.value);
    config.onProgress?.({
      nodesTotal: nodes.size + queue.length,
      nodesFetched: nodes.size,
      currentValue: item.value,
      depth: item.depth,
      status: 'running',
    });

    // Create placeholder node
    const placeholderNode: InvestigationNode = {
      id: makeId(),
      type: detection.suggestedNodeType,
      identifierType: detection.identifierId,
      identifierTypeName: detection.identifierName,
      identifierTypeNameAr: detection.identifierNameAr,
      identifierTypeIcon: detection.icon,
      identifierValue: item.value,
      data: {
        id: `node-${nodeCounter}`,
        searchTerm: item.value,
        detectedType: detection.identifierId,
        detectedTypeName: detection.identifierName,
        detectedTypeNameAr: detection.identifierNameAr,
        detectedTypeIcon: detection.icon,
        timestamp: Date.now(),
        rawResult: null,
        metadata: {},
      },
      position: {
        x: 600 + (Math.random() - 0.5) * 400 * (item.depth + 0.5),
        y: 400 + (Math.random() - 0.5) * 300 * (item.depth + 0.5),
      },
      depth: item.depth,
      parentId: item.parentId,
      childrenIds: [],
      status: 'pending',
    };

    nodes.set(placeholderNode.id, placeholderNode);
    if (!rootId) rootId = placeholderNode.id;
    config.onNodeAdded?.(placeholderNode);

    // Add link to parent
    if (item.parentId) {
      const linkId = `link-${item.parentId}-${placeholderNode.id}`;
      links.push({ id: linkId, sourceId: item.parentId, targetId: placeholderNode.id, relationType: 'CONTAINS', confidence: detection.confidence === 'high' ? 0.9 : detection.confidence === 'medium' ? 0.6 : 0.3 });
      const parent = nodes.get(item.parentId);
      if (parent) parent.childrenIds.push(placeholderNode.id);
    }

    // Fetch data
    let fetchResult: FetchResult | null = null;
    try {
      fetchResult = await fetchIdentifierData(detection.identifierId, item.value, { apiKeys });
    } catch { /* ignore */ }

    // Update node with result
    const updatedNode = { ...placeholderNode, status: fetchResult ? 'fetched' as const : 'error' as const, data: { ...placeholderNode.data, rawResult: fetchResult, metadata: fetchResult?.data ?? {} } };
    nodes.set(placeholderNode.id, updatedNode);
    config.onNodeUpdated?.(updatedNode);

    // Extract children for BFS (only at low depths)
    if (fetchResult && item.depth < maxDepth && nodes.size < maxNodes) {
      const texts = extractFromData(fetchResult.data);
      const allText = texts.join(' ');
      const extracted = extractFromText(allText).filter(e => e.confidence >= confidenceThreshold);

      for (const ext of extracted) {
        if (visitedValues.has(ext.value)) continue;
        if (ext.value === item.value) continue;
        queue.push({ value: ext.value, depth: item.depth + 1, parentId: placeholderNode.id });
      }
    }

    // Small delay to not overwhelm APIs
    await new Promise(r => setTimeout(r, 200));
  }

  config.onProgress?.({
    nodesTotal: nodes.size,
    nodesFetched: nodes.size,
    currentValue: '',
    depth: 0,
    status: config.stopSignal?.stop ? 'stopped' : 'completed',
  });

  return {
    nodes: Array.from(nodes.values()),
    links,
    rootId,
  };
}
