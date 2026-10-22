import * as React from "react";
import { t } from "@ir/i18n";
import { useSelection } from "../../store/selectionStore";
import { buildCoverageRows, cellState, type CoverageRow } from "./coverageModel";
import type { OpenedCase } from "./savedInvestigationsModel";

/**
 * P4-010 (UC-21) — the coverage map view: خريطة التغطية، «ما فُحص وما لم يُفحص».
 * Presentational; the container owns the data (the opened case's own snapshot —
 * the FULL case graph, never the hidden-filtered one: hiding a node is view state
 * and never erases its coverage) and the selection wiring (the row is the
 * affordance, the store wiring is proven in e2e). Honest states, textually
 * distinct: «فُحص بنتيجة» / «فُحص بلا نتيجة» / «فشل» / «مختلط» — color alone is
 * never the only signal, the counts are all shown (a mixed history is never
 * collapsed to its last result), and a negative-only transform stays visible
 * (the acceptance: «كل محوّل فارغ يظهر»). No case opened ⇒ an honest hint (local
 * identifiers are never classified as untouched — there is no coverage record
 * for them); coverage unavailable (older server / corrupt field) ⇒ stated as
 * such, no fabricated rows.
 */

type CoverageStatus = "ready" | "unavailable" | "no-case";

const STATE_LABEL: Record<ReturnType<typeof cellState>, string> = {
  "with-results": t("workbench.coverage.state.with-results"),
  "no-results": t("workbench.coverage.state.no-results"),
  failed: t("workbench.coverage.state.failed"),
  mixed: t("workbench.coverage.state.mixed"),
};

function CoverageCellChip({ cell }: { cell: CoverageRow["checked"][number] }) {
  const state = cellState(cell);
  return (
    <li
      data-testid="coverage-cell"
      data-transform-id={cell.transformId}
      className={`${state} flex flex-wrap items-baseline gap-x-2 gap-y-0.5`}
    >
      <span dir="ltr" className="whitespace-nowrap font-medium">
        {cell.transformId}
      </span>
      <span>{STATE_LABEL[state]}</span>
      <span className="text-muted-foreground">
        {t("workbench.coverage.counts", { positive: cell.positive, negative: cell.negative, error: cell.error })}
      </span>
      {/* BiDi (visual QA precedent): the raw timestamp keeps its precision and its
          direction — isolated and unbreakable inside the RTL row. A separate flex
          item (with its own gap) so the counts' trailing digit can never visually
          merge into the timestamp's LTR island. */}
      <span dir="ltr" className="whitespace-nowrap text-muted-foreground">
        {cell.lastAt}
      </span>
    </li>
  );
}

function CoverageRowView({ row, onSelect }: { row: CoverageRow; onSelect?: (nodeId: string) => void }) {
  return (
    <li
      data-node-id={row.entityId}
      data-testid="coverage-row"
      className="cursor-pointer border-b border-border py-2 text-sm last:border-b-0 hover:bg-muted/50"
      onClick={() => onSelect?.(row.entityId)}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-medium">{row.label}</span>
        {row.type !== "" ? <span className="text-xs text-muted-foreground">{row.type}</span> : null}
        {row.untouched ? <span className="text-xs text-muted-foreground">{t("workbench.coverage.untouched")}</span> : null}
      </div>
      {row.checked.length > 0 ? (
        <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          {row.checked.map((cell) => (
            <CoverageCellChip key={cell.transformId} cell={cell} />
          ))}
        </ul>
      ) : null}
      {row.unchecked.length > 0 ? (
        <div className="mt-0.5 text-xs text-muted-foreground">
          {t("workbench.coverage.unchecked", { transforms: row.unchecked.join("، ") })}
        </div>
      ) : null}
    </li>
  );
}

export function CoverageMap({
  rows,
  transforms,
  status,
  onSelectEntity,
}: {
  rows: readonly CoverageRow[];
  transforms: readonly string[];
  status: CoverageStatus;
  onSelectEntity?: (nodeId: string) => void;
}) {
  return (
    <section aria-label={t("workbench.coverage.ariaLabel")} data-testid="coverage-map" className="rounded-md border border-border p-3">
      <h3 className="mb-2 text-sm font-semibold">{t("workbench.coverage.heading")}</h3>
      {status === "no-case" ? (
        <p className="text-sm text-muted-foreground">{t("workbench.coverage.noCase")}</p>
      ) : status === "unavailable" ? (
        <p className="text-sm text-muted-foreground">{t("workbench.coverage.unavailable")}</p>
      ) : (
        <>
          <p className="mb-1 text-xs text-muted-foreground">{t("workbench.coverage.transformsCount", { n: transforms.length })}</p>
          <ol className="max-h-72 overflow-auto">
            {rows.map((row) => (
              <CoverageRowView key={row.entityId} row={row} onSelect={onSelectEntity} />
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

/**
 * Container: owns the case's own snapshot data (the FULL graph of the opened
 * case — never the hidden-filtered view) and the selection wiring.
 */
export function CoverageMapContainer({ openedCase }: { openedCase: OpenedCase | null }) {
  const selectNode = useSelection((s) => s.selectNode);
  if (openedCase === null) return <CoverageMap rows={[]} transforms={[]} status="no-case" />;
  if (openedCase.coverage === null) return <CoverageMap rows={[]} transforms={[]} status="unavailable" />;
  const { rows, transforms } = buildCoverageRows(openedCase.graph, openedCase.coverage);
  return <CoverageMap rows={rows} transforms={transforms} status="ready" onSelectEntity={selectNode} />;
}
