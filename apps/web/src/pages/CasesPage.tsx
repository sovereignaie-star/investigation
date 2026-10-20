import { useEffect, useState, type FormEvent } from "react";
import { setAuthTokenGetter, useCreateCase, useListCases, useUpdateCaseLifecycle, type CreateCaseInput } from "@workspace/api-client-react";
import { Badge, Button, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch, Textarea } from "@ir/ui";
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

const tokenRef = { current: "" };

const LEGAL_BASES: Array<{ value: string; label: string }> = [
  { value: "due_diligence", label: "العناية الواجبة" },
  { value: "fraud_investigation", label: "تحقيق احتيال" },
  { value: "security_incident", label: "حادثة أمنية" },
  { value: "threat_intelligence", label: "استخبارات تهديدات" },
  { value: "journalism", label: "عمل صحفي استقصائي" },
  { value: "litigation_support", label: "دعم تقاضي" },
  { value: "compliance_kyc", label: "امتثال و KYC" },
  { value: "academic_research", label: "بحث أكاديمي" },
  { value: "self_assessment", label: "تقييم ذاتي" },
  { value: "training_simulation", label: "تدريب ومحاكاة" },
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
  const [token, setToken] = useState<string>(tokenRef.current);
  useEffect(() => {
    setAuthTokenGetter(() => (tokenRef.current === "" ? null : tokenRef.current));
  }, []);
  const saveToken = (value: string): void => {
    tokenRef.current = value;
    setToken(value);
  };

  const [includeArchived, setIncludeArchived] = useState(false);
  const list = useListCases(includeArchived ? { includeArchived: true } : undefined);

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
      setError(x instanceof Error ? x.message : "تعذر إنشاء القضية");
    }
  };

  const archive = async (id: string): Promise<void> => {
    setError(null);
    try {
      await lifecycle.mutateAsync({ id, data: { action: "archive", reason: archiveReason } });
      setArchivingId(null);
      setArchiveReason("");
    } catch (x) {
      setError(x instanceof Error ? x.message : "تعذر الأرشفة");
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
      setError(x instanceof Error ? x.message : "تعذر إعادة الفتح — تأكيد الغرض مطلوب");
    }
  };

  return (
    <div className="space-y-8">
      <header>
        <p className="text-sm text-muted-foreground">القضايا</p>
        <h1 className="mt-1 text-xl font-semibold">قضايا التحقيق — إنشاء بغرض، فتح، أرشفة</h1>
      </header>

      <section aria-labelledby="token" className="rounded-md border border-border p-4">
        <Label htmlFor="admin-token">رمز الإدارة</Label>
        <p className="mb-2 mt-1 text-xs text-muted-foreground">
          واجهات القضايا خلف حدود الأدمن — أدخل رمز الإدارة (يبقى في الذاكرة لهذه الجلسة فقط، بلا أي تخزين متصفح).
        </p>
        <Input
          id="admin-token"
          type="password"
          dir="ltr"
          value={token}
          onChange={(e) => saveToken(e.target.value)}
          placeholder="IR_ADMIN_TOKEN"
          className="max-w-xs"
        />
      </section>

      <section aria-labelledby="create-case" className="rounded-md border border-border p-4">
        <h2 id="create-case" className="mb-3 font-semibold">
          إنشاء قضية
        </h2>
        <form onSubmit={submit} className="grid gap-3 sm:max-w-xl">
          <div className="grid gap-1">
            <Label htmlFor="case-title">العنوان</Label>
            <Input
              id="case-title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="عنوان موجز للقضية"
              required
              maxLength={200}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="case-purpose">الغرض</Label>
            <Textarea
              id="case-purpose"
              value={form.purpose}
              onChange={(e) => setForm({ ...form, purpose: e.target.value })}
              placeholder="لماذا هذه القضية؟ غرض موثق (١٠ أحرف على الأقل — بلا غرض لا قضية)"
              required
            />
            <p className="text-xs text-muted-foreground">E-01: لا تُنشأ قضية بلا غرض موثق — عشرة أحرف على الأقل.</p>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="case-legal-basis">الأساس القانوني</Label>
            <Select value={form.legalBasis} onValueChange={(v) => setForm({ ...form, legalBasis: v })}>
              <SelectTrigger id="case-legal-basis">
                <SelectValue placeholder="اختر الأساس" />
              </SelectTrigger>
              <SelectContent>
                {LEGAL_BASES.map((b) => (
                  <SelectItem key={b.value} value={b.value}>
                    {b.label} — <span dir="ltr">{b.value}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="case-passphrase">عبارة المرور (اختياري — تشفير القضية)</Label>
            <Input
              id="case-passphrase"
              type="password"
              dir="ltr"
              value={form.passphrase}
              onChange={(e) => setForm({ ...form, passphrase: e.target.value })}
              placeholder="تُترك فارغة لقضية غير مشفرة"
            />
          </div>
          <div>
            <Button type="submit" disabled={createCase.isPending}>
              {createCase.isPending ? "جارٍ الإنشاء…" : "إنشاء قضية"}
            </Button>
            {created && <Badge className="ms-3">أُنشئت: {created}</Badge>}
            {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
          </div>
        </form>
      </section>

      <section aria-labelledby="case-list" className="rounded-md border border-border p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="case-list" className="font-semibold">
            القضايا
          </h2>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={includeArchived} onCheckedChange={setIncludeArchived} />
            إظهار المؤرشفة
          </label>
        </div>
        {list.isPending ? (
          <p className="text-sm text-muted-foreground">جارٍ تحميل القضايا…</p>
        ) : list.isError ? (
          <p className="text-sm text-destructive">
            تعذر جلب القضايا — تحقق من رمز الإدارة ومن تشغيل الخادم. ({list.error instanceof Error ? list.error.message : "خطأ"})
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
              <Label htmlFor="archive-reason">سبب الأرشفة</Label>
              <Input
                id="archive-reason"
                value={archiveReason}
                onChange={(e) => setArchiveReason(e.target.value)}
                placeholder="مثال: اكتمل التحقيق واعتُمد التقرير"
                required
                minLength={3}
              />
            </div>
            <Button type="submit" variant="outline" disabled={lifecycle.isPending}>
              أرشفة
            </Button>
            <Button type="button" variant="ghost" onClick={() => setArchivingId(null)}>
              إلغاء
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
              <Label htmlFor="reopen-reason">سبب إعادة الفتح</Label>
              <Input
                id="reopen-reason"
                value={reopening.reason}
                onChange={(e) => setReopening({ ...reopening, reason: e.target.value })}
                required
                minLength={3}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="reopen-purpose">تأكيد الغرض (PurposeConfirmation — إلزامي)</Label>
              <Textarea
                id="reopen-purpose"
                value={reopening.purposeConfirmation}
                onChange={(e) => setReopening({ ...reopening, purposeConfirmation: e.target.value })}
                placeholder="غرض صريح لإعادة الفتح (١٠ أحرف على الأقل) — بلا تأكيد غرض لا إعادة فتح"
                required
                minLength={10}
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" variant="outline" disabled={lifecycle.isPending}>
                إعادة فتح
              </Button>
              <Button type="button" variant="ghost" onClick={() => setReopening(null)}>
                إلغاء
              </Button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
