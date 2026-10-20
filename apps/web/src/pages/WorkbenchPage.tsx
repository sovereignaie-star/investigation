import * as React from "react";
import { extract } from "@ir/core/identifiers";
import type { Graph as ProjectionGraph, GraphNode } from "@ir/ledger/projections";

import { FileUploader } from "./workbench/FileUploader";
import { IdentifierSelector } from "./workbench/IdentifierSelector";
import { InvestigationGraph } from "./workbench/InvestigationGraph";
import { EntityTableContainer } from "./workbench/EntityTable";
import { NodeDetailPanelContainer } from "./workbench/NodeDetailPanel";
import { RunPanel } from "./workbench/RunPanel";
import { SearchBar } from "./workbench/SearchBar";
import { OpenedCaseBanner, SavedInvestigations } from "./workbench/SavedInvestigations";
import type { OpenedCase } from "./workbench/savedInvestigationsModel";
import { toIdentifierRows, toggleSelection, type IdentifierRow } from "./workbench/model";

/**
 * P3-004 (UC-02): the workbench input flow — paste free text or read a text file, extract
 * identifiers with the real engine, and present the classified list with confidence. The
 * selection is view state only (D-033); expansion of the selected identifiers belongs to the
 * later engine-run tasks.
 *
 * P3-015: the saved-investigations surface — a case is opened from the server (nothing is
 * persisted in the browser, D-033), and while a case is open the graph/table/detail views
 * render THE CASE'S OWN projection snapshot. New text extraction replaces the opened view
 * (the extracted-rows path stays the workbench's own scratch graph), and closing the banner
 * returns to it.
 */
export function WorkbenchPage({
  initialText = "",
  initialOpenedCase = null,
}: {
  initialText?: string;
  initialOpenedCase?: OpenedCase | null;
}) {
  const [rows, setRows] = React.useState(() => toIdentifierRows(extract(initialText)));
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(() => new Set());
  // P3-015: the opened saved case (its own projection snapshot) — view state only.
  const [openedCase, setOpenedCase] = React.useState<OpenedCase | null>(initialOpenedCase);

  // P3-005: the extracted identifiers become the graph's first nodes (view state only).
  // P3-015: while a saved case is open, the graph is the case's own snapshot instead.
  const graph = React.useMemo<ProjectionGraph>(() => {
    if (openedCase) return openedCase.graph;
    return {
      nodes: rows.map((row: IdentifierRow): GraphNode => ({
        id: row.id,
        type: row.typeId,
        canonicalKey: row.value,
        labels: { ar: row.typeLabelAr },
        props: {},
        aliases: [],
        attributes: [],
        observations: { positive: 0, negative: 0, error: 0 },
        evidenceIds: [],
      })),
      edges: [],
    };
  }, [rows, openedCase]);

  const handleText = React.useCallback((text: string) => {
    setRows(toIdentifierRows(extract(text)));
    setSelected(new Set());
    setOpenedCase(null); // new input replaces the opened view — one graph source at a time
  }, []);

  return (
    <div data-testid="workbench-page" className="flex flex-col gap-6 p-4 md:p-6">
      <h1 className="text-xl font-semibold">محطة العمل</h1>
      {/* P3-015: re-open a saved case from the server — «فتح قضية بعد إعادة التشغيل». */}
      <SavedInvestigations onOpen={setOpenedCase} activeCaseId={openedCase?.id ?? null} />
      {openedCase && <OpenedCaseBanner opened={openedCase} onClose={() => setOpenedCase(null)} />}
      <SearchBar onText={handleText} />
      <FileUploader onText={handleText} />
      <IdentifierSelector rows={rows} selected={selected} onToggle={(id) => setSelected((current) => toggleSelection(current, id))} />
      {/* P3-005: the extracted identifiers render as graph nodes (the run wiring adds edges). */}
      {/* P3-008: the detail panel sits beside the graph; clicking a node opens it. */}
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="h-[400px] rounded-md border border-border">
          <InvestigationGraph graph={graph} />
        </div>
        <NodeDetailPanelContainer graph={graph} />
      </div>
      {/* P3-009: the entities of the same projection in a virtualized table
          (default sort + filter; 100,000 rows render only the visible window). */}
      <EntityTableContainer nodes={graph.nodes} />
      {/* P3-011: the run panel — submit a run, watch its phases live (SSE), cancel it. */}
      <RunPanel />
    </div>
  );
}
