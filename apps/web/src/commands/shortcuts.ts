/**
 * P3-021: the keyboard layer — a pure function from a keydown event to the action id
 * it names. Exactly one component owns the behavior for each id (the palette toggle,
 * the context-menu open); this module only decides WHICH key means WHAT, so the
 * manual (docs/shortcuts.md) and the code cannot drift apart silently.
 *
 * Text-entry surfaces (inputs, textareas, contenteditables) swallow shortcuts: the
 * Delete key inside the note dialog is text, not a command.
 */
export type ShortcutAction = "palette.toggle" | "contextmenu.open" | "node.removeView" | "history.undo" | "history.redo";

export function matchShortcut(event: KeyboardEvent): ShortcutAction | null {
  // Ctrl/Cmd+K toggles the palette (the OS-appropriate modifier).
  if (isPaletteToggle(event)) return "palette.toggle";
  // Shift+F10 opens the node context menu for the selected node.
  if (isContextMenuOpen(event)) return "contextmenu.open";
  // Delete removes the selected node from the view (outside text fields).
  if (isRemoveView(event)) return "node.removeView";
  // P3-022: undo/redo the last view edit (outside text fields — typing is never an undo).
  if (isUndo(event)) return "history.undo";
  if (isRedo(event)) return "history.redo";
  return null;
}

function isUndo(event: KeyboardEvent): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "z";
}

function isRedo(event: KeyboardEvent): boolean {
  const mod = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  return mod && !event.altKey && ((event.shiftKey && key === "z") || (!event.shiftKey && key === "y"));
}

function isPaletteToggle(event: KeyboardEvent): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k";
}

function isContextMenuOpen(event: KeyboardEvent): boolean {
  return event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && event.key === "F10";
}

function isRemoveView(event: KeyboardEvent): boolean {
  const plain = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
  return plain && (event.key === "Delete" || event.key === "Backspace");
}

/** True when the keyboard event's target is a text-entry surface. */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return true;
  // jsdom does not reflect the property — the attribute is the honest source.
  return target.isContentEditable || target.getAttribute("contenteditable") !== null;
}
