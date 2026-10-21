import { t, type MessageKey } from "@ir/i18n";
import type { Graph as ProjectionGraph } from "@ir/ledger/projections";

import type { OpenedCase } from "../pages/workbench/savedInvestigationsModel";
import type { SigmaHandle } from "../pages/workbench/InvestigationGraph";
import { useSelection } from "../store/selectionStore";
import { useViewState } from "../store/viewStateStore";
import { branchClosure } from "./branchClosure";

/**
 * P3-021 — the unified command registry: ONE definition per action (id, i18n keys,
 * shortcut, availability, handler), consumed by every surface — the palette
 * (Ctrl/Cmd+K), the keyboard shortcuts, and the node context menu. No surface owns
 * an action of its own; a menu entry is a label on the same handler the palette and
 * the keyboard run.
 *
 * Honesty rules baked into the design:
 * - a node-targeted command receives its target EXPLICITLY (the node the menu was
 *   opened ON, or the selected node for keyboard shortcuts) — a command never
 *   guesses at a stale selection, and refuses to run without a target;
 * - availability is a predicate, so a surface renders an honest disabled state
 *   instead of a dead button (a note needs an opened case — notes are durable case
 *   data; focus needs the graph canvas; cancel needs a live run);
 * - «إزالة العقدة من العرض» is VIEW state only (D-033): it never rewrites the case
 *   projection — the same case re-opens intact — and «إظهار كل العقد» reverses it.
 */

/** What a command needs to act. Constructed once per workbench mount (see
 *  useWorkbenchCommands) and passed to every surface. */
export interface CommandContext {
  /** The raw graph (the opened case's own snapshot, or the extracted scratch graph). */
  graph: ProjectionGraph;
  openedCase: OpenedCase | null;
  sigma: SigmaHandle | null;
  /** The view-state key the current graph hides/removals are recorded under. */
  graphKey: () => string;
  toast: (message: string) => void;
  navigate: (hash: string) => void;
  /** Re-reads the opened case's own projection from the server; false when no case is open. */
  refreshCase: () => Promise<boolean>;
  openNoteDialog: (nodeId: string) => void;
  /** P4-005: opens the merge-review panel (explicit request — the panel IS the request). */
  openMergeReview: () => void;
  focusRunInput: () => void;
  cancelLiveRun: () => void;
  hasLiveRun: () => boolean;
}

/** The node a command acts on — the menu's target or the selected node. */
export type CommandTarget = string | null;

export interface WorkbenchCommand {
  readonly id: string;
  readonly labelKey: MessageKey;
  readonly groupKey: MessageKey;
  /** Displayed shortcut (docs/shortcuts.md is the documented surface; this mirrors it). */
  readonly shortcut?: string;
  /** Node-targeted commands require an explicit target (never a stale selection). */
  readonly requiresNode?: boolean;
  readonly available: (ctx: CommandContext, target: CommandTarget) => boolean;
  readonly run: (ctx: CommandContext, target: CommandTarget) => void | Promise<void>;
}

/** The node-targeted commands fall back to the SELECTED node for keyboard/palette use. */
const selectedNode = (ctx: CommandContext, target: CommandTarget): string | null => target ?? useSelection.getState().selectedNodeId;

const nodeInGraph = (ctx: CommandContext, target: CommandTarget): string | null => {
  const id = selectedNode(ctx, target);
  return id !== null && ctx.graph.nodes.some((n) => n.id === id) ? id : null;
};

const removeNodesFromView = (ctx: CommandContext, ids: readonly string[]): void => {
  if (ids.length === 0) return;
  const key = ctx.graphKey();
  useViewState.getState().hideNodes(key, ids);
  const selection = useSelection.getState();
  if (selection.selectedNodeId !== null && ids.includes(selection.selectedNodeId)) selection.clear();
  ctx.toast(t("commands.removedFromView", { count: ids.length }));
};

/** Writes text to the clipboard with a legacy fallback for non-secure contexts. */
async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // falls through to the legacy path
    }
  }
  try {
    const helper = document.createElement("textarea");
    helper.value = text;
    helper.setAttribute("readonly", "");
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    document.body.appendChild(helper);
    helper.select();
    const ok = document.execCommand("copy");
    helper.remove();
    return ok;
  } catch {
    return false;
  }
}

