import { create } from "zustand";

import type { LayoutPositions } from "../pages/workbench/layout";

/**
 * ViewState (ROADMAP 5.4): presentation-only state kept out of the domain — graph node
 * positions, layout and filters. This store fixes the "غير محفوظ" half of D-026: layouts are
 * saved per graph key and reapplied without recomputation. View state only: nothing here is
 * persisted to browser storage (D-033).
 *
 * P3-021: the same store carries «إزالة من العرض» — nodes removed from the view, keyed
 * by the graph's identity. Removal is a reversible VIEW fact (D-033): it never rewrites
 * the case projection, and «إظهار كل العقد» clears the set for the current graph.
 */

interface ViewSelection {
  /** Saved layouts keyed by the graph's identity (positionsKey). */
  layouts: Record<string, LayoutPositions>; // values are Maps (structured-clone safe)
  /** Nodes removed from the view, keyed by the graph's identity (P3-021). */
  hidden: Record<string, string[]>;
  saveLayout: (key: string, positions: LayoutPositions) => void;
  getLayout: (key: string) => LayoutPositions | null;
  hideNodes: (key: string, nodeIds: readonly string[]) => void;
  getHidden: (key: string) => string[];
  showAll: (key: string) => void;
  clear: () => void;
}

export const useViewState = create<ViewSelection>((set, get) => ({
  layouts: {},
  hidden: {},
  saveLayout: (key, positions) => set((state) => ({ layouts: { ...state.layouts, [key]: positions } })),
  getLayout: (key) => get().layouts[key] ?? null,
  hideNodes: (key, nodeIds) =>
    set((state) => {
      const current = state.hidden[key] ?? [];
      const merged = [...new Set([...current, ...nodeIds])];
      return { hidden: { ...state.hidden, [key]: merged } };
    }),
  getHidden: (key) => get().hidden[key] ?? [],
  showAll: (key) =>
    set((state) => {
      if (!(key in state.hidden)) return state;
      const next: Record<string, string[]> = {};
      for (const k of Object.keys(state.hidden)) {
        if (k !== key) next[k] = state.hidden[k];
      }
      return { hidden: next };
    }),
  clear: () => set({ layouts: {}, hidden: {} }),
}));
