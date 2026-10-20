import { t } from "@ir/i18n";
import * as React from "react";
import { useGetCaseStats } from "@workspace/api-client-react";
import { Button } from "@ir/ui";
import { buildStatsRows, isBlankSnapshot, type InvestigationStatsState } from "./statsModel";

/**
 * P3-012 («إحصاءات القضية»): the InvestigationStats panel. The acceptance
 * criterion «أرقام تطابق الإسقاط» is served end-to-end: the numbers come from
 * GET /cases/:id/stats, which is the case's own projection counts — never a
 * parallel recount in the UI. Loading and error render NO numbers (never the
 * previous case's counts, never zeros dressed up as statistics); a blank
 * snapshot (an empty case) shows its real zeros with an explicit note.
 */

export function InvestigationStatsView({ state }: { state: InvestigationStatsState }) {
  if (state.kind === "loading") {
    return (
      <section data-testid="stats-panel" className="rounded-lg border border-border bg-card p-4">
        <p data-testid="stats-loading" className="text-sm text-muted-foreground">
          {t("cases.stats.loading")}
        </p>
      </section>
    );
  }
  if (state.kind === "error") {
    return (
      <section data-testid="stats-panel" className="rounded-lg border border-border bg-card p-4">
        <p data-testid="stats-error" className="text-sm text-destructive-text">
          {t("cases.stats.error")} {state.message}
        </p>
      </section>
    );
  }
  const { stats } = state;
  const rows = buildStatsRows(stats);
  return (
    <section data-testid="stats-panel" className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">{t("cases.stats.title")}</h3>
        <span dir="ltr" data-testid="stats-seq" className="text-xs tabular-nums text-muted-foreground">
          {t("cases.stats.seq")} {stats.seq}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {rows.map((r) => (
          <div key={r.key} className="rounded border border-border/50 p-2">
            <dt className="text-xs text-muted-foreground">{r.label}</dt>
            <dd dir="ltr" data-testid={`stats-count-${r.key}`} className="text-lg font-semibold tabular-nums">
              {r.value}
            </dd>
          </div>
        ))}
      </dl>
      {isBlankSnapshot(stats) && (
        <p data-testid="stats-blank" className="mt-3 text-xs text-muted-foreground">
          {t("cases.stats.blank")}
        </p>
      )}
    </section>
  );
}

/**
 * The wired panel: fetches the case's stats (the projection counts) and maps
 * the query result to the panel's honest states. Keyed by case id by the
 * caller, so switching cases never shows the previous case's numbers.
 */
export function InvestigationStats({ caseId, onClose }: { caseId: string; onClose: () => void }) {
  const query = useGetCaseStats(caseId);
  const state: InvestigationStatsState = query.isPending
    ? { kind: "loading" }
    : query.isError
      ? { kind: "error", message: query.error instanceof Error ? query.error.message : "خطأ غير معروف" }
      : { kind: "ready", stats: query.data };
  return (
    <div className="space-y-2">
      <InvestigationStatsView state={state} />
      <Button variant="outline" size="sm" data-testid="stats-close" onClick={onClose}>
        {t("cases.stats.close")}
      </Button>
    </div>
  );
}
