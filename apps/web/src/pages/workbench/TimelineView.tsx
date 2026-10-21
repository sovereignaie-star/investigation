import * as React from "react";
import { t } from "@ir/i18n";
import { useSelection } from "../../store/selectionStore";
import { buildTimelineItems, occurrenceLabel, sortTimelineItems, type TimelineItem } from "./timelineModel";
import type { Graph } from "@ir/ledger/projections";

/**
 * P4-007 (UC-08) — the timeline view: خط زمني ثنائي البعد. Presentational; the container
 * owns the items (build + sort) and the selection wiring (P3-008's pattern — the row is the
 * affordance, the store wiring is proven in e2e). Both dimensions are visible per event:
 * the occurrence window (ADR-33 — honest intervals, open bounds say «غير محددة», the raw
 * window rides the title attribute with no precision or offset loss) and every observation's
 * own time and kind (P4-006). An event with no observation says so — no faked times.
 */

const KIND_LABEL: Record<TimelineItem["observations"][number]["kind"], string> = {
  positive: t("workbench.timeline.kind.positive"),
  negative: t("workbench.timeline.kind.negative"),
  error: t("workbench.timeline.kind.error"),
};

function TimelineRow({ item, onSelect }: { item: TimelineItem; onSelect?: (nodeId: string) => void }) {
  const label = occurrenceLabel(item);
  return (
    <li
      data-node-id={item.subjectId}
      data-claim-id={item.claimId}
      data-testid="timeline-item"
      className="cursor-pointer border-b border-border py-2 text-sm last:border-b-0 hover:bg-muted/50"
      onClick={() => onSelect?.(item.subjectId)}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-medium">{item.subjectLabel}</span>
        <span className="text-muted-foreground">{item.predicate}</span>
        <span className="font-medium">{item.objectLabel}</span>
        <span className="text-muted-foreground" title={label.full}>
          {label.text}
        </span>
      </div>
      {item.observations.length === 0 ? (
        <div className="text-xs text-muted-foreground">{t("workbench.timeline.noObservations")}</div>
      ) : (
        <ol className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          {item.observations.map((o) => (
            <li key={o.observationId} title={t("workbench.timeline.evidenceTitle", { id: o.evidenceId })} className={o.kind}>
              {KIND_LABEL[o.kind]} · {o.observedAt}
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

export function TimelineView({ items, onSelectSubject }: { items: readonly TimelineItem[]; onSelectSubject?: (nodeId: string) => void }) {
  return (
    <section aria-label={t("workbench.timeline.ariaLabel")} data-testid="timeline" className="rounded-md border border-border p-3">
      <h3 className="mb-2 text-sm font-semibold">{t("workbench.timeline.heading")}</h3>
      <ol className="max-h-72 overflow-auto">
        {items.map((item) => (
          <TimelineRow key={item.claimId} item={item} onSelect={onSelectSubject} />
        ))}
      </ol>
    </section>
  );
}

/** Container: owns the items (build + deterministic sort) and the selection wiring. */
export function TimelineViewContainer({ graph }: { graph: Graph }) {
  const items = React.useMemo(() => sortTimelineItems(buildTimelineItems(graph)), [graph]);
  const selectNode = useSelection((s) => s.selectNode);
  return <TimelineView items={items} onSelectSubject={selectNode} />;
}
