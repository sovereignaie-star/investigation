import { beforeEach, describe, expect, it } from "vitest";

import { useSelection } from "./selectionStore";

/**
 * P3-008: the panel's state is presentation-only selection (which node is being
 * inspected, which evidence is being examined). D-033: nothing here is persisted
 * to browser storage — view state only.
 */

describe("selectionStore (P3-008)", () => {
  beforeEach(() => {
    useSelection.getState().clear();
  });

  it("selects a node and clears it", () => {
    useSelection.getState().selectNode("n1");
    expect(useSelection.getState().selectedNodeId).toBe("n1");
    useSelection.getState().clear();
    expect(useSelection.getState().selectedNodeId).toBeNull();
    expect(useSelection.getState().selectedEvidenceId).toBeNull();
  });

  it("selecting another node clears the evidence selection", () => {
    useSelection.getState().selectEvidence("ev-1");
    useSelection.getState().selectNode("n2");
    expect(useSelection.getState().selectedEvidenceId).toBeNull();
  });

  it("selects an evidence record under the current node", () => {
    useSelection.getState().selectNode("n1");
    useSelection.getState().selectEvidence("ev-1");
    expect(useSelection.getState().selectedEvidenceId).toBe("ev-1");
    useSelection.getState().selectEvidence(null);
    expect(useSelection.getState().selectedEvidenceId).toBeNull();
  });
});
