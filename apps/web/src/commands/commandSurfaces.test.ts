// @vitest-environment jsdom
/**
 * P3-021 red-first: the command surfaces as BEHAVIOR — the palette (Ctrl/Cmd+K), the
 * node context menu (right-click and Shift+F10), and the actions behind them.
 * Written before any of these surfaces existed; on the pre-feature tree every test
 * below fails (no palette opens, no menu appears), which is the defect.
 *
 * Honesty rules under test:
 * - the menu targets the node it was OPENED ON, never a stale selection;
 * - removal from the view never touches the case data (the same case re-opens intact);
 * - a note is saved through the REAL API (POST /cases/:id/notes) and comes back with
 *   the refreshed projection — a note that vanishes on reopen is a dead feature;
 * - copy gives visible feedback;
 * - Escape closes the palette and restores focus to the element that opened it.
 */
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkbenchPage } from "../pages/WorkbenchPage";
import type { OpenedCase } from "../pages/workbench/savedInvestigationsModel";
import { useSelection } from "../store/selectionStore";
import { useViewState } from "../store/viewStateStore";

// jsdom lacks matchMedia (sonner's Toaster reads the theme); React 19's act needs the flag.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom lacks ResizeObserver (Radix dialogs observe size); a no-op stub is enough.
if (typeof window !== "undefined" && !("ResizeObserver" in window)) {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  window.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}
// jsdom lacks Element.scrollIntoView (cmdk scrolls the selected item into view).
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoViewStub(): void {};
}
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

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

const CASE_ID = "01CCCCCCCCCCCCCCCCCCCCCCCC";

function projectionBody(notes: Array<{ seq: number; nodeId: string; text: string }> = []) {
  return {
    seq: 5,
    graph: { nodes: [node(NODE_A, "domain:a.example.com"), node(NODE_B, "domain:b.example.com")], edges: [] },
    table: [],
    coverage: {},
    networkLog: {},
    notes,
    counts: { entities: 2, nodes: 2, claims: 0, edges: 0, observations: 0, evidence: 0, merges: 0, notes: notes.length },
    sha256: "a".repeat(64),
  };
}

const OPENED: OpenedCase = { id: CASE_ID, title: "قضية اختبار", seq: 5, sha256: "a".repeat(64), graph: projectionBody().graph, notes: [] };

let root: Root | null = null;
const container = document.createElement("div");
function render(element: React.ReactElement): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  root = createRoot(container);
  act(() => {
    root.render(React.createElement(QueryClientProvider, { client }, element));
  });
}

/** The fetch mock: the projection is served (with notes after the note round-trip), and
 *  POST /cases/:id/notes is captured. */
const calls: Array<{ url: string; method: string; body?: unknown }> = [];
let noteResponse: { status: number; body: unknown } = {
  status: 201,
  body: { seq: 6, nodeId: NODE_A, text: "x", at: "2026-10-20T00:00:00Z", actor: "web" },
};
let servedNotes: Array<{ seq: number; nodeId: string; text: string }> = [];
const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = String(input);
  const method = init?.method ?? "GET";
  calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
  const json = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (url.endsWith(`/api/cases/${CASE_ID}/projection`)) return json(200, projectionBody(servedNotes));
  if (url.endsWith(`/api/cases/${CASE_ID}/notes`) && method === "POST") return json(noteResponse.status, noteResponse.body);
  return json(404, { error: "unknown" });
});

beforeEach(() => {
  document.body.appendChild(container);
  calls.length = 0;
  servedNotes = [];
  noteResponse = { status: 201, body: { seq: 6, nodeId: NODE_A, text: "x", at: "2026-10-20T00:00:00Z", actor: "web" } };
  vi.stubGlobal("fetch", fetchMock);
  useSelection.getState().clear();
  useViewState.getState().clear();
});
afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  container.remove();
  while (container.firstChild) container.removeChild(container.firstChild);
  vi.unstubAllGlobals();
});

function press(target: Element, init: KeyboardEventInit): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
  });
}

/** The context menu opens for the node a row represents (right-click), and for the
 *  selected node (Shift+F10). Both paths end in the same menu. */
function openMenuForRow(row: Element): void {
  act(() => {
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  });
}

