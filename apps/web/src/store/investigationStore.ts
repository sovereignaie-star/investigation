import { create } from "zustand";
import type { InvestigationNode, InvestigationEdge, InvestigationStats } from "../types";

interface InvestigationStore {
  nodes: InvestigationNode[];
  edges: InvestigationEdge[];
  stats: InvestigationStats;
  isInvestigating: boolean;
  selectedNodeId: string | null;
  showApiKeys: boolean;
  showSaved: boolean;
  showFileUploader: boolean;
  showIdentifierSelector: boolean;

  addNode: (node: InvestigationNode) => void;
  updateNode: (id: string, updates: Partial<InvestigationNode>) => void;
  addEdge: (edge: InvestigationEdge) => void;
  setInvestigating: (value: boolean) => void;
  updateStats: (stats: Partial<InvestigationStats>) => void;
  setSelectedNode: (id: string | null) => void;
  clearInvestigation: () => void;
  loadInvestigation: (nodes: InvestigationNode[], edges: InvestigationEdge[], stats: InvestigationStats) => void;
  setShowApiKeys: (value: boolean) => void;
  setShowSaved: (value: boolean) => void;
  setShowFileUploader: (value: boolean) => void;
  setShowIdentifierSelector: (value: boolean) => void;
  incrementError: () => void;
}

const defaultStats: InvestigationStats = {
  nodeCount: 0,
  edgeCount: 0,
  maxDepth: 0,
  errorCount: 0,
  elapsed: 0,
  identifierTypes: {},
  status: "idle",
};

/**
 * View store only (P1-021, D-033): in memory, never persisted. Case data (nodes, edges, results) lives in the case
 * store on the server (P1-013/P1-014) and is shown through its projections (P1-016); the browser keeps no copy in
 * localStorage. Saved investigations still go to IndexedDB until the web app moves to the server case (D-035).
 */
export const useInvestigationStore = create<InvestigationStore>()((set) => ({
  nodes: [],
  edges: [],
  stats: { ...defaultStats },
  isInvestigating: false,
  selectedNodeId: null,
  showApiKeys: false,
  showSaved: false,
  showFileUploader: false,
  showIdentifierSelector: false,

  addNode: (node) => {
    set((state) => {
      const exists = state.nodes.find((n) => n.id === node.id);
      if (exists) return state;
      const identifierTypes = { ...state.stats.identifierTypes };
      identifierTypes[node.identifierType] = (identifierTypes[node.identifierType] || 0) + 1;
      const maxDepth = Math.max(state.stats.maxDepth, node.depth);
      return {
        nodes: [...state.nodes, node],
        stats: {
          ...state.stats,
          nodeCount: state.nodes.length + 1,
          identifierTypes,
          maxDepth,
        },
      };
    });
  },

  updateNode: (id, updates) => {
    set((state) => ({
      nodes: state.nodes.map((n) => (n.id === id ? { ...n, ...updates } : n)),
    }));
  },

  addEdge: (edge) => {
    set((state) => {
      const exists = state.edges.find((e) => e.id === edge.id);
      if (exists) return state;
      return {
        edges: [...state.edges, edge],
        stats: {
          ...state.stats,
          edgeCount: state.edges.length + 1,
        },
      };
    });
  },

  setInvestigating: (value) => {
    set((state) => ({
      isInvestigating: value,
      stats: {
        ...state.stats,
        status: value ? "investigating" : state.stats.status === "investigating" ? "done" : state.stats.status,
      },
    }));
  },

  updateStats: (updates) => {
    set((state) => ({
      stats: { ...state.stats, ...updates },
    }));
  },

  setSelectedNode: (id) => set({ selectedNodeId: id }),

  clearInvestigation: () => {
    set({
      nodes: [],
      edges: [],
      stats: { ...defaultStats },
      isInvestigating: false,
      selectedNodeId: null,
    });
  },

  loadInvestigation: (nodes, edges, stats) => {
    set({ nodes, edges, stats, isInvestigating: false, selectedNodeId: null });
  },

  setShowApiKeys: (value) => set({ showApiKeys: value }),
  setShowSaved: (value) => set({ showSaved: value }),
  setShowFileUploader: (value) => set({ showFileUploader: value }),
  setShowIdentifierSelector: (value) => set({ showIdentifierSelector: value }),

  incrementError: () => {
    set((state) => ({
      stats: { ...state.stats, errorCount: state.stats.errorCount + 1 },
    }));
  },
}));
