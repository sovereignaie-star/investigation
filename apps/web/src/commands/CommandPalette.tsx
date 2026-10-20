import { t, type MessageKey } from "@ir/i18n";
import * as React from "react";

import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, Dialog, DialogContent } from "@ir/ui";

import { COMMANDS, runCommand, type CommandContext, type CommandTarget } from "./registry";
import { useSelection } from "../store/selectionStore";

/**
 * P3-021 — the command palette (Ctrl/Cmd+K): a searchable, keyboard-executable list
 * of the registry's available commands. The palette OWNS no action — it renders the
 * registry and runs its handlers, so the palette, the keyboard and the context menu
 * cannot drift apart.
 *
 * Escape closes and restores focus to the element that opened the palette (the
 * dialog primitive returns focus to its opener — the documented behavior in
 * docs/shortcuts.md).
 */
export function CommandPalette({
  open,
  onOpenChange,
  ctx,
  target = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ctx: CommandContext;
  /** The node the palette's node commands act on (defaults to the selected node). */
  target?: CommandTarget;
}) {
  // Node commands are available against the SELECTED node — the palette subscribes
  // to the selection so its re-renders are live. The groups are recomputed on EVERY
  // render (no memo): availability reads live store state (selection, view removals),
  // and a memoized list would hide commands that became available after the palette
  // mounted — the exact staleness the registry exists to prevent.
  const selectedNodeId = useSelection((s) => s.selectedNodeId);
  const byGroup = new Map<MessageKey, (typeof COMMANDS)[number][]>();
  for (const command of COMMANDS) {
    if (!command.available(ctx, target ?? selectedNodeId)) continue;
    const list = byGroup.get(command.groupKey) ?? [];
    list.push(command);
    byGroup.set(command.groupKey, list);
  }
  const groups = [...byGroup.entries()];

  const run = React.useCallback(
    (id: string) => {
      onOpenChange(false);
      void runCommand(id, ctx, target);
    },
    [ctx, target, onOpenChange],
  );

  // Focus restore: the palette has no DOM trigger (it opens from a keyboard shortcut),
  // so it remembers the focused element when it opens and returns focus to it when it
  // closes — the documented Escape behavior in docs/shortcuts.md.
  const openerRef = React.useRef<HTMLElement | null>(null);
  React.useEffect(() => {
    if (open) {
      openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    } else if (openerRef.current !== null) {
      const opener = openerRef.current;
      openerRef.current = null;
      opener.focus();
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="command-palette" aria-label={t("commands.palette.ariaLabel")} className="overflow-hidden p-0">
        <Command>
          <CommandInput data-testid="command-palette-input" placeholder={t("commands.palette.placeholder")} />
          <CommandList>
            <CommandEmpty>{t("commands.palette.empty")}</CommandEmpty>
            {groups.map(([groupKey, commands]) => (
              <CommandGroup key={groupKey} heading={t(groupKey)}>
                {commands.map((command) => (
                  <CommandItem
                    key={command.id}
                    value={`${t(command.labelKey)} ${command.id}`}
                    onSelect={() => run(command.id)}
                    data-testid={`command-${command.id}`}
                  >
                    <span>{t(command.labelKey)}</span>
                    {command.shortcut ? <span className="ml-auto font-mono text-xs text-muted-foreground">{command.shortcut}</span> : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
