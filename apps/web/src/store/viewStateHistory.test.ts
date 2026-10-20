// @vitest-environment jsdom
/**
 * P3-022 red-first: undo/redo of the view's EDIT operations (ROADMAP 3.2 P3-022 —
 * «التراجع يعكس عمليات التحرير (تحريك، إخفاء، تجميع، حذف من العرض)، أما الحذف من
 * القضية فحدث معاكس في السجل لا محو» — D1). These tests were written BEFORE the
 * history existed; on the pre-feature tree `undo` does not exist and every test
 * below fails — the defect.
 *
 * The contract:
 * - the history is over the VIEW state only (layouts + hidden): an undo restores
 *   the exact previous snapshot of both. It NEVER touches the case's projection or
 *   ledger — a note (case data) is NOT undoable from the view's history; case
 *   deletions are opposite ledger events (D1), never erasures and never view state;
 * - hide (single node / branch) and show-all are recorded edits;
 * - a layout save is recorded ONLY when a previous layout existed for that graph
 *   (the first computed layout of a freshly opened graph is the BASELINE, not an
 *   edit — undoing it would restore a state the user never saw);
 * - a new edit clears the redo branch (the standard linear-undo model);
 * - the history resets when the view state clears (case switch context);
 * - the history is bounded (a drag-happy session cannot grow it without limit).
 */
import { beforeEach, describe, expect, it } from "vitest";

import { useViewState } from "./viewStateStore";

const KEY = "case:01AAAAAAAAAAAAAAAAAAAAAAAA:seed-1";
const KEY2 = "case:01BBBBBBBBBBBBBBBBBBBBBBBB:seed-1";

beforeEach(() => {
  useViewState.getState().clear();
});

describe("P3-022 undo/redo — hide and show-all", () => {
  it("undo restores a node removed from the view; redo removes it again", () => {
    useViewState.getState().hideNodes(KEY, ["a"]);
    expect(useViewState.getState().getHidden(KEY)).toEqual(["a"]);

    useViewState.getState().undo();
    expect(useViewState.getState().getHidden(KEY)).toEqual([]);

    useViewState.getState().redo();
    expect(useViewState.getState().getHidden(KEY)).toEqual(["a"]);
  });

  it("two removals undo in reverse order (LIFO)", () => {
    useViewState.getState().hideNodes(KEY, ["a"]);
    useViewState.getState().hideNodes(KEY, ["b"]);
    expect(useViewState.getState().getHidden(KEY)).toEqual(["a", "b"]);

    useViewState.getState().undo();
    expect(useViewState.getState().getHidden(KEY)).toEqual(["a"]);

    useViewState.getState().undo();
    expect(useViewState.getState().getHidden(KEY)).toEqual([]);
  });

  it("show-all is itself an undoable edit: undoing it restores the hidden set", () => {
    useViewState.getState().hideNodes(KEY, ["a", "b"]);
    useViewState.getState().showAll(KEY);
    expect(useViewState.getState().getHidden(KEY)).toEqual([]);

    useViewState.getState().undo();
    expect(useViewState.getState().getHidden(KEY)).toEqual(["a", "b"]);

    useViewState.getState().redo();
    expect(useViewState.getState().getHidden(KEY)).toEqual([]);
  });

  it("an empty history: undo/redo are honest no-ops, canUndo/canRedo are false", () => {
    expect(useViewState.getState().canUndo()).toBe(false);
    expect(useViewState.getState().canRedo()).toBe(false);
    useViewState.getState().undo();
    useViewState.getState().redo();
    expect(useViewState.getState().canUndo()).toBe(false);
    expect(useViewState.getState().canRedo()).toBe(false);
  });
});

describe("P3-022 undo/redo — the linear-undo model", () => {
  it("a new edit after an undo clears the redo branch (no time travel)", () => {
    useViewState.getState().hideNodes(KEY, ["a"]);
    useViewState.getState().undo();
    expect(useViewState.getState().canRedo()).toBe(true);

    useViewState.getState().hideNodes(KEY, ["b"]);
    expect(useViewState.getState().canRedo()).toBe(false);
    useViewState.getState().redo();
    expect(useViewState.getState().getHidden(KEY)).toEqual(["b"]);
  });

  it("clear() resets the history with the state (a fresh case context has no past)", () => {
    useViewState.getState().hideNodes(KEY, ["a"]);
    useViewState.getState().clear();
    expect(useViewState.getState().canUndo()).toBe(false);
    useViewState.getState().undo();
    expect(useViewState.getState().getHidden(KEY)).toEqual([]);
  });

  it("the history is bounded: the oldest edits fall off after 100 entries", () => {
    for (let i = 0; i < 105; i += 1) {
      useViewState.getState().hideNodes(KEY, [`n${i}`]);
    }
    let undos = 0;
    while (useViewState.getState().canUndo()) {
      useViewState.getState().undo();
      undos += 1;
    }
    expect(undos).toBe(100);
    // the five oldest removals are gone from the history — the view still holds
    // the 105 hidden nodes minus nothing (undo only restored 100 of them)
    expect(useViewState.getState().getHidden(KEY)).toHaveLength(5);
  });
});

describe("P3-022 undo/redo — layouts (تحريك)", () => {
  it("the FIRST layout of a graph is the baseline, not an edit (no undo entry)", () => {
    const first = new Map([["a", { x: 1, y: 1 }]]);
    useViewState.getState().saveLayout(KEY, first);
    expect(useViewState.getState().canUndo()).toBe(false);
  });

  it("a layout CHANGE (a real move) is recorded: undo restores the previous positions byte-for-byte", () => {
    const before = new Map([
      ["a", { x: 1, y: 1 }],
      ["b", { x: 2, y: 2 }],
    ]);
    useViewState.getState().saveLayout(KEY, before);
    const after = new Map([
      ["a", { x: 10, y: 10 }],
      ["b", { x: 20, y: 20 }],
    ]);
    useViewState.getState().saveLayout(KEY, after);
    expect(useViewState.getState().canUndo()).toBe(true);

    useViewState.getState().undo();
    expect(useViewState.getState().getLayout(KEY)).toEqual(before);
    useViewState.getState().redo();
    expect(useViewState.getState().getLayout(KEY)).toEqual(after);
  });

  it("undo restores the FULL view state: hidden nodes of other graphs come back with the layout", () => {
    useViewState.getState().hideNodes(KEY2, ["z"]);
    useViewState.getState().saveLayout(KEY, new Map([["a", { x: 1, y: 1 }]]));
    useViewState.getState().saveLayout(KEY, new Map([["a", { x: 9, y: 9 }]]));
    useViewState.getState().hideNodes(KEY, ["a"]);

    useViewState.getState().undo(); // the hide
    expect(useViewState.getState().getHidden(KEY)).toEqual([]);
    useViewState.getState().undo(); // the layout change
    expect(useViewState.getState().getLayout(KEY)).toEqual(new Map([["a", { x: 1, y: 1 }]]));
    expect(useViewState.getState().getHidden(KEY2)).toEqual(["z"]); // untouched by the undos
  });
});
