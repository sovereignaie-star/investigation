import { z } from 'zod';

export type IdentifierCategory =
  | 'session'
  | 'web'
  | 'mobile'
  | 'hardware'
  | 'cellular'
  | 'network'
  | 'email'
  | 'application'
  | 'database'
  | 'crypto'
  | 'blockchain'
  | 'social'
  | 'cloud'
  | 'business'
  | 'shipping'
  | 'biometric'
  | 'vehicle'
  | 'document'
  | 'government'
  | 'gaming'
  | 'iot'
  | 'multimedia'
  | 'finance'
  | 'other';

export type ResultNodeType =
  | 'video'
  | 'map'
  | 'image'
  | 'file'
  | 'link'
  | 'location'
  | 'text'
  | 'audio'
  | 'default';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface IdentifierDefinition {
  id: string;
  name: string;
  nameAr: string;
  category: IdentifierCategory;
  pattern: RegExp;
  icon: string;
  priority: number;
  resultNodeType: ResultNodeType;
  description?: string;
}

export interface DetectionResult {
  identifierId: string;
  identifierName: string;
  identifierNameAr: string;
  icon: string;
  value: string;
  confidence: ConfidenceLevel;
  multipleMatches: boolean;
  alternativeMatches: Array<{
    identifierId: string;
    identifierName: string;
    icon: string;
  }>;
  suggestedNodeType: ResultNodeType;
}

export interface FetchResult {
  success: boolean;
  data: Record<string, unknown>;
  source: string;
  cached: boolean;
  timestamp: number;
  errors?: string[];
  warnings?: string[];
}

export interface InvestigationNodeData {
  id: string;
  searchTerm: string;
  detectedType: string;
  detectedTypeName: string;
  detectedTypeNameAr: string;
  detectedTypeIcon: string;
  timestamp: number;
  rawResult: FetchResult | null;
  metadata: Record<string, unknown>;
}

export interface InvestigationNode {
  id: string;
  type: ResultNodeType;
  identifierType: string;
  identifierTypeName: string;
  identifierTypeNameAr: string;
  identifierTypeIcon: string;
  identifierValue: string;
  data: InvestigationNodeData;
  position: { x: number; y: number };
  depth: number;
  parentId: string | null;
  childrenIds: string[];
  status: 'pending' | 'fetched' | 'error' | 'skipped';
}

export interface InvestigationLink {
  id: string;
  sourceId: string;
  targetId: string;
  relationType: string;
  confidence: number;
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

export interface SavedInvestigation {
  id: string;
  name: string;
  rootValue: string;
  graphJson: string;
  createdAt: number;
  updatedAt: number;
  nodeCount: number;
}

export interface CachedNode {
  id: string;
  identifierType: string;
  identifierValue: string;
  data: FetchResult;
  timestamp: number;
}

export interface ApiKeyInfo {
  key: string;
  name: string;
  url: string;
  envVar: string;
  configured: boolean;
  maskedValue: string;
}

export interface InvestigationConfig {
  maxDepth: number;
  maxNodes: number;
  maxConcurrentFetches: number;
  timeoutPerFetch: number;
  cacheResults: boolean;
  confidenceThreshold: number;
  apiKeys: Record<string, string>;
}

export type InvestigationStatus = 'idle' | 'running' | 'paused' | 'completed' | 'error';

export interface InvestigationStats {
  nodeCount: number;
  linkCount: number;
  depth: number;
  elapsedSeconds: number;
  errorCount: number;
  byCategory: Record<string, number>;
  status: InvestigationStatus;
}
