import { create } from "zustand";

/**
 * P3-008: presentation-only selection for the workbench — which graph node is
 * being inspected in the detail panel, and which evidence record is under
 * examination. View state only: nothing here is persisted to browser storage
 * (D-033), and selecting a different node resets the evidence examination.
 */

interface Selection {
  /** The node whose detail panel is open, or null when nothing is selected. */
  selectedNodeId: string | null;
  /** The evidence record under examination within the selected node, or null. */
  selectedEvidenceId: string | null;
  selectNode: (nodeId: string | null) => void;
  selectEvidence: (evidenceId: string | null) => void;
  clear: () => void;
}

export const useSelection = create<Selection>((set) => ({
  selectedNodeId: null,
  selectedEvidenceId: null,
  selectNode: (nodeId) => set({ selectedNodeId: nodeId, selectedEvidenceId: null }),
  selectEvidence: (evidenceId) => set({ selectedEvidenceId: evidenceId }),
  clear: () => set({ selectedNodeId: null, selectedEvidenceId: null }),
}));
