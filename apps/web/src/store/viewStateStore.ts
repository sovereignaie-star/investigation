import { create } from "zustand";

import type { LayoutPositions } from "../pages/workbench/layout";

/**
 * ViewState (ROADMAP 5.4): presentation-only state kept out of the domain — graph node
 * positions, layout and filters. This store fixes the "غير محفوظ" half of D-026: layouts are
 * saved per graph key and reapplied without recomputation. View state only: nothing here is
 * persisted to browser storage (D-033).
 */

interface ViewSelection {
  /** Saved layouts keyed by the graph's identity (positionsKey). */
  layouts: Record<string, LayoutPositions>;
  saveLayout: (key: string, positions: LayoutPositions) => void;
  getLayout: (key: string) => LayoutPositions | null;
  clear: () => void;
}

export const useViewState = create<ViewSelection>((set, get) => ({
  layouts: {},
  saveLayout: (key, positions) => set((state) => ({ layouts: { ...state.layouts, [key]: positions } })),
  getLayout: (key) => get().layouts[key] ?? null,
  clear: () => set({ layouts: {} }),
}));
