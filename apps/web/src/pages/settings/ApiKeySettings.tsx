/**
 * P3-013 (UC-20, D-003, D-030): ApiKeySettings — the key-management surface.
 *
 * The acceptance criterion is «لا يظهر المفتاح في أي سجل أو رابط»: the secret is
 * typed into a password field, PUT once to the server-side vault
 * (apiKeyManager.set — the browser keeps nothing), and never echoed — the vault
 * never returns it, the input is cleared after save, and no URL carries it.
 *
 * The one-time legacy localStorage migration (D-030) is wired HERE: reading the
 * vault runs migrateLegacyKeys() first, which moves any keys older builds left
 * in localStorage to the vault and deletes the local copy.
 */
import { useCallback, useRef, useState, type ReactElement } from "react";
import { Badge, Button, Input, Label } from "@ir/ui";
import { API_KEY_DEFINITIONS, apiKeyManager } from "../../utils/apiKeyManager";
import {
  buildKeyRows,
  formatSaveOutcome,
  migrationFailureNotice,
  migrationNotice,
  runReadCycle,
  type ApiKeySettingsState,
  type KeyActionResult,
  type KeyRowView,
  type MigrationReport,
} from "./apiKeySettingsModel";

/**
 * The interactive surface the wired component passes in. The presentational view
 * renders without it (static markup tests) — the secret travels only between
 * the input and apiKeyManager, never into a URL or a log.
 */
export type KeyRowActions = {
  secretFor(key: string): string;
  setSecret(key: string, value: string): void;
  save(key: string): void;
  test(key: string): void;
  remove(key: string): void;
};

