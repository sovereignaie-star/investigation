import * as React from "react";
import { t } from "@ir/i18n";
import { acceptCaseMerge, getCaseMergeSuggestions, listCaseMerges, revertCaseMerge } from "@workspace/api-client-react";
import type { MergeSuggestions, StoredMerge } from "@workspace/api-client-react";

/**
 * P4-005 (UC-11 «مراجعة الدمج»): the merge-review panel. The write surface of
 * the merge feature — suggestions on EXPLICIT request only (opening the panel
 * IS the request; no background job ever computes suggestions), a
 * human-accepted merge through the REAL API (POST /cases/:id/merges — a
 * merge.decided entry in the case's own hash-chained ledger), and a revert
 * that restores the case's semantic state (a merge.reverted event — both
 * events stay in the valid ledger).
 *
 * Honesty rules baked into the design:
 * - the score is displayed as «درجة مطابقة» (a match score), NEVER as a
 *   calibrated confidence; a strong suggestion is still a SUGGESTION — the
 *   accept button is the human's explicit decision (D9: no automatic merge);
 * - every write ends with a refreshed projection (refreshCase) — a merge that
 *   vanishes on the next read is a dead feature;
 * - a stale suggestion (the case changed in between) fails with an honest
 *   message and the panel re-fetches — never a silent overwrite.
 */
export function MergeReview({
  caseId,
  nodeNames,
  onClose,
  onSaved,
}: {
  caseId: string | null;
  /** id -> display name of the current nodes (labels.ar ?? labels.en ?? canonicalKey). */
  nodeNames: Map<string, string>;
  onClose: () => void;
  /** Called after every successful write — the caller re-reads the case's projection. */
  onSaved: () => Promise<void> | void;
}) {
  if (caseId === null) return null;
  return <Body key={caseId} caseId={caseId} nodeNames={nodeNames} onClose={onClose} onSaved={onSaved} />;
}

