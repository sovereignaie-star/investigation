import * as zustand from "zustand";

/**
 * P3-007: saved node positions per graph (view state only — P1-021: NOTHING here is
 * persisted; the browser stores no case data). P3-021 added the hidden-nodes view
 * state (إزالة عقدة/فرع من العرض — a REVERSIBLE view state, the case's own
 * projection and ledger are never touched).
 *
 * P3-022: the view's edit history (undo/redo). The history is over the VIEW state
 * only — a snapshot of {layouts, hidden} is taken before every recorded edit, and
 * an undo restores that exact snapshot. Case data (notes, projections, the ledger)
 * is NEVER part of it: a case deletion is an opposite ledger event (D1), never an
 * erasure and never view state; notes are case data and have no view-undo.
 *
 * The linear-undo model: a new edit clears the redo branch. The history is bounded
 * (HISTORY_LIMIT) — a drag-happy session cannot grow it without limit. The FIRST
 * layout of a graph is the BASELINE, not an edit (undoing it would restore a state
 * the user never saw); only a layout CHANGE (a prior layout existed) is recorded.
 */
export interface LayoutPositions {
  get(id: string): { x: number; y: number } | undefined;
}

/** A byte-exact snapshot of the whole view state — what an undo restores. */
interface ViewSnapshot {
  layouts: Record<string, LayoutPositions>;
  hidden: Record<string, string[]>;
}

const HISTORY_LIMIT = 100;

const snapshotOf = (state: ViewStateShape): ViewSnapshot => ({
  layouts: state.layouts,
  hidden: state.hidden,
});

export interface ViewStateShape {
  layouts: Record<string, LayoutPositions>;
  hidden: Record<string, string[]>;
  /** The undo stack (oldest first); the redo stack is cleared by any new edit. */
  undoStack: ViewSnapshot[];
  redoStack: ViewSnapshot[];
  getLayout: (key: string) => LayoutPositions | null;
  getHidden: (key: string) => string[];
  /** P3-022: records that an edit is about to happen (internal — used by the mutating actions). */
  recordEdit: () => void;
  saveLayout: (key: string, positions: LayoutPositions) => void;
  hideNodes: (key: string, nodeIds: readonly string[]) => void;
  showAll: (key: string) => void;
  /** P3-022: undo the last recorded view edit (an honest no-op on an empty history). */
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clear: () => void;
}

export const useViewState = zustand.create<ViewStateShape>((set, get) => ({
  layouts: {},
  hidden: {},
  undoStack: [],
  redoStack: [],

  getLayout: (key) => get().layouts[key] ?? null,
  getHidden: (key) => get().hidden[key] ?? [],

  // P3-022: pushes the CURRENT state onto the undo stack (bounded) and drops the
  // redo branch — the caller applies its edit in the same set.
  recordEdit: () =>
    set((state) => ({
      undoStack: [...state.undoStack, snapshotOf(state)].slice(-HISTORY_LIMIT),
      redoStack: [],
    })),

  saveLayout: (key, positions) => {
    // P3-022: only a layout CHANGE is an edit — the first layout of a graph is the
    // baseline the user starts from, not an operation they performed.
    const prior = get().layouts[key];
    if (prior !== undefined) get().recordEdit();
    set((state) => ({ layouts: { ...state.layouts, [key]: positions } }));
  },

  hideNodes: (key, nodeIds) => {
    if (nodeIds.length === 0) return;
    get().recordEdit();
    set((state) => ({
      hidden: { ...state.hidden, [key]: [...(state.hidden[key] ?? []), ...nodeIds] },
    }));
  },

  showAll: (key) => {
    // P3-022: restoring the view is itself an edit (undoing it re-hides).
    if ((get().hidden[key] ?? []).length === 0) return;
    get().recordEdit();
    set((state) => {
      const next: Record<string, string[]> = {};
      for (const k of Object.keys(state.hidden)) {
        if (k !== key) next[k] = state.hidden[k];
      }
      return { hidden: next };
    });
  },

  undo: () => {
    const { undoStack } = get();
    const previous = undoStack[undoStack.length - 1];
    if (previous === undefined) return;
    set((state) => ({
      ...previous,
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [...state.redoStack, snapshotOf(state)],
    }));
  },

  redo: () => {
    const { redoStack } = get();
    const next = redoStack[redoStack.length - 1];
    if (next === undefined) return;
    set((state) => ({
      ...next,
      redoStack: state.redoStack.slice(0, -1),
      undoStack: [...state.undoStack, snapshotOf(state)],
    }));
  },

  canUndo: () => get().undoStack.length > 0,
  canRedo: () => get().redoStack.length > 0,

  clear: () =>
    set({
      layouts: {},
      hidden: {},
      // P3-022: a cleared view is a fresh context — its history dies with it.
      undoStack: [],
      redoStack: [],
    }),
}));
