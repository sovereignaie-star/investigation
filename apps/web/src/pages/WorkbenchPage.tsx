import { t } from "@ir/i18n";
import * as React from "react";
import { toast } from "sonner";
import { extract } from "@ir/core/identifiers";
import { SonnerToaster } from "@ir/ui";
import { getCaseProjection } from "@workspace/api-client-react";
import type { Graph as ProjectionGraph, GraphNode } from "@ir/ledger/projections";

import { CommandPalette } from "../commands/CommandPalette";
import { NodeContextMenu, type MenuTarget } from "../commands/NodeContextMenu";
import { NoteDialog } from "../commands/NoteDialog";
import { runCommand, type CommandContext } from "../commands/registry";
import { isTextEntryTarget, matchShortcut } from "../commands/shortcuts";
import { FileUploader } from "./workbench/FileUploader";
import { IdentifierSelector } from "./workbench/IdentifierSelector";
import { InvestigationGraph, type SigmaHandle } from "./workbench/InvestigationGraph";
import { EntityTableContainer } from "./workbench/EntityTable";
import { NodeDetailPanelContainer } from "./workbench/NodeDetailPanel";
import { RunPanel } from "./workbench/RunPanel";
import { SearchBar } from "./workbench/SearchBar";
import { OpenedCaseBanner, SavedInvestigations } from "./workbench/SavedInvestigations";
import { parseProjection, type OpenedCase } from "./workbench/savedInvestigationsModel";
import { toIdentifierRows, toggleSelection, type IdentifierRow } from "./workbench/model";
import { positionsKey } from "./workbench/layout";
import { useSelection } from "../store/selectionStore";
import { useViewState } from "../store/viewStateStore";
import { useRunBridge } from "../store/runStore";

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
 *
 * P3-021: the command surfaces — the palette (Ctrl/Cmd+K), the documented keyboard
 * shortcuts, and the node context menu (right-click / Shift+F10) all execute the SAME
 * registry. «إزالة من العرض» is view state (the served projection is never rewritten);
 * notes are durable case data saved through the real notes API; «إعادة الجلب» re-reads
 * the opened case's own projection from the server (see docs/shortcuts.md for the boundary).
 */