function Body({
  caseId,
  nodeNames,
  onClose,
  onSaved,
}: {
  caseId: string;
  nodeNames: Map<string, string>;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [suggestions, setSuggestions] = React.useState<MergeSuggestions | null>(null);
  const [merges, setMerges] = React.useState<StoredMerge[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const reload = React.useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      // The explicit request: both lists are fetched when the panel opens and
      // after every write — the panel never shows a stale suggestion as current.
      const [s, m] = await Promise.all([getCaseMergeSuggestions(caseId), listCaseMerges(caseId)]);
      setSuggestions(s);
      setMerges(m.merges);
    } catch {
      setError(t("commands.mergeReview.loadFailed"));
    } finally {
      setBusy(false);
    }
  }, [caseId]);

  // The initial explicit request. The fetch's setState calls all happen AFTER the
  // first await (never synchronously within the effect — no cascading renders).
  React.useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const [sg, ml] = await Promise.all([getCaseMergeSuggestions(caseId), listCaseMerges(caseId)]);
        if (cancelled) return;
        setSuggestions(sg);
        setMerges(ml.merges);
      } catch {
        if (!cancelled) setError(t("commands.mergeReview.loadFailed"));
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [caseId]);

  const accept = async (aId: string, bId: string, survivorId: string): Promise<void> => {
    if (suggestions === null) return;
    setBusy(true);
    setError(null);
    try {
      await acceptCaseMerge(caseId, {
        entityIds: [aId, bId],
        survivorId,
        modelVersion: suggestions.modelVersion,
        caseVersion: suggestions.caseVersion,
      });
      await onSaved();
      await reload();
    } catch {
      // refresh first (the panel never shows a stale suggestion as current),
      // THEN surface the honest error — reload() clears it, so it is set after.
      await reload();
      setError(t("commands.mergeReview.staleOrFailed"));
    } finally {
      setBusy(false);
    }
  };

  const revert = async (mergeId: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await revertCaseMerge(caseId, mergeId);
      await onSaved();
      await reload();
    } catch {
      setError(t("commands.mergeReview.revertFailed"));
    } finally {
      setBusy(false);
    }
  };

  const nameOf = (id: string): string => nodeNames.get(id) ?? id;

  return (
    <div
      data-testid="merge-review"
      role="dialog"
      aria-modal="true"
      aria-label={t("commands.mergeReview.title")}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-md border border-border bg-background p-4 shadow-lg">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-semibold">{t("commands.mergeReview.title")}</h2>
          <button
            type="button"
            data-testid="merge-review-close"
            className="rounded border border-border px-2 py-1 text-sm"
            onClick={onClose}
          >
            {t("commands.note.cancel")}
          </button>
        </div>

        {error ? (
          <p data-testid="merge-review-error" className="mb-2 text-sm text-destructive-text">
            {error}
          </p>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto">
          <section aria-label={t("commands.mergeReview.suggestionsTitle")}>
            <h3 className="mb-2 text-sm font-medium">{t("commands.mergeReview.suggestionsTitle")}</h3>
            {suggestions !== null && suggestions.suggestions.length === 0 ? (
              <p data-testid="merge-review-empty" className="text-sm text-muted-foreground">
                {t("commands.mergeReview.noSuggestions")}
              </p>
            ) : null}
            <ul>
              {(suggestions?.suggestions ?? []).map((s) => (
                <li key={`${s.aId}|${s.bId}`} data-testid="merge-suggestion" className="mb-3 rounded border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{nameOf(s.aId)}</span>
                    <span aria-hidden>↔</span>
                    <span className="text-sm font-medium">{nameOf(s.bId)}</span>
                    <span
                      data-testid="merge-suggestion-decision"
                      className={
                        s.decision === "strong"
                          ? "rounded bg-primary px-2 py-0.5 text-xs text-primary-foreground"
                          : "rounded border border-border px-2 py-0.5 text-xs"
                      }
                    >
                      {s.decision === "strong" ? t("commands.mergeReview.strong") : t("commands.mergeReview.review")}
                    </span>
                    {/* درجة مطابقة — NOT a confidence (see the component doc) */}
                    <span className="text-xs text-muted-foreground">
                      {t("commands.mergeReview.score")}: {s.score.toFixed(2)}
                    </span>
                  </div>
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-muted-foreground">{t("commands.mergeReview.reasons")}</summary>
                    <ul className="mt-1 list-inside list-disc text-xs text-muted-foreground">
                      {s.reasons.map((r, i) => (
                        <li key={i}>
                          {r.detail} ({r.weight.toFixed(2)})
                        </li>
                      ))}
                    </ul>
                  </details>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-xs">{t("commands.mergeReview.survivor")}:</span>
                    {[s.aId, s.bId].map((id) => (
                      <button
                        key={id}
                        type="button"
                        data-testid="merge-accept"
                        className="rounded border border-border px-2 py-1 text-xs disabled:opacity-50"
                        disabled={busy}
                        onClick={() => void accept(s.aId, s.bId, id)}
                      >
                        {nameOf(id)}
                      </button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section aria-label={t("commands.mergeReview.logTitle")} className="mt-4">
            <h3 className="mb-2 text-sm font-medium">{t("commands.mergeReview.logTitle")}</h3>
            {merges !== null && merges.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("commands.mergeReview.noMerges")}</p>
            ) : null}
            <ul>
              {(merges ?? []).map((m) => (
                <li
                  key={m.id}
                  data-testid="merge-log-entry"
                  className="mb-2 flex flex-wrap items-center gap-2 rounded border border-border p-2"
                >
                  <span className="text-sm">
                    {m.entityIds.map((id) => nameOf(id)).join(" + ")} → {nameOf(m.survivorId)}
                  </span>
                  {m.reverted ? (
                    <span
                      data-testid="merge-reverted-badge"
                      className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground"
                    >
                      {t("commands.mergeReview.reverted")}
                    </span>
                  ) : (
                    <button
                      type="button"
                      data-testid="merge-revert"
                      className="rounded border border-border px-2 py-1 text-xs disabled:opacity-50"
                      disabled={busy}
                      onClick={() => void revert(m.id)}
                    >
                      {t("commands.mergeReview.revert")}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>

        {busy ? <p className="mt-2 text-xs text-muted-foreground">{t("commands.mergeReview.busy")}</p> : null}
      </div>
    </div>
  );
}
