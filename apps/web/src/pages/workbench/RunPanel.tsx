import * as React from "react";
import { ApiError, cancelRun, setAuthTokenGetter, submitRun } from "@workspace/api-client-react";

import { openRunEvents, readSseStream } from "./runEventsModel";
import { initialRunPanelState, runPanelReducer, type RunPanelState } from "./runPanelModel";

/**
 * P3-011 (تقدم التشغيل الحي والإلغاء): the run panel — submit a run (kind +
 * canonicalInput), watch its phases arrive live over SSE, and cancel it. The
 * view renders the honest state machine (runPanelModel); the wiring below feeds
 * it from the real API (memory-only token pattern, same as the other pages).
 */

export interface RunPanelForm {
  kind: string;
  canonicalInput: string;
}

export interface RunPanelViewProps {
  state: RunPanelState;
  form: RunPanelForm;
  token: string;
  onFormChange: (form: RunPanelForm) => void;
  onTokenChange: (token: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

const PHASE_LABELS: Record<string, string> = {
  queued: "في الانتظار",
  running: "قيد التشغيل",
  succeeded: "اكتمل بنجاح",
  failed: "فشل",
  cancelled: "أُلغي",
};

/** The presentational panel: renders the state machine, emits user intents. */
export function RunPanelView({ state, form, token, onFormChange, onTokenChange, onSubmit, onCancel }: RunPanelViewProps) {
  return (
    <section data-testid="run-panel" className="flex flex-col gap-3 rounded-md border border-border p-4">
      <h2 className="text-base font-semibold">تشغيل المحرك</h2>
      <label className="flex flex-col gap-1 text-sm">
        <span>رمز المدير (Admin token)</span>
        <input
          data-testid="run-token-input"
          type="password"
          value={token}
          onChange={(e) => onTokenChange(e.target.value)}
          autoComplete="off"
          className="rounded border border-border px-2 py-1"
        />
      </label>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span>نوع التشغيل (kind)</span>
          <input
            data-testid="run-kind-input"
            value={form.kind}
            onChange={(e) => onFormChange({ ...form, kind: e.target.value })}
            className="rounded border border-border px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>المدخل القياسي (canonicalInput)</span>
          <input
            data-testid="run-input-input"
            value={form.canonicalInput}
            onChange={(e) => onFormChange({ ...form, canonicalInput: e.target.value })}
            className="rounded border border-border px-2 py-1"
          />
        </label>
      </div>
      {state.kind === "idle" || state.kind === "submit-error" ? (
        <div className="flex flex-col items-start gap-2">
          <button
            data-testid="run-submit"
            type="button"
            onClick={onSubmit}
            disabled={form.kind === "" || form.canonicalInput === ""}
            className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            أرسل التشغيل
          </button>
          {state.kind === "submit-error" ? (
            <p data-testid="run-submit-error" className="text-sm text-destructive">
              فشل الإرسال: {state.message}
            </p>
          ) : null}
        </div>
      ) : null}
      {state.kind === "submitting" ? (
        <p data-testid="run-submitting" className="text-sm">
          جارٍ الإرسال…
        </p>
      ) : null}
      {state.kind === "live" ? (
        <div className="flex flex-col items-start gap-2">
          <p data-testid="run-runid" className="font-mono text-xs">
            {state.runId}
          </p>
          <ol data-testid="run-phases" className="flex flex-wrap gap-1 text-xs">
            {state.phases.map((phase, i) => (
              <li key={`${phase}-${i}`} className="rounded border border-border px-2 py-0.5">
                {PHASE_LABELS[phase] ?? phase}
              </li>
            ))}
          </ol>
          <button
            data-testid="run-cancel"
            type="button"
            onClick={onCancel}
            disabled={state.cancelling}
            className="rounded bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground disabled:opacity-50"
          >
            {state.cancelling ? "جارٍ الإلغاء…" : "ألغِ التشغيل"}
          </button>
          {state.notice ? (
            <p data-testid="run-notice" className="text-sm text-destructive">
              {state.notice}
            </p>
          ) : null}
        </div>
      ) : null}
      {state.kind === "terminal" ? (
        <div data-testid="run-terminal" className="flex flex-col items-start gap-2">
          <p className="font-mono text-xs">{state.runId}</p>
          <ol className="flex flex-wrap gap-1 text-xs">
            {state.phases.map((phase, i) => (
              <li key={`${phase}-${i}`} className="rounded border border-border px-2 py-0.5">
                {PHASE_LABELS[phase] ?? phase}
              </li>
            ))}
          </ol>
          <p className="text-sm font-medium">النتيجة: {PHASE_LABELS[state.phase] ?? state.phase}</p>
          {state.notice ? (
            <p data-testid="run-notice" className="text-sm text-destructive">
              {state.notice}
            </p>
          ) : null}
        </div>
      ) : null}
      {state.kind === "connection-lost" ? (
        <p data-testid="run-connection-lost" className="text-sm text-destructive">
          انقطع الاتصال بالتيار قبل اكتمال التشغيل — النتيجة غير معروفة. تحقق من حالة التشغيل يدويًا.
        </p>
      ) : null}
    </section>
  );
}

/** The wired panel: real submit, live SSE phases, real cancel. */
export function RunPanel() {
  const [token, setToken] = React.useState("");
  const [form, setForm] = React.useState<RunPanelForm>({ kind: "lookup", canonicalInput: "" });
  const [state, dispatch] = React.useReducer(runPanelReducer, initialRunPanelState);
  const tokenRef = React.useRef(token);
  const abortRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    tokenRef.current = token;
    setAuthTokenGetter(() => (tokenRef.current === "" ? null : tokenRef.current));
  }, [token]);

