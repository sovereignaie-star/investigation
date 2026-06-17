import { create } from 'zustand';
import type { InvestigationNode, InvestigationLink, InvestigationStatus, InvestigationStats } from '../types';

interface InvestigationState {
  nodes: InvestigationNode[];
  links: InvestigationLink[];
  rootId: string | null;
  selectedNodeId: string | null;
  status: InvestigationStatus;
  startTime: number | null;
  elapsedSeconds: number;
  searchValue: string;
  stopSignal: { stop: boolean };

  // Derived stats
  getStats: () => InvestigationStats;

  // Actions
  setSearchValue: (v: string) => void;
  startInvestigation: () => void;
  stopInvestigation: () => void;
  resetInvestigation: () => void;
  setStatus: (s: InvestigationStatus) => void;
  addNode: (node: InvestigationNode) => void;
  updateNode: (node: InvestigationNode) => void;
  addLink: (link: InvestigationLink) => void;
  setRootId: (id: string) => void;
  selectNode: (id: string | null) => void;
  setElapsed: (s: number) => void;
  loadGraph: (nodes: InvestigationNode[], links: InvestigationLink[], rootId: string) => void;
}

export const useInvestigationStore = create<InvestigationState>((set, get) => ({
  nodes: [],
  links: [],
  rootId: null,
  selectedNodeId: null,
  status: 'idle',
  startTime: null,
  elapsedSeconds: 0,
  searchValue: '',
  stopSignal: { stop: false },

  getStats(): InvestigationStats {
    const { nodes, links, status, elapsedSeconds } = get();
    const byCategory: Record<string, number> = {};
    let maxDepth = 0;
    let errorCount = 0;
    for (const n of nodes) {
      byCategory[n.identifierType] = (byCategory[n.identifierType] || 0) + 1;
      if (n.depth > maxDepth) maxDepth = n.depth;
      if (n.status === 'error') errorCount++;
    }
    return {
      nodeCount: nodes.length,
      linkCount: links.length,
      depth: maxDepth,
      elapsedSeconds,
      errorCount,
      byCategory,
      status,
    };
  },

  setSearchValue: v => set({ searchValue: v }),

  startInvestigation: () => set({ status: 'running', startTime: Date.now(), stopSignal: { stop: false }, nodes: [], links: [], rootId: null, selectedNodeId: null, elapsedSeconds: 0 }),

  stopInvestigation: () => {
    const { stopSignal } = get();
    stopSignal.stop = true;
    set({ status: 'paused' });
  },

  resetInvestigation: () => set({ nodes: [], links: [], rootId: null, selectedNodeId: null, status: 'idle', startTime: null, elapsedSeconds: 0, searchValue: '', stopSignal: { stop: false } }),

  setStatus: s => set({ status: s }),

  addNode: node => set(state => ({ nodes: [...state.nodes, node] })),

  updateNode: node => set(state => ({ nodes: state.nodes.map(n => n.id === node.id ? node : n) })),

  addLink: link => set(state => ({ links: [...state.links, link] })),

  setRootId: id => set({ rootId: id }),

  selectNode: id => set({ selectedNodeId: id }),

  setElapsed: s => set({ elapsedSeconds: s }),

  loadGraph: (nodes, links, rootId) => set({ nodes, links, rootId, status: 'completed' }),
}));
