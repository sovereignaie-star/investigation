// @vitest-environment jsdom
/**
 * P3-021 red-first: the unified command registry — the single source every surface
 * (palette, keyboard shortcuts, node context menu) executes through. These tests
 * were written BEFORE the registry existed; on the pre-feature tree they fail to
 * import, which is the defect (no command surface at all).
 *
 * The registry's contract:
 * - every command has a unique id, an i18n label key that resolves, a group, and a handler;
 * - the ROADMAP acceptance's six context-menu actions exist as commands targeting a node
 *   (تفاصيل، إعادة جلب، نسخ، ملاحظة، حذف عقدة/فرع، تركيز) plus the view/case/run/navigation
 *   actions enumerated from the workbench's actual surfaces;
 * - availability is a predicate (e.g. a note needs an opened case — notes are case data,
 *   not browser state; focus needs the graph canvas; cancel needs a live run);
 * - commands never read stale selection: a node-targeted command receives its target
 *   explicitly (the node the menu was opened ON, or the selected node for shortcuts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COMMANDS, commandById, runCommand, type CommandContext } from "./registry";
import { t } from "@ir/i18n";
import { useSelection } from "../store/selectionStore";
import { useViewState } from "../store/viewStateStore";

const NODE_A = "01AAAAAAAAAAAAAAAAAAAAAAAA";
const NODE_B = "01BBBBBBBBBBBBBBBBBBBBBBBB";

function node(id: string, key: string) {
  return {
    id,
    type: "domain",
    canonicalKey: key,
    labels: { ar: key },
    props: {},
    aliases: [],
    attributes: [],
    observations: { positive: 0, negative: 0, error: 0 },
    evidenceIds: [],
  };
}

const GRAPH = {
  nodes: [node(NODE_A, "domain:a.example.com"), node(NODE_B, "domain:b.example.com")],
  edges: [{ id: "e1", source: NODE_A, target: NODE_B, predicate: "resolves_to", labels: { ar: "resolves_to" }, evidenceIds: [] }],
};

beforeEach(() => {
  useSelection.getState().clear();
  useViewState.getState().clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("P3-021 command registry — structure", () => {
  it("every command has a unique id, a resolvable label, a group, and a handler", () => {
    expect(COMMANDS.length).toBeGreaterThan(0);
    const ids = new Set<string>();
    for (const c of COMMANDS) {
      expect(ids.has(c.id)).toBe(false);
      ids.add(c.id);
      expect(typeof c.run).toBe("function");
      expect(t(c.labelKey)).not.toBe(c.labelKey); // the key resolves in the active locale
      expect(t(c.groupKey)).not.toBe(c.groupKey);
    }
  });

  it("the acceptance's node actions exist: details, refetch, copy, note, remove node, remove branch, focus", () => {
    for (const id of ["node.details", "node.refetch", "node.copyKey", "node.note", "node.removeView", "node.removeBranch", "node.focus"]) {
      expect(commandById(id)).toBeDefined();
    }
  });

  it("the workbench's other main actions exist: show-all, case refresh, run submit focus, run cancel, navigation", () => {
    for (const id of ["view.showAll", "case.refresh", "run.new", "run.cancel", "nav.cases", "nav.workbench", "nav.evidence"]) {
      expect(commandById(id)).toBeDefined();
    }
  });

  it("a node-targeted command refuses to run without a target — never silently falls back to a stale selection", () => {
    const details = commandById("node.details");
    expect(details?.requiresNode ?? true).toBe(true);
    // No selection, no explicit target: the command is unavailable, not guessed.
    const ctx = makeContext();
    expect(details?.available(ctx, null)).toBe(false);
    expect(() => runCommand("node.details", ctx, null)).not.toThrow(); // a no-op, not a wrong action
    expect(useSelection.getState().selectedNodeId).toBeNull();
  });
});

describe("P3-021 command registry — behavior", () => {
  it("node.details selects the TARGET node (the panel opens with the selection), not a previously selected one", () => {
    useSelection.getState().selectNode(NODE_A);
    const ctx = makeContext();
    runCommand("node.details", ctx, NODE_B);
    expect(useSelection.getState().selectedNodeId).toBe(NODE_B);
  });

  it("node.copyKey writes the target's canonical key to the clipboard and reports success", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const toasts: string[] = [];
    const ctx = makeContext({ toast: (m) => toasts.push(m) });
    await runCommand("node.copyKey", ctx, NODE_A);
    expect(writeText).toHaveBeenCalledWith("domain:a.example.com");
    expect(toasts.length).toBe(1); // visible feedback — a copy without feedback is indistinguishable from a dead button
  });

  it("node.focus moves the camera to the target node through the sigma handle", async () => {
    const focusNode = vi.fn();
    const ctx = makeContext({
      sigma: {
        focusNode,
        getCamera: () => ({ setState: () => undefined, x: 0, y: 0, ratio: 1 }),
        kill: () => undefined,
        refresh: () => undefined,
      },
    });
    await runCommand("node.focus", ctx, NODE_B);
    expect(focusNode).toHaveBeenCalledWith(NODE_B);
  });

  it("node.focus is unavailable without a canvas (honesty over a dead button)", () => {
    const ctx = makeContext({ sigma: null });
    expect(commandById("node.focus")?.available(ctx, NODE_A)).toBe(false);
  });

  it("node.removeView hides the target from the view and NEVER touches the case data", async () => {
    const ctx = makeContext();
    const before = JSON.stringify(ctx.graph);
    await runCommand("node.removeView", ctx, NODE_A);
    // The raw graph object is untouched — removal is view state only (reversible).
    expect(JSON.stringify(ctx.graph)).toBe(before);
    const hidden = useViewState.getState().getHidden("test-key");
    expect(hidden).toContain(NODE_A);
    // And the palette command brings everything back.
    await runCommand("view.showAll", ctx);
    expect(useViewState.getState().getHidden("test-key")).toHaveLength(0);
  });

  it("node.note is unavailable without an opened case — a note is durable case data, not browser state", () => {
    const withCase = makeContext({ openedCase: { id: "c1", title: "قضية", seq: 1, sha256: "a".repeat(64), graph: GRAPH, notes: [] } });
    const withoutCase = makeContext();
    const note = commandById("node.note");
    expect(note?.available(withCase, NODE_A)).toBe(true);
    expect(note?.available(withoutCase, NODE_A)).toBe(false);
  });

  it("run.cancel is unavailable without a live run; run.new focuses the run input", async () => {
    const focusRunInput = vi.fn();
    const idle = makeContext({ focusRunInput });
    expect(commandById("run.cancel")?.available(idle)).toBe(false);
    const live = makeContext({ focusRunInput, hasLiveRun: () => true });
    expect(commandById("run.cancel")?.available(live)).toBe(true);
    await runCommand("run.new", live);
    expect(focusRunInput).toHaveBeenCalledTimes(1);
  });

  it("nav.cases navigates by hash", async () => {
    const navigate = vi.fn();
    const ctx = makeContext({ navigate });
    await runCommand("nav.cases", ctx);
    expect(navigate).toHaveBeenCalledWith("#/cases");
  });
});

/** Builds a context with injectable fakes; defaults describe an idle workbench. */
function makeContext(overrides: Partial<CommandContext> = {}): CommandContext {
  const toasts: string[] = [];
  return {
    graph: GRAPH,
    openedCase: null,
    sigma: null,
    graphKey: () => "test-key",
    toast: (m) => toasts.push(m),
    navigate: () => undefined,
    refreshCase: async () => false,
    openNoteDialog: () => undefined,
    focusRunInput: () => undefined,
    cancelLiveRun: () => undefined,
    hasLiveRun: () => false,
    ...overrides,
  };
}