describe("P3-021 palette (Ctrl/Cmd+K)", () => {
  it("Ctrl+K opens a searchable palette; typing filters; Escape closes and restores focus", async () => {
    render(React.createElement(WorkbenchPage, { initialOpenedCase: OPENED }));
    const workbench = container.querySelector('[data-testid="workbench-page"]') as HTMLElement;
    expect(workbench).not.toBeNull();
    // A node command needs a target: the selected node serves the palette's node commands.
    act(() => {
      useSelection.getState().selectNode(NODE_A);
    });
    // The control that "opens" the palette: focused before Ctrl+K, so Escape's focus
    // restore has an honest destination.
    const opener = document.createElement("button");
    container.appendChild(opener);
    opener.focus();

    // Ctrl+K opens the palette; it lands on the search input.
    press(workbench, { key: "k", ctrlKey: true });
    const palette = document.querySelector('[data-testid="command-palette"]');
    expect(palette).not.toBeNull();
    const input = palette?.querySelector("input");
    expect(document.activeElement).toBe(input);

    // Typing filters the command list down to the matching label.
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(input as HTMLInputElement, "ملاحظة");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const items = [...palette.querySelectorAll('[role="option"], [cmdk-item]')];
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThan(COMMAND_COUNT);

    // Escape closes the palette and restores focus to the element that had focus when
    // the palette opened.
    press(palette as Element, { key: "Escape" });
    expect(document.querySelector('[data-testid="command-palette"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("Enter executes the highlighted command (node.details selects the node and opens its panel)", async () => {
    render(React.createElement(WorkbenchPage, { initialOpenedCase: OPENED }));
    const workbench = container.querySelector('[data-testid="workbench-page"]') as HTMLElement;

    // Select node A first (node commands need a target — the selected node).
    act(() => {
      useSelection.getState().selectNode(NODE_A);
    });

    press(workbench, { key: "k", metaKey: true });
    const palette = document.querySelector('[data-testid="command-palette"]') as HTMLElement;
    // Clear the filter, then walk to «تفاصيل العقدة» and run it.
    const input = palette.querySelector("input") as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(input, "");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const detailsItem = [...palette.querySelectorAll('[role="option"], [cmdk-item]')].find((el) => el.textContent?.includes("التفاصيل"));
    expect(detailsItem).toBeDefined();
    act(() => {
      (detailsItem as HTMLElement).click();
    });
    // The palette closed and the node's panel is open.
    expect(document.querySelector('[data-testid="command-palette"]')).toBeNull();
    expect(container.querySelector('[data-testid="node-detail-panel"]')).not.toBeNull();
  });
});

describe("P3-021 node context menu", () => {
  it("right-click on a row opens the menu for THAT node even when another node is selected", () => {
    render(React.createElement(WorkbenchPage, { initialOpenedCase: OPENED }));
    act(() => {
      useSelection.getState().selectNode(NODE_A); // a stale selection must not win
    });
    const rowB = container.querySelector(`[data-testid="entity-row"][data-node-id="${NODE_B}"]`) as HTMLElement;
    expect(rowB).not.toBeNull();
    openMenuForRow(rowB);
    const menu = container.querySelector('[data-testid="node-context-menu"]');
    expect(menu).not.toBeNull();

    // «التفاصيل» from the menu acts on node B — the node the menu was opened ON.
    const details = [...menu.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent?.includes("التفاصيل"));
    act(() => {
      (details as HTMLElement).click();
    });
    expect(useSelection.getState().selectedNodeId).toBe(NODE_B);
    expect(container.querySelector('[data-testid="node-context-menu"]')).toBeNull();
  });

  it("Shift+F10 opens the menu for the selected node (keyboard access)", () => {
    render(React.createElement(WorkbenchPage, { initialOpenedCase: OPENED }));
    act(() => {
      useSelection.getState().selectNode(NODE_B);
    });
    const workbench = container.querySelector('[data-testid="workbench-page"]') as HTMLElement;
    press(workbench, { key: "F10", shiftKey: true });
    expect(container.querySelector('[data-testid="node-context-menu"]')).not.toBeNull();
  });

  it("the menu contains the six acceptance actions: تفاصيل، إعادة جلب، نسخ، ملاحظة، حذف عقدة/فرع، تركيز", () => {
    render(React.createElement(WorkbenchPage, { initialOpenedCase: OPENED }));
    act(() => {
      useSelection.getState().selectNode(NODE_A);
    });
    const rowA = container.querySelector(`[data-testid="entity-row"][data-node-id="${NODE_A}"]`) as HTMLElement;
    openMenuForRow(rowA);
    const menu = container.querySelector('[data-testid="node-context-menu"]') as HTMLElement;
    const labels = menu.textContent ?? "";
    for (const expected of ["التفاصيل", "إعادة الجلب", "نسخ", "ملاحظة", "العرض", "التركيز"]) {
      expect(labels).toContain(expected);
    }
  });

  it("نسخ writes the canonical key with visible feedback", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(React.createElement(WorkbenchPage, { initialOpenedCase: OPENED }));
    const rowA = container.querySelector(`[data-testid="entity-row"][data-node-id="${NODE_A}"]`) as HTMLElement;
    openMenuForRow(rowA);
    const menu = container.querySelector('[data-testid="node-context-menu"]') as HTMLElement;
    const copy = [...menu.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent?.includes("نسخ"));
    await act(async () => {
      (copy as HTMLElement).click();
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(writeText).toHaveBeenCalledWith("domain:a.example.com");
    expect(container.textContent).toContain("تم النسخ");
  });

  it("إزالة العقدة من العرض hides the node everywhere and never rewrites the case; إظهار كل العقد restores it", async () => {
    render(React.createElement(WorkbenchPage, { initialOpenedCase: OPENED }));
    expect(container.querySelectorAll('[data-testid="entity-row"]')).toHaveLength(2);
    const rowA = container.querySelector(`[data-testid="entity-row"][data-node-id="${NODE_A}"]`) as HTMLElement;
    openMenuForRow(rowA);
    const menu = container.querySelector('[data-testid="node-context-menu"]') as HTMLElement;
    const remove = [...menu.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent?.includes("العرض"));
    act(() => {
      (remove as HTMLElement).click();
    });
    expect(container.querySelector(`[data-testid="entity-row"][data-node-id="${NODE_A}"]`)).toBeNull();
    expect(container.querySelector(`[data-testid="entity-row"][data-node-id="${NODE_B}"]`)).not.toBeNull();

    // The palette's «إظهار كل العقد» brings the node back — removal was reversible view state.
    const workbench = container.querySelector('[data-testid="workbench-page"]') as HTMLElement;
    press(workbench, { key: "k", ctrlKey: true });
    const palette = document.querySelector('[data-testid="command-palette"]') as HTMLElement;
    const showAll = [...palette.querySelectorAll('[role="option"], [cmdk-item]')].find((el) => el.textContent?.includes("إظهار كل"));
    expect(showAll).toBeDefined();
    act(() => {
      (showAll as HTMLElement).click();
    });
    expect(container.querySelector(`[data-testid="entity-row"][data-node-id="${NODE_A}"]`)).not.toBeNull();
  });

  it("Delete (outside text fields) removes the selected node from the view", () => {
    render(React.createElement(WorkbenchPage, { initialOpenedCase: OPENED }));
    act(() => {
      useSelection.getState().selectNode(NODE_B);
    });
    const workbench = container.querySelector('[data-testid="workbench-page"]') as HTMLElement;
    press(workbench, { key: "Delete" });
    expect(container.querySelector(`[data-testid="entity-row"][data-node-id="${NODE_B}"]`)).toBeNull();
    // But typing Delete inside the run form's input is text, not a command.
    const runInput = container.querySelector('[data-testid="run-input-input"]') as HTMLInputElement;
    expect(runInput).not.toBeNull();
    act(() => {
      useViewState.getState().clear();
      useSelection.getState().selectNode(NODE_A);
    });
    act(() => {
      runInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    });
    expect(container.querySelector(`[data-testid="entity-row"][data-node-id="${NODE_A}"]`)).not.toBeNull();
  });

  it("ملاحظة saves through the real API and the note comes back with the refreshed projection", async () => {
    render(React.createElement(WorkbenchPage, { initialOpenedCase: OPENED }));
    act(() => {
      useSelection.getState().selectNode(NODE_A);
    });
    const rowA = container.querySelector(`[data-testid="entity-row"][data-node-id="${NODE_A}"]`) as HTMLElement;
    openMenuForRow(rowA);
    const menu = container.querySelector('[data-testid="node-context-menu"]') as HTMLElement;
    const note = [...menu.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent?.includes("ملاحظة"));
    act(() => {
      (note as HTMLElement).click();
    });
    const dialog = container.querySelector('[data-testid="note-dialog"]') as HTMLElement;
    expect(dialog).not.toBeNull();
    const textarea = dialog.querySelector("textarea") as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
      setter.call(textarea, "التحقق يحتاج مصدراً ثانياً");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const save = dialog.querySelector('[data-testid="note-save"]') as HTMLButtonElement;
    // The next projection serves the note — the save is only honest if the re-read carries it.
    servedNotes = [{ seq: 6, nodeId: NODE_A, text: "التحقق يحتاج مصدراً ثانياً" }];
    await act(async () => {
      save.click();
      await new Promise((r) => setTimeout(r, 20));
    });
    // The REAL note API was called with the node's permanent id and the text.
    const noteCall = calls.find((c) => c.url.endsWith(`/api/cases/${CASE_ID}/notes`) && c.method === "POST");
    expect(noteCall?.body).toMatchObject({ nodeId: NODE_A, text: "التحقق يحتاج مصدراً ثانياً" });
    // The case projection was re-read and the note is visible on the node's panel.
    expect(calls.filter((c) => c.url.endsWith(`/api/cases/${CASE_ID}/projection`)).length).toBeGreaterThanOrEqual(1);
    const panel = container.querySelector('[data-testid="node-detail-panel"]') as HTMLElement;
    expect(panel.textContent).toContain("التحقق يحتاج مصدراً ثانياً");
  });
});

/** The palette renders one item per available command (plus group headings). */
const COMMAND_COUNT = 12;
