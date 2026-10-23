import * as React from "react";
import { t } from "@ir/i18n";
import { useSelection } from "../../store/selectionStore";
import { getDateFormat, setDateFormat, subscribeDateFormat } from "../../store/dateFormatStore";
import { formatTimestamp, type DateDisplay } from "../../utils/dates";
import { buildTimelineItems, buildTimelinePatterns, occurrenceLabel, sortTimelineItems, type TimelineItem } from "./timelineModel";
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

function TimelineRow({ item, onSelect, fmt }: { item: TimelineItem; onSelect?: (nodeId: string) => void; fmt: (iso: string) => string }) {
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
          {label.segments.map((s, i) =>
            s.type === "ts" ? (
              // BiDi (visual QA): ISO timestamps scramble inside the RTL paragraph —
              // isolate each run directionally instead. whitespace-nowrap (375px): a
              // timestamp never breaks mid-string — it wraps as one unit or not at all.
              // P5-004: with a formatted preference the raw ISO stays reachable in the
              // title (no precision loss); the formatted run is one unbreakable unit too.
              <span key={i} dir="ltr" className="whitespace-nowrap" title={s.value}>
                {fmt(s.value)}
              </span>
            ) : (
              <span key={i}>{s.value}</span>
            ),
          )}
        </span>
      </div>
      {item.observations.length === 0 ? (
        <div className="text-xs text-muted-foreground">{t("workbench.timeline.noObservations")}</div>
      ) : (
        <ol className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          {item.observations.map((o) => (
            <li
              key={o.observationId}
              title={`${t("workbench.timeline.evidenceTitle", { id: o.evidenceId })} · ${o.observedAt}`}
              className={o.kind}
            >
              {KIND_LABEL[o.kind]} ·{" "}
              <span dir="ltr" className="whitespace-nowrap" title={o.observedAt}>
                {fmt(o.observedAt)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

/** The date-format preference control (P5-004): raw / Gregorian / Hijri / both. */
function DateFormatControl({ pref }: { pref: DateDisplay }) {
  const options: readonly { key: DateDisplay; label: string }[] = [
    { key: "raw", label: t("workbench.timeline.dateFormat.raw") },
    { key: "greg", label: t("workbench.timeline.dateFormat.greg") },
    { key: "hijri", label: t("workbench.timeline.dateFormat.hijri") },
    { key: "both", label: t("workbench.timeline.dateFormat.both") },
  ];
  return (
    <span className="inline-flex items-center gap-1 text-xs" aria-label={t("workbench.timeline.dateFormat.label")}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          data-testid={`timeline-dateformat-${o.key}`}
          aria-pressed={pref === o.key}
          className={`rounded border px-1.5 py-0.5 ${
            pref === o.key ? "border-primary bg-primary/10 font-medium" : "border-border text-muted-foreground"
          }`}
          onClick={() => setDateFormat(o.key)}
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}

export function TimelineView({ items, onSelectSubject }: { items: readonly TimelineItem[]; onSelectSubject?: (nodeId: string) => void }) {
  // P5-004: the date-display preference (raw default) — formatted Arabic / Hijri
  // (Umm al-Qura) rendering is one click away; the raw ISO always stays in title.
  const pref = React.useSyncExternalStore(subscribeDateFormat, getDateFormat, getDateFormat);
  const fmt = React.useCallback((iso: string) => formatTimestamp(iso, pref), [pref]);
  // P4-019: the timeline's detected patterns — pure function of the items, so
  // presentational rendering stays identical headless and in the browser.
  const patterns = buildTimelinePatterns(items);
  const hasPatterns =
    patterns.activityPeriods.length + patterns.suddenSilences.length + patterns.escalations.length + patterns.repetitions.length > 0;
  return (
    <section aria-label={t("workbench.timeline.ariaLabel")} data-testid="timeline" className="rounded-md border border-border p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t("workbench.timeline.heading")}</h3>
        <DateFormatControl pref={pref} />
      </div>
      <ol className="max-h-72 overflow-auto">
        {items.map((item) => (
          <TimelineRow key={item.claimId} item={item} onSelect={onSelectSubject} fmt={fmt} />
        ))}
      </ol>
      {hasPatterns ? (
        <div className="mt-3 border-t border-border pt-2" data-testid="timeline-patterns">
          <h4 className="mb-1 text-xs font-semibold">{t("workbench.timeline.patterns")}</h4>
          <ul className="space-y-1 text-[11px]">
            {patterns.activityPeriods.map((p, i) => (
              <li key={`activity-${i}`} data-testid="timeline-pattern-activity">
                {t("workbench.timeline.patternActivity", { start: p.start, end: p.end, count: p.count })}{" "}
                <span className="font-mono text-muted-foreground">{p.evidenceIds.join(" ")}</span>
              </li>
            ))}
            {patterns.suddenSilences.map((s, i) => (
              <li key={`silence-${i}`} data-testid="timeline-pattern-silence">
                {t("workbench.timeline.patternSilence", { from: s.from, to: s.to })}{" "}
                <span className="font-mono text-muted-foreground">{[...s.beforeEvidenceIds, ...s.afterEvidenceIds].join(" ")}</span>
              </li>
            ))}
            {patterns.escalations.map((e, i) => (
              <li key={`escalation-${i}`} data-testid="timeline-pattern-escalation">
                {t("workbench.timeline.patternEscalation", { from: e.from, to: e.to, previousCount: e.previousCount, count: e.count })}{" "}
                <span className="font-mono text-muted-foreground">{e.evidenceIds.join(" ")}</span>
              </li>
            ))}
            {patterns.repetitions.map((r, i) => (
              <li key={`repetition-${i}`} data-testid="timeline-pattern-repetition">
                {t("workbench.timeline.patternRepetition", { value: r.value, times: r.times, from: r.from, to: r.to })}{" "}
                <span className="font-mono text-muted-foreground">{r.evidenceIds.join(" ")}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/** Container: owns the items (build + deterministic sort) and the selection wiring. */
export function TimelineViewContainer({ graph }: { graph: Graph }) {
  const items = React.useMemo(() => sortTimelineItems(buildTimelineItems(graph)), [graph]);
  const selectNode = useSelection((s) => s.selectNode);
  return <TimelineView items={items} onSelectSubject={selectNode} />;
}