export const COMMANDS: readonly WorkbenchCommand[] = [
  {
    id: "node.details",
    labelKey: "commands.node.details",
    groupKey: "commands.group.node",
    requiresNode: true,
    available: (ctx, target) => nodeInGraph(ctx, target) !== null,
    run: (ctx, target) => {
      const id = nodeInGraph(ctx, target);
      if (id === null) return;
      useSelection.getState().selectNode(id);
    },
  },
  {
    id: "node.copyKey",
    labelKey: "commands.node.copyKey",
    groupKey: "commands.group.node",
    requiresNode: true,
    available: (ctx, target) => nodeInGraph(ctx, target) !== null,
    run: async (ctx, target) => {
      const id = nodeInGraph(ctx, target);
      if (id === null) return;
      const node = ctx.graph.nodes.find((n) => n.id === id);
      if (!node) return;
      const ok = await copyText(node.canonicalKey);
      ctx.toast(ok ? t("commands.copied") : t("commands.copyFailed"));
    },
  },
  {
    id: "node.focus",
    labelKey: "commands.node.focus",
    groupKey: "commands.group.node",
    requiresNode: true,
    available: (ctx, target) => ctx.sigma !== null && nodeInGraph(ctx, target) !== null,
    run: (ctx, target) => {
      const id = nodeInGraph(ctx, target);
      if (id === null) return;
      const focused = ctx.sigma?.focusNode(id) ?? false;
      if (!focused) ctx.toast(t("commands.focusUnavailable"));
    },
  },
  {
    // «مراجعة الدمج» (P4-005, UC-11): the merge-review panel — suggestions on
    // EXPLICIT request only, a human-accepted merge, and a revert that restores
    // the case's semantic state. Needs an opened case (merges are durable case
    // data, like notes). No node target — the panel reviews the whole case.
    id: "case.mergeReview",
    labelKey: "commands.mergeReview.title",
    groupKey: "commands.group.node",
    available: (ctx) => ctx.openedCase !== null,
    run: (ctx) => ctx.openMergeReview(),
  },
  {
    id: "node.note",
    labelKey: "commands.node.note",
    groupKey: "commands.group.node",
    requiresNode: true,
    available: (ctx, target) => ctx.openedCase !== null && nodeInGraph(ctx, target) !== null,
    run: (ctx, target) => {
      const id = nodeInGraph(ctx, target);
      if (id === null || ctx.openedCase === null) return;
      ctx.openNoteDialog(id);
    },
  },
  {
    // «إعادة الجلب» — the menu item the acceptance names. Its handler re-reads the
    // opened case's own projection from the server (the same data path that opened
    // the case): the run that produced the node may have been recorded meanwhile, and
    // the node's data refreshes from the case's own snapshot. It does NOT invent a
    // server-side network fetch — the server engine is fail-closed by design (P2-019);
    // see docs/DECLARED_LIMITS.md and docs/shortcuts.md for the boundary.
    id: "node.refetch",
    labelKey: "commands.node.refetch",
    groupKey: "commands.group.node",
    requiresNode: true,
    available: (ctx, target) => ctx.openedCase !== null && nodeInGraph(ctx, target) !== null,
    run: async (ctx, target) => {
      const id = nodeInGraph(ctx, target);
      if (id === null || ctx.openedCase === null) return;
      const ok = await ctx.refreshCase();
      ctx.toast(ok ? t("commands.refetched") : t("commands.refetchFailed"));
    },
  },
  {
    // «إزالة العقدة من العرض» — reversible view state, never a case rewrite.
    id: "node.removeView",
    labelKey: "commands.node.removeView",
    groupKey: "commands.group.node",
    shortcut: "Delete",
    requiresNode: true,
    available: (ctx, target) => nodeInGraph(ctx, target) !== null,
    run: (ctx, target) => {
      const id = nodeInGraph(ctx, target);
      if (id === null) return;
      removeNodesFromView(ctx, [id]);
    },
  },
  {
    // «إزالة العقدة والفرع من العرض» — the branch is the target's descendant closure
    // over outgoing edges (cycle-safe): the node plus every node reachable from it.
    // View state only, same as the single-node removal.
    id: "node.removeBranch",
    labelKey: "commands.node.removeBranch",
    groupKey: "commands.group.node",
    requiresNode: true,
    available: (ctx, target) => nodeInGraph(ctx, target) !== null,
    run: (ctx, target) => {
      const id = nodeInGraph(ctx, target);
      if (id === null) return;
      removeNodesFromView(ctx, branchClosure(ctx.graph, id));
    },
  },
  {
    id: "view.showAll",
    labelKey: "commands.view.showAll",
    groupKey: "commands.group.view",
    available: (ctx) => useViewState.getState().getHidden(ctx.graphKey()).length > 0,
    run: (ctx) => {
      useViewState.getState().showAll(ctx.graphKey());
      ctx.toast(t("commands.allShown"));
    },
  },
  {
    // P3-022: undo/redo the last VIEW edit (a move, a hide, a show-all) — the history
    // is view state only; case data (notes, projections, the ledger) is never in it:
    // a case deletion is an opposite ledger event (D1), never a view undo.
    id: "view.undo",
    labelKey: "commands.view.undo",
    groupKey: "commands.group.view",
    shortcut: "Ctrl+Z",
    available: () => useViewState.getState().canUndo(),
    run: (ctx) => {
      useViewState.getState().undo();
      ctx.toast(t("commands.undone"));
    },
  },
  {
    id: "view.redo",
    labelKey: "commands.view.redo",
    groupKey: "commands.group.view",
    shortcut: "Ctrl+Shift+Z",
    available: () => useViewState.getState().canRedo(),
    run: (ctx) => {
      useViewState.getState().redo();
      ctx.toast(t("commands.redone"));
    },
  },
  {
    // «تحديث بيانات القضية» — the independent refresh command (the same data path,
    // named for what it does: re-reads the case's own projection snapshot).
    id: "case.refresh",
    labelKey: "commands.case.refresh",
    groupKey: "commands.group.case",
    available: (ctx) => ctx.openedCase !== null,
    run: async (ctx) => {
      const ok = await ctx.refreshCase();
      ctx.toast(ok ? t("commands.caseRefreshed") : t("commands.refetchFailed"));
    },
  },
  {
    id: "run.new",
    labelKey: "commands.run.new",
    groupKey: "commands.group.run",
    available: () => true,
    run: (ctx) => ctx.focusRunInput(),
  },
  {
    id: "run.cancel",
    labelKey: "commands.run.cancel",
    groupKey: "commands.group.run",
    available: (ctx) => ctx.hasLiveRun(),
    run: (ctx) => ctx.cancelLiveRun(),
  },
  {
    id: "nav.cases",
    labelKey: "commands.nav.cases",
    groupKey: "commands.group.nav",
    available: () => true,
    run: (ctx) => ctx.navigate("#/cases"),
  },
  {
    id: "nav.workbench",
    labelKey: "commands.nav.workbench",
    groupKey: "commands.group.nav",
    available: () => true,
    run: (ctx) => ctx.navigate("#/workbench"),
  },
  {
    id: "nav.evidence",
    labelKey: "commands.nav.evidence",
    groupKey: "commands.group.nav",
    available: () => true,
    run: (ctx) => ctx.navigate("#/evidence"),
  },
];

const BY_ID: ReadonlyMap<string, WorkbenchCommand> = new Map(COMMANDS.map((c) => [c.id, c]));

export function commandById(id: string): WorkbenchCommand | undefined {
  return BY_ID.get(id);
}

/** Executes a command with an explicit target. Unavailable or targetless commands
 *  are no-ops — a surface must never turn them into a wrong action. */
export async function runCommand(id: string, ctx: CommandContext, target: CommandTarget = null): Promise<void> {
  const command = commandById(id);
  if (!command) return;
  if (!command.available(ctx, target)) return;
  await command.run(ctx, target);
}

/** The context-menu commands in the acceptance's order (تفاصيل، إعادة جلب، نسخ،
 *  ملاحظة، حذف عقدة/فرع، تركيز). */
export const CONTEXT_MENU_COMMAND_IDS: readonly string[] = [
  "node.details",
  "node.refetch",
  "node.copyKey",
  "node.note",
  "node.removeView",
  "node.removeBranch",
  "node.focus",
];
