import { useState, type FormEvent } from "react";
import {
  getListCasesQueryKey,
  useCreateCase,
  useListCases,
  useUpdateCaseLifecycle,
  type CreateCaseInput,
} from "@workspace/api-client-react";
import { Badge, Button, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch, Textarea } from "@ir/ui";
// P3-017: every UI string comes from @ir/i18n.
import { t } from "@ir/i18n";
import { useAdminToken } from "../utils/adminToken";
import { CasesTable } from "./cases/CasesTable";
import { InvestigationStats } from "./cases/InvestigationStats";

/**
 * P3-003 (طلب ب): the cases screen, wired to the generated SDK. The workbench speaks to
 * the same REST contract the server enforces:
 *
 * - UC-01: a case is created with a stated purpose (E-01 — the API rejects a short purpose).
 * - J-16: archived cases are hidden until the toggle is on; archiving asks for a reason;
 *   reopening is explicit and the server requires a PurposeConfirmation (E-02).
 * - J-17: a locked case renders as an identifier-only row (the API sends no content).
 *
 * The API boundary is the admin token (the same requireAdmin the engine and vault use).
 * P1-021/D-033: the browser storage stays empty — the token lives in memory only and is
 * re-entered per session (the generated client's auth getter reads the ref below).
 */

// P3-017: the labels are dictionary keys — they resolve at render time, so a
// locale switch re-renders them (a module-level t() call would freeze the
// import-time locale).
const LEGAL_BASES: Array<{
  value: string;
  key:
    | "cases.legalBasis.due_diligence"
    | "cases.legalBasis.fraud_investigation"
    | "cases.legalBasis.security_incident"
    | "cases.legalBasis.threat_intelligence"
    | "cases.legalBasis.journalism"
    | "cases.legalBasis.litigation_support"
    | "cases.legalBasis.compliance_kyc"
    | "cases.legalBasis.academic_research"
    | "cases.legalBasis.self_assessment"
    | "cases.legalBasis.training_simulation";
}> = [
  { value: "due_diligence", key: "cases.legalBasis.due_diligence" },
  { value: "fraud_investigation", key: "cases.legalBasis.fraud_investigation" },
  { value: "security_incident", key: "cases.legalBasis.security_incident" },
  { value: "threat_intelligence", key: "cases.legalBasis.threat_intelligence" },
  { value: "journalism", key: "cases.legalBasis.journalism" },
  { value: "litigation_support", key: "cases.legalBasis.litigation_support" },
  { value: "compliance_kyc", key: "cases.legalBasis.compliance_kyc" },
  { value: "academic_research", key: "cases.legalBasis.academic_research" },
  { value: "self_assessment", key: "cases.legalBasis.self_assessment" },
  { value: "training_simulation", key: "cases.legalBasis.training_simulation" },
];

type FormState = {
  title: string;
  purpose: string;
  legalBasis: string;
  passphrase: string;
};

const EMPTY_FORM: FormState = { title: "", purpose: "", legalBasis: "", passphrase: "" };