  React.useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const openStream = React.useCallback(async (runId: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await openRunEvents("/api", runId, tokenRef.current, controller.signal);
      if (!res.ok || !res.body) {
        // No stream: the run's outcome is unknown from this connection.
        dispatch({ type: "stream-closed" });
        return;
      }
      await readSseStream(res.body, (e) => {
        if (e.event !== "phase") return;
        try {
          const msg = JSON.parse(e.data) as { runId: string; phase: string };
          if (msg.runId !== runId) return;
          dispatch({ type: "phase", phase: msg.phase });
        } catch {
          // A malformed event is ignored; the stream itself continues.
        }
      });
      // The stream ended. If no terminal phase was seen this is a lost
      // connection (the reducer keeps the phases and says so) — never a success.
      dispatch({ type: "stream-closed" });
    } catch {
      dispatch({ type: "stream-closed" });
    }
  }, []);

  const handleSubmit = React.useCallback(async () => {
    if (form.kind === "" || form.canonicalInput === "") return;
    dispatch({ type: "submit" });
    try {
      const res = await submitRun({ kind: form.kind, canonicalInput: form.canonicalInput });
      dispatch({ type: "submitted", runId: res.runId });
      void openStream(res.runId);
    } catch (err) {
      dispatch({ type: "submit-failed", message: err instanceof Error ? err.message : String(err) });
    }
  }, [form, openStream]);

  const handleCancel = React.useCallback(async () => {
    if (state.kind !== "live") return;
    dispatch({ type: "cancel-requested" });
    try {
      await cancelRun(state.runId);
      // The cancelled phase arrives on the stream (or the snapshot on reconnect);
      // nothing else to do here.
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      const message = err instanceof Error ? err.message : String(err);
      dispatch({ type: "cancel-rejected", status, message });
    }
  }, [state]);

  return (
    <RunPanelView
      state={state}
      form={form}
      token={token}
      onFormChange={setForm}
      onTokenChange={setToken}
      onSubmit={() => void handleSubmit()}
      onCancel={() => void handleCancel()}
    />
  );
}
