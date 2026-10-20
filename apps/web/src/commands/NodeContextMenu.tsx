import { t } from "@ir/i18n";
import * as React from "react";

import { CONTEXT_MENU_COMMAND_IDS, commandById, runCommand, type CommandContext } from "./registry";

/**
 * P3-021 — the node context menu: the registry's node actions, positioned at the
 * point it was opened at, targeting the node it was opened ON (never a stale
 * selection). One menu serves all three entry points:
 *  - right-click on a graph node (sigma reports the node under the cursor),
 *  - right-click on an entity-table row (the row's node),
 *  - Shift+F10 (the SELECTED node — keyboard access; the menu positions itself at
 *    the selected row when visible, else at the viewport's center).
 *
 * Keyboard behavior (docs/shortcuts.md): ArrowDown/ArrowUp move, Enter/Space run,
 * Escape closes and restores focus to the element that opened the menu. Unavailable
 * commands render disabled with their honest reason left to the registry — no dead
 * buttons that look alive.
 */
export interface MenuTarget {
  nodeId: string;
  x: number;
  y: number;
}

export function NodeContextMenu({ target, onClose, ctx }: { target: MenuTarget | null; onClose: () => void; ctx: CommandContext }) {
  // The menu body remounts on every open (keyed by the target): each open starts
  // with a FRESH active item — no state reset in an effect, no stale highlight.
  if (target === null) return null;
  return <MenuBody key={`${target.nodeId}:${target.x}:${target.y}`} target={target} onClose={onClose} ctx={ctx} />;
}

function MenuBody({ target, onClose, ctx }: { target: MenuTarget; onClose: () => void; ctx: CommandContext }) {
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const [activeIndex, setActiveIndex] = React.useState(0);

  const items = React.useMemo(
    () => CONTEXT_MENU_COMMAND_IDS.map((id) => commandById(id)).filter((c): c is NonNullable<typeof c> => c !== undefined),
    [],
  );

  // Focus the menu on mount; restore focus to the opener on unmount.
  const openerRef = React.useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  React.useEffect(() => {
    menuRef.current?.focus();
    const opener = openerRef.current;
    return () => {
      opener?.focus();
    };
  }, []);

  // Keep the menu fully on screen: it prefers the opening point, then the rendered
  // size (measured, not estimated) shifts it inside the viewport — a position:fixed
  // menu cannot be scrolled into view, so an off-screen item would be unreachable.
  React.useLayoutEffect(() => {
    const el = menuRef.current;
    if (el === null) return;
    const maxX = Math.max(8, window.innerWidth - el.offsetWidth - 8);
    const maxY = Math.max(8, window.innerHeight - el.offsetHeight - 8);
    el.style.left = `${Math.min(Math.max(8, target.x), maxX)}px`;
    el.style.top = `${Math.min(Math.max(8, target.y), maxY)}px`;
  }, [target.x, target.y]);

  if (items.length === 0) return null;

  // The acceptance's actions are always PRESENT; an unavailable one (no canvas for
  // focus, no opened case for a note) renders disabled — an honest state, never a
  // dead button that looks alive.
  const enabledOf = (index: number): boolean => items[index].available(ctx, target.nodeId);

  const run = (index: number): void => {
    const command = items[index];
    if (!command || !enabledOf(index)) return;
    onClose();
    void runCommand(command.id, ctx, target.nodeId);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => (i + 1) % items.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => (i - 1 + items.length) % items.length);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      run(activeIndex);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  const style: React.CSSProperties = {
    position: "fixed",
    left: target.x,
    top: target.y,
    zIndex: 60,
  };

  return (
    <div
      ref={menuRef}
      data-testid="node-context-menu"
      role="menu"
      aria-label={t("commands.group.node")}
      tabIndex={-1}
      style={style}
      onKeyDown={onKeyDown}
      onBlur={(event) => {
        // Focus leaving the menu (not moving within it) closes it — the menu never
        // lingers detached from the user's intent.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onClose();
      }}
      className="min-w-[220px] rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none"
    >
      {items.map((command, index) => (
        <button
          key={command.id}
          type="button"
          role="menuitem"
          data-testid={`menu-${command.id}`}
          data-active={index === activeIndex || undefined}
          aria-disabled={!enabledOf(index) || undefined}
          onClick={() => run(index)}
          onMouseEnter={() => setActiveIndex(index)}
          className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-right text-sm outline-none disabled:opacity-50 ${
            index === activeIndex ? "bg-accent text-accent-foreground" : ""
          }`}
          disabled={!enabledOf(index)}
        >
          <span className="flex-1">{t(command.labelKey)}</span>
          {command.shortcut ? <span className="font-mono text-xs text-muted-foreground">{command.shortcut}</span> : null}
        </button>
      ))}
    </div>
  );
}
