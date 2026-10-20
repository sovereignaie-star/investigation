import * as React from "react";
import { getCaseProjection, getListCasesQueryKey, useListCases, type CaseSummary } from "@workspace/api-client-react";
import { Badge, Button, Input, Label } from "@ir/ui";
import { useAdminToken } from "../../utils/adminToken";
import { canOpenCase, parseProjection, toOpenedCase, type OpenedCase } from "./savedInvestigationsModel";

/**
 * P3-015 («التحقيقات المحفوظة — فتح قضية بعد إعادة التشغيل»): the saved-investigations
 * surface of the workbench. The browser keeps no case state (D-033) — a saved case is
 * re-opened from the server through the same admin boundary as every case route (D-037,
 * token in memory only), and the workbench then renders the case's OWN projection
 * snapshot, never a browser rebuild. Rules held here:
 *
 * - J-17: a locked case is listed as an identifier-only row with the locked message and
 *   NO open action — never silently filtered, never openable, never an empty case that
 *   looks like an opened one.
 * - A failed or malformed open is an honest error — never a fabricated empty case.
 * - The opened case's identity (title, seq, sha256) is displayed by the banner, not guessed.
 */

export interface SavedInvestigationsState {
  kind: "idle" | "opening" | "error";
  /** The case being opened (kind: "opening"). */
  id?: string;
  /** The honest error message (kind: "error"). */
  message?: string;
}

interface SavedInvestigationsViewProps {
  cases: CaseSummary[];
  /** The list's own status — a 401 must read as an auth error, never as «no saved cases». */
  listStatus: "loading" | "error" | "success";
  state: SavedInvestigationsState;
  token: string;
  onTokenChange: (token: string) => void;
  onOpen: (c: CaseSummary) => void;
  activeCaseId: string | null;
}

export function SavedInvestigationsView({
  cases,
  listStatus,
  state,
  token,
  onTokenChange,
  onOpen,
  activeCaseId,
}: SavedInvestigationsViewProps) {
  const busy = state.kind === "opening";
  return (
    <section aria-labelledby="saved-investigations" data-testid="saved-investigations" className="rounded-md border border-border p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="saved-investigations" className="font-semibold">
          التحقيقات المحفوظة
        </h2>
        <p className="text-xs text-muted-foreground">فتح قضية محفوظة من الخادم — لا شيء يُخزَّن في المتصفح (D-033).</p>
      </div>
      <div className="mb-3 grid gap-1 sm:max-w-xs">
        <Label htmlFor="saved-token-input">رمز الإدارة</Label>
        <Input
          id="saved-token-input"
          data-testid="saved-token"
          type="password"
          dir="ltr"
          value={token}
          onChange={(e) => onTokenChange(e.target.value)}
          placeholder="IR_ADMIN_TOKEN — للذاكرة فقط"
        />
      </div>
      {listStatus === "loading" && <p className="text-sm text-muted-foreground">جارٍ تحميل القضايا…</p>}
      {listStatus === "error" && (
        <p data-testid="saved-list-error" className="text-sm text-destructive">
          تعذر جلب القضايا — تحقق من رمز الإدارة ومن تشغيل الخادم.
        </p>
      )}
      {listStatus === "success" &&
        (cases.length === 0 ? (
          <p className="text-sm text-muted-foreground">لا قضايا محفوظة بعد — أنشئ قضية من شاشة القضايا ثم افتحها هنا بعد أي إعادة تشغيل.</p>
        ) : (
          <ul className="divide-y divide-border">
            {cases.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0 truncate text-sm" data-testid={`saved-case-${c.id}`}>
                  {c.status === "locked-encrypted" ? (
                    <span dir="ltr" className="font-mono text-xs">
                      {c.id}
                    </span>
                  ) : (
                    (c.title ?? c.id)
                  )}
                </span>
                <span className="flex items-center gap-2">
                  {c.status === "locked-encrypted" && <span className="text-xs text-muted-foreground">مقفلة — تتطلب فك التشفير</span>}
                  {activeCaseId === c.id && (
                    <Badge data-testid={`opened-badge-${c.id}`} className="text-xs">
                      مفتوحة في المحطة
                    </Badge>
                  )}
                  {canOpenCase(c) && (
                    <Button size="sm" variant="outline" data-testid={`open-case-${c.id}`} disabled={busy} onClick={() => onOpen(c)}>
                      {busy && state.id === c.id ? "جارٍ الفتح…" : "فتح في المحطة"}
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        ))}
      {state.kind === "error" && (
        <p data-testid="saved-error" className="mt-2 text-sm text-destructive">
          تعذر فتح القضية: {state.message}
        </p>
      )}
    </section>
  );
}

/** The banner that names the opened case — its identity is displayed, not guessed. */
export function OpenedCaseBanner({ opened, onClose }: { opened: OpenedCase; onClose: () => void }) {
  return (
    <section
      data-testid="opened-case-banner"
      aria-label="القضية المفتوحة"
      className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card p-3"
    >
      <span className="text-sm font-semibold">مفتوحة في المحطة: {opened.title ?? opened.id}</span>
      <span dir="ltr" data-testid="opened-seq" className="text-xs tabular-nums text-muted-foreground">
        seq {opened.seq}
      </span>
      <span dir="ltr" data-testid="opened-sha" className="max-w-[16rem] truncate font-mono text-[11px] text-muted-foreground">
        {opened.sha256}
      </span>
      <Button size="sm" variant="ghost" onClick={onClose}>
        إغلاق القضية المفتوحة
      </Button>
    </section>
  );
}

/** The wired surface: the list comes from the generated hook, the open fetches the snapshot. */
export function SavedInvestigations({ onOpen, activeCaseId }: { onOpen: (c: OpenedCase) => void; activeCaseId: string | null }) {
  const [token, setToken] = useAdminToken();
  // The token is part of the query key: entering (or changing) the token refetches
  // the list — a fresh session starts at an honest 401 state, and the token turns
  // it into the saved list (the cold-browser flow of the acceptance).
  const list = useListCases(undefined, { query: { queryKey: [...getListCasesQueryKey(), token] } });
  const [state, setState] = React.useState<SavedInvestigationsState>({ kind: "idle" });

  const open = async (row: CaseSummary): Promise<void> => {
    setState({ kind: "opening", id: row.id });
    try {
      const body = await getCaseProjection(row.id);
      const snapshot = parseProjection(body as unknown);
      if (!snapshot) {
        // Fail-closed: a malformed snapshot never becomes an "opened" empty case.
        setState({ kind: "error", message: "استجابة الإسقاط غير صالحة — لم تُفتح القضية" });
        return;
      }
      setState({ kind: "idle" });
      onOpen(toOpenedCase(row, snapshot));
    } catch (x) {
      setState({ kind: "error", message: x instanceof Error ? x.message : "خطأ غير معروف" });
    }
  };

  return (
    <SavedInvestigationsView
      cases={list.data?.cases ?? []}
      listStatus={list.isPending ? "loading" : list.isError ? "error" : "success"}
      state={state}
      token={token}
      onTokenChange={setToken}
      onOpen={(c) => void open(c)}
      activeCaseId={activeCaseId}
    />
  );
}
