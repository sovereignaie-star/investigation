export type NodeType =
  | 'default'
  | 'text'
  | 'link'
  | 'image'
  | 'video'
  | 'map'
  | 'file'
  | 'location';

export interface IdentifierType {
  id: string;
  name: string;
  nameAr: string;
  category: string;
  categoryAr: string;
  icon: string;
  color: string;
  description: string;
  regex: RegExp;
  examples?: string[];
  apiSupport?: string[];
}

export interface InvestigationNode {
  id: string;
  type: NodeType;
  identifier: string;
  identifierType: string;
  value: string;
  label: string;
  data: Record<string, unknown>;
  metadata: Record<string, unknown>;
  status: 'pending' | 'fetching' | 'done' | 'error';
  error?: string;
  position: { x: number; y: number };
  depth: number;
  parentId?: string;
  timestamp: number;
}

export interface InvestigationEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  type?: string;
  animated?: boolean;
}

export interface InvestigationStats {
  nodeCount: number;
  edgeCount: number;
  maxDepth: number;
  errorCount: number;
  elapsed: number;
  identifierTypes: Record<string, number>;
  status: 'idle' | 'investigating' | 'done' | 'stopped';
}

export interface ApiKeys {
  shodan: string;
  virustotal: string;
  ipinfo: string;
  abuseipdb: string;
  hunter: string;
  haveibeenpwned: string;
  numverify: string;
  ipgeolocation: string;
  clearbit: string;
  fullcontact: string;
  censys: string;
  binaryedge: string;
  greynoise: string;
  securitytrails: string;
  whoisxml: string;
}

export interface SavedInvestigation {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  nodeCount: number;
  edgeCount: number;
  nodes: InvestigationNode[];
  edges: InvestigationEdge[];
  stats: InvestigationStats;
}

export interface DetectionResult {
  identifierType: IdentifierType;
  confidence: number;
  value: string;
}

export interface FetchResult {
  nodeType: NodeType;
  data: Record<string, unknown>;
  metadata: Record<string, unknown>;
  childIdentifiers?: Array<{ value: string; type: string }>;
  label?: string;
  error?: string;
}

export interface SmartInvestigatorCallbacks {
  onNodeFetched: (node: InvestigationNode) => void;
  onEdgeAdded: (edge: InvestigationEdge) => void;
  onProgress: (stats: InvestigationStats) => void;
  onComplete: (stats: InvestigationStats) => void;
  onError: (nodeId: string, error: string) => void;
  shouldStop: () => boolean;
}