export function WorkbenchPage({
  initialText = "",
  initialOpenedCase = null,
}: {
  initialText?: string;
  initialOpenedCase?: OpenedCase | null;
}) {
  const [rows, setRows] = React.useState(() => toIdentifierRows(extract(initialText)));
  // P3-022: the view's edit history, mirrored for observability (E2E asserts the
  // undo/redo availability honestly — the same pattern as the graph camera).
  const canUndo = useViewState((s) => s.undoStack.length > 0);
  const canRedo = useViewState((s) => s.redoStack.length > 0);
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(() => new Set());
  // P3-015: the opened saved case (its own projection snapshot) — view state only.
  const [openedCase, setOpenedCase] = React.useState<OpenedCase | null>(initialOpenedCase);
  // P3-021: the command surfaces' state.
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [menuTarget, setMenuTarget] = React.useState<MenuTarget | null>(null);
  const [noteTarget, setNoteTarget] = React.useState<string | null>(null);
  const [sigma, setSigma] = React.useState<SigmaHandle | null>(null);
  // The node sigma last reported under the right-click cursor (cleared when the
  // right-click lands on the empty stage — the menu never targets a stale node).
  const rightClickNodeRef = React.useRef<string | null>(null);
  // P3-021: the right-click handlers are STABLE (useCallback, ref-only) — the graph's
  // mount effect depends on them, so an inline identity would tear sigma down and
  // rebuild it on EVERY parent render (the focus command would race a null handle).
  const handleRightClickNode = React.useCallback((nodeId: string) => {
    rightClickNodeRef.current = nodeId;
  }, []);
  const handleRightClickStage = React.useCallback(() => {
    rightClickNodeRef.current = null;
  }, []);

  // P3-005: the extracted identifiers become the graph's first nodes (view state only).
  // P3-015: while a saved case is open, the graph is the case's own snapshot instead.
  const rawGraph = React.useMemo<ProjectionGraph>(() => {
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

  // P3-021: the graph identity under which the view records removals/layouts.
  const graphKey = React.useCallback(() => positionsKey(rawGraph), [rawGraph]);

  // P3-021: «إزالة من العرض» — the rendered graph is the raw graph minus the hidden
  // set. View state only: the opened case's own snapshot object is never touched.
  const hidden = useViewState((s) => s.hidden);
  const hiddenIds = React.useMemo(() => {
    const set = new Set(hidden[graphKey()] ?? []);
    return set.size === 0 ? null : set;
  }, [hidden, graphKey]);
  const graph = React.useMemo<ProjectionGraph>(() => {
    if (hiddenIds === null) return rawGraph;
    return {
      nodes: rawGraph.nodes.filter((n) => !hiddenIds.has(n.id)),
      edges: rawGraph.edges.filter((e) => !hiddenIds.has(e.source) && !hiddenIds.has(e.target)),
    };
  }, [rawGraph, hiddenIds]);

  const handleText = React.useCallback((text: string) => {
    setRows(toIdentifierRows(extract(text)));
    setSelected(new Set());
    setOpenedCase(null); // new input replaces the opened view — one graph source at a time
  }, []);

  /** P3-021: re-reads the opened case's own projection — the data path of «إعادة الجلب». */
  const refreshCase = React.useCallback(async (): Promise<boolean> => {
    if (openedCase === null) return false;
    try {
      const body = await getCaseProjection(openedCase.id);
      const snapshot = parseProjection(body as unknown);
      if (!snapshot) return false;
      setOpenedCase((current) => (current === null ? current : { ...current, ...snapshot }));
      return true;
    } catch {
      return false;
    }
  }, [openedCase]);

  const commandContext = React.useMemo<CommandContext>(
    () => ({
      graph: rawGraph,
      openedCase,
      sigma,
      graphKey,
      toast: (message) => toast(message),
      navigate: (hash) => {
        window.location.hash = hash;
      },
      refreshCase,
      openNoteDialog: (nodeId) => setNoteTarget(nodeId),
      focusRunInput: () => {
        document.querySelector<HTMLInputElement>('[data-testid="run-input-input"]')?.focus();
      },
      cancelLiveRun: () => useRunBridge.getState().cancel?.(),
      hasLiveRun: () => useRunBridge.getState().liveRunId !== null,
    }),
    [rawGraph, openedCase, sigma, graphKey, refreshCase],
  );

  // P3-021: the keyboard layer — one matcher, one registry (docs/shortcuts.md). Text
  // surfaces swallow shortcuts: Delete inside the note dialog is text, not a command.
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const action = matchShortcut(event);
      if (action === null) return;
      if (isTextEntryTarget(event.target)) return;
      if (action === "palette.toggle") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      } else if (action === "contextmenu.open") {
        const nodeId = useSelection.getState().selectedNodeId;
        if (nodeId === null) return;
        event.preventDefault();
        const row = document.querySelector(`[data-testid="entity-row"][data-node-id="${nodeId}"]`);
        const rect = row instanceof HTMLElement ? row.getBoundingClientRect() : null;
        setMenuTarget({
          nodeId,
          x: rect ? rect.left + 24 : window.innerWidth / 2,
          y: rect ? rect.top + rect.height / 2 : window.innerHeight / 2,
        });
      } else if (action === "node.removeView") {
        event.preventDefault();
        void runCommand("node.removeView", commandContext);
      } else if (action === "history.undo") {
        event.preventDefault();
        void runCommand("view.undo", commandContext);
      } else if (action === "history.redo") {
        event.preventDefault();
        void runCommand("view.redo", commandContext);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [commandContext]);

  return (
    <div data-testid="workbench-page" className="flex flex-col gap-6 p-4 md:p-6">
      <div
        data-testid="view-history"
        data-undo={canUndo ? "1" : "0"}
        data-redo={canRedo ? "1" : "0"}
        aria-hidden="true"
        className="hidden"
      />
      <h1 className="text-xl font-semibold">{t("nav.workbench")}</h1>
      {/* P3-015: re-open a saved case from the server — «فتح قضية بعد إعادة التشغيل». */}
      <SavedInvestigations onOpen={setOpenedCase} activeCaseId={openedCase?.id ?? null} />
      {openedCase && <OpenedCaseBanner opened={openedCase} onClose={() => setOpenedCase(null)} />}
      <SearchBar onText={handleText} />
      <FileUploader onText={handleText} />
      <IdentifierSelector rows={rows} selected={selected} onToggle={(id) => setSelected((current) => toggleSelection(current, id))} />
      {/* P3-005: the extracted identifiers render as graph nodes (the run wiring adds edges). */}
      {/* P3-008: the detail panel sits beside the graph; clicking a node opens it. */}
      <div
        className="h-[400px] rounded-md border border-border"
        // P3-021: right-click inside the graph opens the node menu at the pointer —
        // sigma's rightClickNode has already set the node under the cursor (the canvas
        // listener fires before this wrapper's, so the target is never stale).
        onContextMenu={(event) => {
          const nodeId = rightClickNodeRef.current;
          if (nodeId === null) return;
          event.preventDefault();
          setMenuTarget({ nodeId, x: event.clientX, y: event.clientY });
        }}
      >
        <InvestigationGraph
          graph={graph}
          onInstance={setSigma}
          onRightClickNode={handleRightClickNode}
          onRightClickStage={handleRightClickStage}
        />
      </div>
      <NodeDetailPanelContainer graph={graph} notes={openedCase?.notes ?? []} />
      {/* P3-009: the entities of the same projection in a virtualized table
          (default sort + filter; 100,000 rows render only the visible window). */}
      <EntityTableContainer
        nodes={graph.nodes}
        onContextMenuRow={(nodeId, event) => {
          event.preventDefault();
          setMenuTarget({ nodeId, x: event.clientX, y: event.clientY });
        }}
      />
      {/* P3-011: the run panel — submit a run, watch its phases live (SSE), cancel it. */}
      <RunPanel />
      {/* P3-021: the command surfaces — palette, node context menu, note dialog. */}
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} ctx={commandContext} />
      <NodeContextMenu target={menuTarget} onClose={() => setMenuTarget(null)} ctx={commandContext} />
      <NoteDialog
        nodeId={noteTarget}
        caseId={openedCase?.id ?? null}
        onClose={() => setNoteTarget(null)}
        onSaved={async () => {
          const ok = await refreshCase();
          toast(ok ? t("commands.note.saved") : t("commands.note.saveFailed"));
        }}
      />
      <SonnerToaster position="bottom-left" richColors />
    </div>
  );
}
