import { t } from "@ir/i18n";
import * as React from "react";

import type { GraphNode } from "@ir/ledger/projections";

import { type EntityRow, type SortKey, type SortSpec, visibleWindow } from "./entityTableModel";
import { useSelection } from "../../store/selectionStore";

/**
 * P3-009: the entity table — default sorting, filtering and a virtualized window
 * (100,000 rows render only the visible slice; the scroll math is the pure
 * `visibleWindow` tested in entityTableModel.test.ts).
 *
 * Presentational by design (D-033: view state only): rows arrive already
 * sorted+filtered; the component owns only the scroll position, which never
 * leaves the DOM. `totalRows` lets the container report the unfiltered count
 * when a filter is active.
 */
const ROW_HEIGHT = 36;
const VIEWPORT_HEIGHT = 360;
const OVERSCAN = 3;

// P3-017: the column labels are dictionary keys, resolved at render time.
const COLUMNS: Array<{
  key: SortKey;
  msgKey:
    | "workbench.entities.type"
    | "workbench.entities.label"
    | "workbench.entities.canonicalKey"
    | "workbench.entities.claims"
    | "workbench.entities.evidence";
}> = [
  { key: "type", msgKey: "workbench.entities.type" },
  { key: "label", msgKey: "workbench.entities.label" },
  { key: "canonicalKey", msgKey: "workbench.entities.canonicalKey" },
  { key: "claims", msgKey: "workbench.entities.claims" },
  { key: "evidence", msgKey: "workbench.entities.evidence" },
];

export interface EntityTableProps {
  rows: EntityRow[];
  sort: SortSpec;
  onSortChange: (sort: SortSpec) => void;
  filter: string;
  onFilterChange: (filter: string) => void;
  /** Unfiltered total, for the count line when a filter is active. */
  totalRows?: number;
  /**
   * P3-020/UC-03: selecting a row opens the node's detail panel — the table is a view
   * of the same graph the canvas shows, so its rows carry the same selection.
   */
  onSelectRow?: (nodeId: string) => void;
  /**
   * P3-021: right-clicking a row opens the node's context menu targeting THAT row's
   * node — the table is a view of the same graph the canvas shows.
   */
  onContextMenuRow?: (nodeId: string, event: React.MouseEvent) => void;
}

export function EntityTable({
  rows,
  sort,
  onSortChange,
  filter,
  onFilterChange,
  totalRows,
  onSelectRow,
  onContextMenuRow,
}: EntityTableProps) {
  const [scrollTop, setScrollTop] = React.useState(0);

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

  const toggleSort = (key: SortKey) => {
    if (sort.key === key) {
      onSortChange({ key, dir: sort.dir === "asc" ? "desc" : "asc" });
    } else {
      onSortChange({ key, dir: "asc" });
    }
  };

  const fmt = (n: number) => n.toLocaleString("en-US");
  const count = totalRows !== undefined && filter.trim() ? `${fmt(rows.length)} من ${fmt(totalRows)}` : fmt(rows.length);

  return (
    <section data-testid="entity-table" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <input
          data-testid="entity-filter"
          className="w-64 rounded-md border border-border bg-background px-3 py-1.5 text-sm"
          placeholder={t("workbench.entities.filter")}
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
        />
        <span className="text-xs text-muted-foreground" data-testid="entity-count">
          {count}
        </span>
      </div>
      <div
        className="overflow-auto rounded-md border border-border"
        style={{ height: VIEWPORT_HEIGHT }}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-muted">
            <tr>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  data-sort-key={c.key}
                  aria-sort={sort.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                  className="cursor-pointer px-2 py-1.5 text-start font-normal"
                  onClick={() => toggleSort(c.key)}
                >
                  {t(c.msgKey)} {sort.key === c.key ? (sort.dir === "asc" ? "▲" : "▼") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr style={{ height: topSpacer }} data-testid="entity-spacer-top">
              <td colSpan={COLUMNS.length} />
            </tr>
            {visible.map((r) => (
              <tr
                key={r.id}
                data-testid="entity-row"
                {...(onSelectRow || onContextMenuRow
                  ? {
                      "data-node-id": r.id,
                      className: "cursor-pointer border-t",
                      onClick: onSelectRow ? () => onSelectRow(r.id) : undefined,
                      onContextMenu: onContextMenuRow ? (event) => onContextMenuRow(r.id, event) : undefined,
                    }
                  : { className: "border-t" })}
                style={{ height: ROW_HEIGHT }}
              >
                <td className="px-2 py-1 font-mono text-[11px]">{r.type}</td>
                <td className="px-2 py-1">{r.label}</td>
                <td className="px-2 py-1 font-mono text-[11px]">{r.canonicalKey}</td>
                <td className="px-2 py-1 text-center" data-testid="claim-confidence">
                  {r.claims}
                </td>
                <td className="px-2 py-1 text-center">{r.evidence}</td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="px-2 py-8 text-center text-muted-foreground">
                  {t("workbench.entities.empty")}
                </td>
              </tr>
            ) : null}
            <tr style={{ height: bottomSpacer }} data-testid="entity-spacer-bottom">
              <td colSpan={COLUMNS.length} />
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * Container: turns the projection's nodes into rows and owns the filter/sort
 * view state (D-033). The presentational table above stays testable statically.
 */
export function EntityTableContainer({
  nodes,
  onContextMenuRow,
}: {
  nodes: readonly GraphNode[];
  onContextMenuRow?: (nodeId: string, event: React.MouseEvent) => void;
}) {
  const [filter, setFilter] = React.useState("");
  const [sort, setSort] = React.useState<SortSpec>({ key: "type", dir: "asc" });
  const selectNode = useSelection((s) => s.selectNode);

  const allRows = React.useMemo(() => buildEntityRowsFor(nodes), [nodes]);
  const filtered = React.useMemo(() => filterEntityRowsFor(allRows, filter), [allRows, filter]);
  const rows = React.useMemo(() => sortEntityRowsFor(filtered, sort), [filtered, sort]);

  return (
    <EntityTable
      rows={rows}
      sort={sort}
      onSortChange={setSort}
      filter={filter}
      onFilterChange={setFilter}
      totalRows={allRows.length}
      onSelectRow={selectNode}
      onContextMenuRow={onContextMenuRow}
    />
  );
}

// Re-exported model functions keep the container's import surface minimal.
import {
  buildEntityRows as buildEntityRowsFor,
  filterEntityRows as filterEntityRowsFor,
  sortEntityRows as sortEntityRowsFor,
} from "./entityTableModel";
