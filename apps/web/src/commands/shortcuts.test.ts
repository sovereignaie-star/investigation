// @vitest-environment jsdom
/**
 * P3-021 red-first: the keyboard shortcut layer — pure matching between keydown
 * events and registry commands. Written before the shortcut matcher existed.
 *
 * Contract:
 * - Ctrl/Cmd+K toggles the command palette (the palette itself is a UI concern; the
 *   matcher names it so exactly one component owns the behavior);
 * - Shift+F10 opens the node context menu for the SELECTED node (keyboard access);
 * - Delete removes the selected node from the view — but NEVER while the user is
 *   typing in a field, a textarea, or a contenteditable element (the note dialog,
 *   the search bar, the run form are text surfaces, not graph surfaces);
 * - a plain key press without a modifier matches nothing (no accidental commands).
 */
import { describe, expect, it } from "vitest";

import { matchShortcut, isTextEntryTarget } from "./shortcuts";

function keydown(overrides: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  return new KeyboardEvent("keydown", { key: "k", bubbles: true, ...overrides });
}

describe("P3-021 shortcut matching", () => {
  it("Ctrl+K and Cmd+K both open the palette (the OS-appropriate modifier)", () => {
    expect(matchShortcut(keydown({ key: "k", ctrlKey: true }))).toBe("palette.toggle");
    expect(matchShortcut(keydown({ key: "k", metaKey: true }))).toBe("palette.toggle");
  });

  it("Shift+F10 opens the context menu for the selected node", () => {
    expect(matchShortcut(keydown({ key: "F10", shiftKey: true }))).toBe("contextmenu.open");
  });

  it("Delete removes the selected node from the view", () => {
    expect(matchShortcut(keydown({ key: "Delete" }))).toBe("node.removeView");
  });

  it("P3-022: Ctrl+Z / Cmd+Z undo the last view edit (the OS-appropriate modifier)", () => {
    expect(matchShortcut(keydown({ key: "z", ctrlKey: true }))).toBe("history.undo");
    expect(matchShortcut(keydown({ key: "z", metaKey: true }))).toBe("history.undo");
  });

  it("P3-022: Ctrl+Shift+Z and Ctrl+Y redo (both documented spellings)", () => {
    expect(matchShortcut(keydown({ key: "z", ctrlKey: true, shiftKey: true }))).toBe("history.redo");
    expect(matchShortcut(keydown({ key: "z", metaKey: true, shiftKey: true }))).toBe("history.redo");
    expect(matchShortcut(keydown({ key: "y", ctrlKey: true }))).toBe("history.redo");
  });

  it("P3-022: plain Z and Y without a modifier match nothing (typing is never an undo)", () => {
    expect(matchShortcut(keydown({ key: "z" }))).toBeNull();
    expect(matchShortcut(keydown({ key: "y" }))).toBeNull();
    expect(matchShortcut(keydown({ key: "Z", shiftKey: true }))).toBeNull();
  });

  it("no match: plain keys, other modifiers, other keys with the same modifiers", () => {
    expect(matchShortcut(keydown({ key: "k" }))).toBeNull();
    expect(matchShortcut(keydown({ key: "j", ctrlKey: true }))).toBeNull();
    expect(matchShortcut(keydown({ key: "F10" }))).toBeNull();
    expect(matchShortcut(keydown({ key: "Delete", ctrlKey: true }))).toBeNull();
  });

  it("isTextEntryTarget: inputs, textareas and contenteditables swallow shortcuts", () => {
    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    const div = document.createElement("div");
    div.setAttribute("contenteditable", "true");
    const plain = document.createElement("div");
    expect(isTextEntryTarget(input)).toBe(true);
    expect(isTextEntryTarget(textarea)).toBe(true);
    expect(isTextEntryTarget(div)).toBe(true);
    expect(isTextEntryTarget(plain)).toBe(false);
    expect(isTextEntryTarget(null)).toBe(false);
  });
});
