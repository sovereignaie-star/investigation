import { t } from "@ir/i18n";
import * as React from "react";

import { addCaseNote } from "@workspace/api-client-react";

/**
 * P3-021 («ملاحظة»): the note dialog — the write surface of the note feature. The
 * note is durable case data: it saves through the REAL API (POST /cases/:id/notes —
 * a `note.added` entry in the case's own hash-chained ledger) and the caller re-reads
 * the projection afterwards, so the note is visible on reopen. A note that vanishes
 * on reopen is a dead feature — the save flow ends with the refreshed projection.
 */
export function NoteDialog({
  nodeId,
  caseId,
  onClose,
  onSaved,
}: {
  nodeId: string | null;
  caseId: string | null;
  onClose: () => void;
  /** Called after a successful save — the caller re-reads the case's projection. */
  onSaved: () => Promise<void> | void;
}) {
  // The dialog body remounts on every open (keyed by the node): each note starts
  // EMPTY — no state reset in an effect, no leftover text from a previous note.
  if (nodeId === null || caseId === null) return null;
  return <Body key={nodeId} nodeId={nodeId} caseId={caseId} onClose={onClose} onSaved={onSaved} />;
}

function Body({
  nodeId,
  caseId,
  onClose,
  onSaved,
}: {
  nodeId: string;
  caseId: string;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [text, setText] = React.useState("");
  const [state, setState] = React.useState<"idle" | "saving" | "error">("idle");
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);

  // Focus lands in the textarea on open (keyboard flow).
  React.useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const save = async (): Promise<void> => {
    const trimmed = text.trim();
    if (trimmed === "") return;
    setState("saving");
    try {
      await addCaseNote(caseId, { nodeId, text: trimmed });
      setState("idle");
      await onSaved();
      onClose();
    } catch {
      // The error is honest and stays until dismissed — never a silent failure.
      setState("error");
    }
  };

  return (
    <div
      data-testid="note-dialog"
      role="dialog"
      aria-modal="true"
      aria-label={t("commands.note.dialogTitle")}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <div className="w-full max-w-lg rounded-md border border-border bg-background p-4 shadow-lg">
        <h2 className="mb-2 text-base font-semibold">{t("commands.note.dialogTitle")}</h2>
        <textarea
          ref={textareaRef}
          className="min-h-[96px] w-full rounded border border-border bg-transparent p-2 text-sm outline-none"
          data-testid="note-text"
          value={text}
          maxLength={2000}
          placeholder={t("commands.note.placeholder")}
          onChange={(e) => setText(e.target.value)}
        />
        {state === "error" ? (
          <p data-testid="note-error" className="mt-1 text-sm text-destructive-text">
            {t("commands.note.saveFailed")}
          </p>
        ) : null}
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" className="rounded border border-border px-3 py-1.5 text-sm" data-testid="note-cancel" onClick={onClose}>
            {t("commands.note.cancel")}
          </button>
          <button
            type="button"
            data-testid="note-save"
            className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            disabled={state === "saving" || text.trim() === ""}
            onClick={() => void save()}
          >
            {state === "saving" ? t("commands.note.saving") : t("commands.note.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
