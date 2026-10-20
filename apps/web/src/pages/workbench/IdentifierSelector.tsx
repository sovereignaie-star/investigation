import { t } from "@ir/i18n";
import * as React from "react";
import { Badge } from "@ir/ui";

import type { IdentifierRow } from "./model";
import { visibleWindow } from "./entityTableModel";

/**
 * P3-004 (UC-02): the classified identifier list. Every row shows the value (LTR), the Arabic
 * type label from the catalog, the detector's confidence as a percentage, and the validation
 * badge when the winning candidate passed a checksum/registry/PSL check. Rows are selectable —
 * the selection drives later expansion steps and lives in view state only.
 *
 * P3-026: the list is virtualized (same window math as the entity table) — the workbench
 * input path must survive 100,000 extracted identifiers without a DOM blowup or a frozen
 * page. Only the visible window renders; spacers keep the scrollbar honest.
 */
const ROW_HEIGHT = 40;
const VIEWPORT_HEIGHT = 360;
const OVERSCAN = 3;

export function IdentifierSelector({
  rows,
  selected,
  onToggle,
}: {
  rows: readonly IdentifierRow[];
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
}) {
  const [scrollTop, setScrollTop] = React.useState(0);

  if (rows.length === 0) {
    return (
      <p data-testid="identifier-selector" className="text-sm text-muted-foreground">
        {t("workbench.identifiers.empty")}
      </p>
    );
  }

  const win = visibleWindow({
    scrollTop,
    viewportHeight: VIEWPORT_HEIGHT,
    rowHeight: ROW_HEIGHT,
    totalRows: rows.length,
    overscan: OVERSCAN,
  });
  const visible = rows.slice(win.start, win.end + 1);
  const topSpacer = win.start * ROW_HEIGHT;
  const bottomSpacer = Math.max(0, (rows.length - win.end - 1) * ROW_HEIGHT);

  return (
    <div data-testid="identifier-selector" className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        {t("workbench.identifiers.selected", { selected: selected.size, total: rows.length.toLocaleString("en-US") })}
      </p>
      <div
        className="overflow-auto rounded-md border border-border"
        style={{ height: VIEWPORT_HEIGHT }}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-muted">
            <tr className="border-b border-border text-start text-muted-foreground">
              <th className="py-2 text-start font-medium">{t("workbench.identifiers.value")}</th>
              <th className="py-2 text-start font-medium">{t("workbench.identifiers.type")}</th>
              <th className="py-2 text-start font-medium">{t("workbench.identifiers.confidence")}</th>
              <th className="py-2 text-start font-medium">{t("workbench.identifiers.validated")}</th>
              <th className="py-2 text-start font-medium">{t("workbench.identifiers.select")}</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ height: topSpacer }} data-testid="identifier-spacer-top">
              <td colSpan={5} />
            </tr>
            {visible.map((row) => (
              <tr key={row.id} className="border-b border-border/50" style={{ height: ROW_HEIGHT }}>
                <td dir="ltr" className="py-2 pe-2 font-mono">
                  {row.value}
                </td>
                <td className="py-2 pe-2">
                  {row.typeLabelAr}
                  <span className="block text-xs text-muted-foreground">{row.category}</span>
                </td>
                <td className="py-2 pe-2">{Math.round(row.confidence * 100)}%</td>
                <td className="py-2 pe-2">{row.validated && <Badge variant="outline">{t("workbench.identifiers.confirmed")}</Badge>}</td>
                <td className="py-2 pe-2">
                  <input
                    type="checkbox"
                    name={`identifier:${row.id}`}
                    checked={selected.has(row.id)}
                    onChange={() => onToggle(row.id)}
                    aria-label={t("workbench.identifiers.pick", { value: row.value })}
                  />
                </td>
              </tr>
            ))}
            <tr style={{ height: bottomSpacer }} data-testid="identifier-spacer-bottom">
              <td colSpan={5} />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
