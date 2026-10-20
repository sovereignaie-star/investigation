import { t } from "@ir/i18n";
import { useEffect, useState, type FormEvent } from "react";
import DOMPurify from "dompurify";
import { getGetCaseEvidenceQueryKey, setAuthTokenGetter, useGetCaseEvidence } from "@workspace/api-client-react";
import { Badge, Button, Input, Label } from "@ir/ui";
import { buildEvidenceView, displayOn, submitDecision, type SubmitTarget } from "./workbench/evidenceViewerModel";
import { EvidenceViewer } from "./workbench/EvidenceViewer";

/**
 * P3-010: the raw-evidence screen. The fetch goes through the generated SDK hook over the
 * same REST contract the server enforces (admin boundary D-037, hash verified server-side),
 * and the display goes through the pure model — DOMPurify sanitize then the sandboxed
 * iframe (ROADMAP 5.6, evidence-injection row: HTML معقّم داخل iframe معزول). Binary
 * evidence is refused honestly (empty content from the transport) rather than corrupted.
 *
 * The token boundary mirrors CasesPage (P1-021/D-033): memory only, no browser storage.
 */

const tokenRef = { current: "" };

type Target = SubmitTarget | null;

/** The id inputs; the pair is emitted upward on submit (empty never fires a request). */
function EvidenceForm({ onTarget }: { onTarget: (pair: SubmitTarget) => void }) {
  const [form, setForm] = useState({ caseId: "", evidenceId: "" });
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (form.caseId.trim() !== "" && form.evidenceId.trim() !== "") {
      onTarget({ caseId: form.caseId.trim(), evidenceId: form.evidenceId.trim() });
    }
  };
  return (
    <form onSubmit={submit} className="grid gap-3 sm:max-w-xl">
      <div className="grid gap-1">
        <Label htmlFor="evidence-case-id">{t("evidence.caseIdLabel")}</Label>
        <Input
          id="evidence-case-id"
          dir="ltr"
          value={form.caseId}
          onChange={(e) => setForm({ ...form, caseId: e.target.value })}
          placeholder={t("evidence.caseIdExample")}
          required
        />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="evidence-evidence-id">{t("evidence.evidenceIdLabel")}</Label>
        <Input
          id="evidence-evidence-id"
          dir="ltr"
          value={form.evidenceId}
          onChange={(e) => setForm({ ...form, evidenceId: e.target.value })}
          placeholder={t("evidence.evidenceIdExample")}
          required
        />
      </div>
      <div>
        <Button type="submit">{t("evidence.view")}</Button>
      </div>
    </form>
  );
}

/** The result area: the error replaces any stale content (displayOn), the view renders below. */
function EvidenceResult(props: {
  isError: boolean;
  errorMessage: string | null;
  evidence: { id: string; mime: string; sha256: string; size: number; fetchedAt: string } | null;
  view: ReturnType<typeof buildEvidenceView> | null;
}) {
  return (
    <>
      {props.isError ? <p className="text-sm text-destructive-text">{props.errorMessage}</p> : null}
      {props.evidence && props.view && displayOn(props.isError, props.evidence !== null) ? (
        <section aria-labelledby="evidence-view" className="rounded-md border border-border p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 id="evidence-view" className="font-semibold">
              {t("evidence.rawView")}
            </h2>
            <Badge dir="ltr">{props.evidence.mime}</Badge>
            <Badge dir="ltr">
              {t("evidence.sha256")} {props.evidence.sha256.slice(0, 12)}…
            </Badge>
            <Badge dir="ltr">{props.evidence.size} B</Badge>
          </div>
          <EvidenceViewer view={props.view} evidenceId={props.evidence.id} fetchedAt={props.evidence.fetchedAt} />
        </section>
      ) : null}
    </>
  );
}

export function EvidencePage() {
  // The admin token for the API boundary (D-037): memory only — nothing is persisted.
  const [token, setToken] = useState<string>(tokenRef.current);
  useEffect(() => {
    setAuthTokenGetter(() => (tokenRef.current === "" ? null : tokenRef.current));
  }, []);
  const saveToken = (value: string): void => {
    tokenRef.current = value;
    setToken(value);
  };

  const [target, setTarget] = useState<Target>(null);

  // The generated hook runs only once a concrete pair is submitted (empty ids never fire).
  const query = useGetCaseEvidence(target?.caseId ?? "", target?.evidenceId ?? "", {
    query: { queryKey: getGetCaseEvidenceQueryKey(target?.caseId ?? "", target?.evidenceId ?? ""), enabled: target !== null, retry: false },
  });

  // A corrected admin token does not change the query key — the same pair must refetch.
  const onTarget = (pair: SubmitTarget): void => {
    const decision = submitDecision(target, pair);
    if (decision.target !== null && decision.refetch) void query.refetch();
    setTarget(decision.target);
  };

  const evidence = query.data?.evidence ?? null;
  const view = evidence ? buildEvidenceView(evidence, { sanitize: (html) => DOMPurify.sanitize(html) }) : null;

  return (
    <div className="space-y-8">
      <header>
        <p className="text-sm text-muted-foreground">{t("evidence.kicker")}</p>
        <h1 className="mt-1 text-xl font-semibold">{t("evidence.title")}</h1>
      </header>

      <section aria-labelledby="token" className="rounded-md border border-border p-4">
        <Label id="token" htmlFor="evidence-admin-token">
          {t("cases.adminToken.label")}
        </Label>
        <p className="mb-2 mt-1 text-xs text-muted-foreground">{t("evidence.adminToken.hint")}</p>
        <Input
          id="evidence-admin-token"
          type="password"
          dir="ltr"
          value={token}
          onChange={(e) => saveToken(e.target.value)}
          placeholder={t("cases.adminToken.placeholder")}
          className="max-w-xs"
        />
      </section>

      <section aria-labelledby="fetch-evidence" className="rounded-md border border-border p-4">
        <h2 id="fetch-evidence" className="mb-3 font-semibold">
          {t("evidence.fetch")}
        </h2>
        <EvidenceForm onTarget={onTarget} />
      </section>

      <EvidenceResult
        isError={query.isError}
        errorMessage={`${t("evidence.error")} (${query.error instanceof Error ? query.error.message : t("cases.list.errorGeneric")})`}
        evidence={evidence}
        view={view}
      />
    </div>
  );
}