export function CasesPage() {
  // The admin token for the API boundary (D-037): memory only — nothing is persisted.
  // P3-015: the app-wide one-ref token (shared with the workbench surfaces) — one
  // getter installed at module load, no page can shadow another's token.
  const [token, saveToken] = useAdminToken();

  const [includeArchived, setIncludeArchived] = useState(false);
  // P3-015: the token is part of the query key — entering it refetches the list (the
  // cold-browser flow: the first fetch without a token is an honest 401, and the token
  // turns it into the saved list). The same contract SavedInvestigations holds.
  const list = useListCases(includeArchived ? { includeArchived: true } : undefined, {
    query: { queryKey: [...getListCasesQueryKey(), includeArchived, token] },
  });

  const createCase = useCreateCase({ mutation: { onSuccess: () => void list.refetch() } });
  const lifecycle = useUpdateCaseLifecycle({ mutation: { onSuccess: () => void list.refetch() } });

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // J-16: archiving asks for a reason; reopening is explicit and needs the E-02 confirmation.
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [archiveReason, setArchiveReason] = useState("");

  // P3-012: the case whose stats panel is open (null = closed).
  const [statsFor, setStatsFor] = useState<string | null>(null);
  const [reopening, setReopening] = useState<{ id: string; reason: string; purposeConfirmation: string } | null>(null);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setCreated(null);
    try {
      const c = await createCase.mutateAsync({
        data: {
          title: form.title,
          purpose: form.purpose,
          legalBasis: form.legalBasis as CreateCaseInput["legalBasis"],
          ...(form.passphrase ? { passphrase: form.passphrase } : {}),
        },
      });
      setCreated(c.title);
      setForm(EMPTY_FORM);
    } catch (x) {
      setError(x instanceof Error ? x.message : t("cases.create.error"));
    }
  };

  const archive = async (id: string): Promise<void> => {
    setError(null);
    try {
      await lifecycle.mutateAsync({ id, data: { action: "archive", reason: archiveReason } });
      setArchivingId(null);
      setArchiveReason("");
    } catch (x) {
      setError(x instanceof Error ? x.message : t("cases.archive.error"));
    }
  };

  const reopen = async (): Promise<void> => {
    if (!reopening) return;
    setError(null);
    try {
      await lifecycle.mutateAsync({
        id: reopening.id,
        data: { action: "unarchive", reason: reopening.reason, purposeConfirmation: reopening.purposeConfirmation },
      });
      setReopening(null);
    } catch (x) {
      setError(x instanceof Error ? x.message : t("cases.reopen.error"));
    }
  };

  return (
    <div className="space-y-8">
      <header>
        <p className="text-sm text-muted-foreground">{t("cases.header.kicker")}</p>
        <h1 className="mt-1 text-xl font-semibold">{t("cases.header.title")}</h1>
      </header>

      <section aria-labelledby="token" className="rounded-md border border-border p-4">
        <Label id="token" htmlFor="admin-token">
          {t("cases.adminToken.label")}
        </Label>
        <p className="mb-2 mt-1 text-xs text-muted-foreground">{t("cases.adminToken.hint")}</p>
        <Input
          id="admin-token"
          type="password"
          dir="ltr"
          value={token}
          onChange={(e) => saveToken(e.target.value)}
          placeholder={t("cases.adminToken.placeholder")}
          className="max-w-xs"
        />
      </section>

      <section aria-labelledby="create-case" className="rounded-md border border-border p-4">
        <h2 id="create-case" className="mb-3 font-semibold">
          {t("cases.create.title")}
        </h2>
        <form onSubmit={submit} className="grid gap-3 sm:max-w-xl">
          <div className="grid gap-1">
            <Label htmlFor="case-title">{t("cases.create.titleLabel")}</Label>
            <Input
              id="case-title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder={t("cases.create.titlePlaceholder")}
              required
              maxLength={200}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="case-purpose">{t("cases.create.purposeLabel")}</Label>
            <Textarea
              id="case-purpose"
              value={form.purpose}
              onChange={(e) => setForm({ ...form, purpose: e.target.value })}
              placeholder={t("cases.create.purposePlaceholder")}
              required
            />
            <p className="text-xs text-muted-foreground">{t("cases.create.e01")}</p>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="case-legal-basis">{t("cases.create.legalBasisLabel")}</Label>
            <Select value={form.legalBasis} onValueChange={(v) => setForm({ ...form, legalBasis: v })}>
              <SelectTrigger id="case-legal-basis">
                <SelectValue placeholder={t("cases.create.legalBasisPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {LEGAL_BASES.map((b) => (
                  <SelectItem key={b.value} value={b.value}>
                    {t(b.key)} — <span dir="ltr">{b.value}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="case-passphrase">{t("cases.create.passphraseLabel")}</Label>
            <Input
              id="case-passphrase"
              type="password"
              dir="ltr"
              value={form.passphrase}
              onChange={(e) => setForm({ ...form, passphrase: e.target.value })}
              placeholder={t("cases.create.passphrasePlaceholder")}
            />
          </div>
          <div>
            <Button type="submit" data-testid="create-case-submit" disabled={createCase.isPending}>
              {createCase.isPending ? t("cases.create.submitting") : t("cases.create.submit")}
            </Button>
            {created && (
              <Badge data-testid="create-case-status" className="ms-3">
                {t("cases.create.created", { title: created })}
              </Badge>
            )}
            {error && (
              <p data-testid="create-case-error" className="mt-2 text-sm text-destructive-text">
                {error}
              </p>
            )}
          </div>
        </form>
      </section>

      <section aria-labelledby="case-list" className="rounded-md border border-border p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="case-list" className="font-semibold">
            {t("cases.list.title")}
          </h2>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={includeArchived} onCheckedChange={setIncludeArchived} />
            {t("cases.list.showArchived")}
          </label>
        </div>
        {list.isPending ? (
          <p className="text-sm text-muted-foreground">{t("cases.list.loading")}</p>
        ) : list.isError ? (
          <p className="text-sm text-destructive-text">
            {t("cases.list.error")} ({list.error instanceof Error ? list.error.message : t("cases.list.errorGeneric")})
          </p>
        ) : (
          <CasesTable
            cases={list.data?.cases ?? []}
            includeArchived={includeArchived}
            onArchive={(id) => {
              setArchivingId(id);
              setArchiveReason("");
            }}
            onReopen={(id) => setReopening({ id, reason: "", purposeConfirmation: "" })}
            onStats={(id) => setStatsFor((prev) => (prev === id ? null : id))}
            exportToken={token}
          />
        )}
        {/* P3-012: keyed by case id — switching cases never shows the previous
            case's numbers (the panel restarts in its loading state). */}
        {statsFor && <InvestigationStats key={statsFor} caseId={statsFor} onClose={() => setStatsFor(null)} />}
        {archivingId && (
          <form
            className="mt-3 flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void archive(archivingId);
            }}
          >
            <div className="grid flex-1 gap-1">
              <Label htmlFor="archive-reason">{t("cases.archive.reasonLabel")}</Label>
              <Input
                id="archive-reason"
                value={archiveReason}
                onChange={(e) => setArchiveReason(e.target.value)}
                placeholder={t("cases.archive.reasonPlaceholder")}
                required
                minLength={3}
              />
            </div>
            <Button type="submit" variant="outline" disabled={lifecycle.isPending}>
              {t("cases.archive.submit")}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setArchivingId(null)}>
              {t("common.cancel")}
            </Button>
          </form>
        )}
        {reopening && (
          <form
            className="mt-3 grid gap-2 sm:max-w-xl"
            onSubmit={(e) => {
              e.preventDefault();
              void reopen();
            }}
          >
            <div className="grid gap-1">
              <Label htmlFor="reopen-reason">{t("cases.reopen.reasonLabel")}</Label>
              <Input
                id="reopen-reason"
                value={reopening.reason}
                onChange={(e) => setReopening({ ...reopening, reason: e.target.value })}
                required
                minLength={3}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="reopen-purpose">{t("cases.reopen.purposeLabel")}</Label>
              <Textarea
                id="reopen-purpose"
                value={reopening.purposeConfirmation}
                onChange={(e) => setReopening({ ...reopening, purposeConfirmation: e.target.value })}
                placeholder={t("cases.reopen.purposePlaceholder")}
                required
                minLength={10}
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" variant="outline" disabled={lifecycle.isPending}>
                {t("cases.reopen.submit")}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setReopening(null)}>
                {t("common.cancel")}
              </Button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
