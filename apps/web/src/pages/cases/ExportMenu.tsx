import { t } from "@ir/i18n";
import * as React from "react";
import { Button } from "@ir/ui";
import { EXPORT_FORMATS, exportUrl, filenameFromDisposition, triggerDownload, type ExportFormat } from "./exportMenu";

/**
 * P3-014 (قائمة التصدير): the ExportMenu — it lists exactly the formats
 * available in the phase (EXPORT_FORMATS, nothing invented, nothing hidden).
 * A locked case (J-17) gets no export action at all: nothing is exported from
 * it, and the menu says so explicitly.
 */

export function ExportMenuView({
  caseId,
  canExport,
  busy,
  error,
  onExport,
}: {
  caseId: string;
  canExport: boolean;
  busy?: boolean;
  error?: string | null;
  onExport: (format: ExportFormat) => void;
}) {
  return (
    <span data-testid={`export-menu-${caseId}`} className="inline-flex items-center gap-1">
      {canExport ? (
        <>
          {EXPORT_FORMATS.map((f) => (
            <Button
              key={f.id}
              variant="outline"
              size="sm"
              disabled={busy}
              data-testid={`export-item-${f.id}-${caseId}`}
              title={t(f.descriptionKey)}
              onClick={() => onExport(f.id)}
            >
              {t("cases.export.prefix")} {t(f.labelKey)}
            </Button>
          ))}
          {error !== null && (
            <span data-testid={`export-error-${caseId}`} role="alert" className="text-xs text-destructive">
              {error}
            </span>
          )}
        </>
      ) : (
        <span className="text-xs text-muted-foreground">{t("cases.export.locked")}</span>
      )}
    </span>
  );
}

/**
 * The wired menu: fetches the export (the phase's format) with the admin token,
 * reads the server's Content-Disposition for the filename, and triggers the
 * browser download. A failed export is surfaced — never a silent no-download.
 */
export function ExportMenu({ caseId, canExport, token }: { caseId: string; canExport: boolean; token: string }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const onExport = async (format: ExportFormat): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(exportUrl(caseId, format), {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        // The server names what is supported — surface it verbatim, never fake a file.
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      triggerDownload(blob, filenameFromDisposition(res.headers.get("content-disposition"), caseId, format));
    } catch (x) {
      setError(x instanceof Error ? x.message : "خطأ غير معروف");
    } finally {
      setBusy(false);
    }
  };
  return <ExportMenuView caseId={caseId} canExport={canExport} busy={busy} error={error} onExport={(f) => void onExport(f)} />;
}