/** Presentational — no secrets, no fetches: only the honest states. */
export function ApiKeySettingsView({ state, actions }: { state: ApiKeySettingsState; actions?: KeyRowActions }): ReactElement {
  return (
    <section data-testid="keys-panel" aria-label="إعدادات المفاتيح">
      <h2>مفاتيح المزوّدين</h2>
      {state.kind === "idle" && (
        <p data-testid="keys-idle" className="text-muted-foreground">
          أدخل رمز الإدارة أعلاه ثم اضغط «قراءة الخزنة».
        </p>
      )}
      {state.kind === "loading" && (
        <p data-testid="keys-loading" className="text-muted-foreground">
          جارٍ قراءة حالة الخزنة…
        </p>
      )}
      {state.kind === "error" && (
        <p data-testid="keys-error" role="alert" className="text-destructive">
          {state.message}
        </p>
      )}
      {state.kind === "ready" && (
        <>
          {state.migrationFailed === true && (
            <p data-testid="keys-migration-failed" role="alert" className="text-sm text-destructive">
              {migrationFailureNotice()}
            </p>
          )}
          {state.migration !== null && (
            <p data-testid="keys-migration" className="text-sm text-muted-foreground">
              {migrationNotice(state.migration)}
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            المفاتيح تُحفظ في خزنة الخادم المختومة — لا يبقى شيء في المتصفح، والمفتاح لا يُعرض بعد الحفظ.
          </p>
          <div className="space-y-4">
            {state.rows.map((row) => (
              <KeyRow
                key={row.key}
                row={row}
                message={state.messages?.[row.key] ?? null}
                busy={state.busy?.[row.key] ?? false}
                actions={actions}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function KeyRow({
  row,
  message,
  busy,
  actions,
}: {
  row: KeyRowView;
  message: KeyActionResult | null;
  busy: boolean;
  actions?: KeyRowActions;
}): ReactElement {
  const secret = actions ? actions.secretFor(row.key) : "";
  return (
    <div data-testid={`key-row-${row.key}`} className="rounded-md border border-border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{row.label}</span>
        <Badge data-testid={`key-badge-${row.key}`}>{row.configured ? "مُعد" : "غير مُعد"}</Badge>
        {row.updatedAt !== null && (
          <span data-testid={`key-updated-${row.key}`} className="text-xs text-muted-foreground" dir="ltr">
            {row.updatedAt}
          </span>
        )}
        {row.link !== "" && (
          <a href={row.link} target="_blank" rel="noreferrer" className="text-xs underline">
            وثائق المزوّد
          </a>
        )}
      </div>
      {row.description !== "" && <p className="mt-1 text-xs text-muted-foreground">{row.description}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Input
          data-testid={`key-secret-${row.key}`}
          type="password"
          value={secret}
          onChange={(e) => actions?.setSecret(row.key, e.target.value)}
          placeholder={row.placeholder !== "" ? row.placeholder : "مفتاح جديد"}
          className="max-w-xs"
          autoComplete="off"
        />
        <Button data-testid={`key-save-${row.key}`} disabled={busy || secret.length === 0} onClick={() => actions?.save(row.key)}>
          حفظ
        </Button>
        <Button
          data-testid={`key-test-${row.key}`}
          disabled={busy || !row.configured}
          variant="outline"
          onClick={() => actions?.test(row.key)}
        >
          اختبار
        </Button>
        <Button
          data-testid={`key-delete-${row.key}`}
          disabled={busy || !row.configured}
          variant="outline"
          onClick={() => actions?.remove(row.key)}
        >
          حذف
        </Button>
      </div>
      {message !== null && (
        <p
          data-testid={`key-message-${row.key}`}
          role="status"
          className={message.success ? "mt-2 text-xs" : "mt-2 text-xs text-destructive"}
        >
          {message.message}
        </p>
      )}
    </div>
  );
}

/**
 * Wired — the admin token lives in memory only (D-037). «قراءة الخزنة» runs the
 * one-time legacy migration (only marked done when it succeeds — a wrong token
 * means an honest retry) and then loads the statuses.
 */
export function ApiKeySettings(): ReactElement {
  const [token, setToken] = useState("");
  const [state, setState] = useState<ApiKeySettingsState>({ kind: "idle" });
  const [migrationFailed, setMigrationFailed] = useState(false);
  const [messages, setMessages] = useState<Record<string, KeyActionResult>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const migratedRef = useRef(false);

  const load = useCallback(
    async (migration: MigrationReport | null): Promise<void> => {
      setState({ kind: "loading" });
      try {
        const statuses = await apiKeyManager.status();
        setState({ kind: "ready", rows: buildKeyRows(API_KEY_DEFINITIONS, statuses), migration, migrationFailed });
      } catch (x) {
        setState({ kind: "error", message: (x as Error).message });
      }
    },
    [migrationFailed],
  );

  /**
   * Reads the vault — the whole flow lives in runReadCycle (tested there): the migration
   * runs first and only once per session, the one-time flag is set ONLY for a complete
   * report (conflict-free and failure-free), and a conflict, a partial failure or a
   * corrupt copy stays retryable on the next read with its failure surfaced.
   */
  const onRead = useCallback((): void => {
    void (async () => {
      const outcome = await runReadCycle(apiKeyManager, migratedRef.current);
      migratedRef.current = outcome.complete;
      setMigrationFailed(outcome.failed);
      if (outcome.statuses === null) {
        setState({ kind: "error", message: outcome.error ?? "خطأ في قراءة الخزنة" });
        return;
      }
      setState({
        kind: "ready",
        rows: buildKeyRows(API_KEY_DEFINITIONS, outcome.statuses),
        migration: outcome.report,
        migrationFailed: outcome.failed,
      });
    })();
  }, []);

  /** Refreshes the rows after an action, keeping the one-time migration report. */
  const refresh = useCallback((): void => {
    const ready = state.kind === "ready" ? state : null;
    void load(ready?.migration ?? null);
  }, [load, state]);

  const run = useCallback(
    (key: string, action: () => Promise<KeyActionResult>): void => {
      setBusy((b) => ({ ...b, [key]: true }));
      void (async () => {
        try {
          const result = await action();
          setMessages((m) => ({ ...m, [key]: result }));
        } catch (x) {
          setMessages((m) => ({ ...m, [key]: { success: false, message: (x as Error).message } }));
        } finally {
          setBusy((b) => ({ ...b, [key]: false }));
          refresh();
        }
      })();
    },
    [refresh],
  );

  const actions: KeyRowActions = {
    secretFor: (key) => secrets[key] ?? "",
    setSecret: (key, value) => setSecrets((s) => ({ ...s, [key]: value })),
    save: (key) => {
      const secret = secrets[key] ?? "";
      if (secret.length === 0) return;
      run(key, async () => {
        const saved = await apiKeyManager.set(key, secret);
        setSecrets((s) => ({ ...s, [key]: "" })); // the secret never stays in the input
        return formatSaveOutcome(saved);
      });
    },
    test: (key) => {
      run(key, async () => {
        const t = await apiKeyManager.test(key);
        return { success: t.success, message: t.message };
      });
    },
    remove: (key) => {
      run(key, async () => {
        await apiKeyManager.delete(key);
        return { success: true, message: "حُذف المفتاح من الخزنة" };
      });
    },
  };

  return (
    <div className="space-y-6">
      <section className="rounded-md border border-border p-4">
        <Label htmlFor="settings-admin-token">رمز الإدارة</Label>
        <p className="mb-2 mt-1 text-xs text-muted-foreground">
          الخزنة خلف حد الأدمن — أدخل رمز الإدارة (يبقى في الذاكرة لهذه الجلسة فقط، بلا أي تخزين متصفح).
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id="settings-admin-token"
            type="password"
            dir="ltr"
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              apiKeyManager.setAdminToken(e.target.value);
            }}
            placeholder="IR_ADMIN_TOKEN"
            className="max-w-xs"
            autoComplete="off"
          />
          <Button data-testid="keys-read" onClick={onRead}>
            قراءة الخزنة
          </Button>
        </div>
      </section>
      <ApiKeySettingsView state={state.kind === "ready" ? { ...state, messages, busy, migrationFailed } : state} actions={actions} />
    </div>
  );
}
