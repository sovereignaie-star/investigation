/**
 * P3-014 (يصدر الصيغ المتاحة في المرحلة): the export model — the formats
 * available in THIS phase and nothing else. The phase's format is the projection
 * snapshot JSON (the exact `ir project --json` shape) served by
 * GET /cases/:id/export/projection; the menu never lists a format the server does
 * not support (an unsupported one is an explicit 400 naming the supported ones —
 * never a silent fallback).
 */

/** The export formats available in this phase — exactly what the server supports. */
export const EXPORT_FORMATS = [
  {
    id: "projection",
    labelKey: "cases.export.projection.label",
    descriptionKey: "cases.export.projection.description",
  },
] as const;

export type ExportFormat = (typeof EXPORT_FORMATS)[number]["id"];

/** Type guard — the phase's formats only; invented ones are rejected (400 on the server). */
export function isExportFormat(value: string): value is ExportFormat {
  return EXPORT_FORMATS.some((f) => f.id === value);
}

/**
 * The download filename: taken from the server's Content-Disposition when it is a
 * well-formed attachment header, else a deterministic safe fallback. The result is
 * sanitized — path separators and traversal are stripped, so a crafted header can
 * never steer the download outside its name.
 */
export function filenameFromDisposition(header: string | null, caseId: string, format: ExportFormat): string {
  const fallback = `case-${caseId}-${format}.json`;
  if (typeof header !== "string") return fallback;
  const match = /filename="([^"]+)"/.exec(header);
  if (!match) return fallback;
  const raw = match[1];
  // Sanitize: strip every path separator / traversal — the filename must be a bare name.
  const clean = raw.replace(/[/\\]/g, "_").replace(/\.\./g, "");
  return clean.length > 0 ? clean : fallback;
}

/** The download URL for a case's export — the only route the wired component calls. */
export function exportUrl(caseId: string, format: ExportFormat): string {
  return `/api/cases/${caseId}/export/${format}`;
}

/**
 * Triggers the browser download of a blob under a filename. Used by the wired
 * component only (the view and model stay testable without a DOM).
 */
export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
