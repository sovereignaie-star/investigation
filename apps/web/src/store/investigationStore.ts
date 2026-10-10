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
  /** Adds many nodes with one state update and one array copy; ids already present (or repeated) are skipped. */
  addNodes: (nodes: readonly InvestigationNode[]) => void;
  updateNode: (id: string, updates: Partial<InvestigationNode>) => void;
  addEdge: (edge: InvestigationEdge) => void;
  /** Adds many edges with one state update and one array copy; ids already present (or repeated) are skipped. */
  addEdges: (edges: readonly InvestigationEdge[]) => void;
  setInvestigating: (value: boolean) => void;
  updateStats: (stats: Partial<InvestigationStats>) => void;
  setSelectedNode: (id: string | null) => void;
  clearInvestigation: () => void;
  /** Replaces the view; throws DuplicateIdError (state unchanged) if a node or edge id repeats (ADR-25). */
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
 * ADR-25: a node id is its canonical key (P1-007, D-020) and an edge id names its two ends, so ids are unique in the
 * view store. addNode/addNodes/addEdge/addEdges skip ids already present; loadInvestigation, the only other way
 * data enters, refuses lists with repeated ids instead of silently dropping or merging them. Under this invariant
 * "the node with this id" is one node, and updateNode changes exactly that node.
 */
export class DuplicateIdError extends Error {
  constructor(
    readonly kind: "node" | "edge",
    readonly ids: string[],
  ) {
    super(`ADR-25: ${kind} ids must be unique; repeated: ${ids.slice(0, 5).join(", ")}${ids.length > 5 ? ", ..." : ""}`);
    this.name = "DuplicateIdError";
  }
}

function assertUniqueIds(kind: "node" | "edge", list: readonly { id: string }[]): void {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const { id } of list) (seen.has(id) ? repeated : seen).add(id);
  if (repeated.size) throw new DuplicateIdError(kind, [...repeated]);
}

/**
 * Id -> position index for one array (P1-022, D-034). It is tied to the array it was built from: when the store
 * replaces that array (append below) the index follows in O(1) per item; any other replacement (load, clear,
 * setState from outside) is detected by reference and the index is rebuilt once. Ids are unique (ADR-25).
 */
class IdIndex<T extends { id: string }> {
  #of: readonly T[] | null = null;
  #pos = new Map<string, number>();

  for(list: readonly T[]): Map<string, number> {
    if (list !== this.#of) {
      this.#pos = new Map();
      list.forEach((item, i) => {
        if (!this.#pos.has(item.id)) this.#pos.set(item.id, i);
      });
      this.#of = list;
    }
    return this.#pos;
  }

  /** Items of `batch` whose id is neither in `list` nor earlier in `batch`. */
  fresh(list: readonly T[], batch: readonly T[]): T[] {
    const pos = this.for(list);
    const seen = new Set<string>();
    return batch.filter((item) => !pos.has(item.id) && !seen.has(item.id) && (seen.add(item.id), true));
  }

  /** `next` has the same ids at the same positions as `list` (an item was replaced): keep the index. */
  replaced(list: readonly T[], next: readonly T[]): void {
    this.for(list);
    this.#of = next;
  }

  /** `list` with `added` appended; the index moves to the new array without a rebuild. */
  append(list: readonly T[], added: readonly T[]): T[] {
    const pos = this.for(list);
    const next = list.concat(added);
    added.forEach((item, i) => pos.set(item.id, list.length + i));
    this.#of = next;
    return next;
  }
}

/**
 * View store only (P1-021, D-033): in memory, never persisted. Case data (nodes, edges, results) lives in the case
 * store on the server (P1-013/P1-014) and is shown through its projections (P1-016); the browser keeps no copy in
 * localStorage. Saved investigations still go to IndexedDB until the web app moves to the server case (D-035).
 */
const nodeIndex = new IdIndex<InvestigationNode>();
const edgeIndex = new IdIndex<InvestigationEdge>();

export const useInvestigationStore = create<InvestigationStore>()((set, get) => ({
  nodes: [],
  edges: [],
  stats: { ...defaultStats },
  isInvestigating: false,
  selectedNodeId: null,
  showApiKeys: false,
  showSaved: false,
  showFileUploader: false,
  showIdentifierSelector: false,

  addNode: (node) => get().addNodes([node]),

  addNodes: (batch) => {
    set((state) => {
      const added = nodeIndex.fresh(state.nodes, batch);
      if (!added.length) return state;
      const identifierTypes = { ...state.stats.identifierTypes };
      let maxDepth = state.stats.maxDepth;
      for (const node of added) {
        identifierTypes[node.identifierType] = (identifierTypes[node.identifierType] || 0) + 1;
        maxDepth = Math.max(maxDepth, node.depth);
      }
      const nodes = nodeIndex.append(state.nodes, added);
      return { nodes, stats: { ...state.stats, nodeCount: nodes.length, identifierTypes, maxDepth } };
    });
  },

  updateNode: (id, updates) => {
    set((state) => {
      const i = nodeIndex.for(state.nodes).get(id);
      if (i === undefined) return state;
      const nodes = state.nodes.slice();
      nodes[i] = { ...(nodes[i] as InvestigationNode), ...updates };
      nodeIndex.replaced(state.nodes, nodes);
      return { nodes };
    });
  },

  addEdge: (edge) => get().addEdges([edge]),

  addEdges: (batch) => {
    set((state) => {
      const added = edgeIndex.fresh(state.edges, batch);
      if (!added.length) return state;
      const edges = edgeIndex.append(state.edges, added);
      return { edges, stats: { ...state.stats, edgeCount: edges.length } };
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
    assertUniqueIds("node", nodes);
    assertUniqueIds("edge", edges);
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
