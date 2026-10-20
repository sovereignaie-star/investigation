import { t } from "@ir/i18n";
import * as React from "react";
import { Label } from "@ir/ui";

/**
 * P3-004 (UC-02): the text-file uploader. The file is read in memory with a FileReader and its
 * content is handed to the same extraction path as pasted text — nothing is uploaded or stored
 * (D-033). Reads are capped so a huge file cannot hang the page.
 */

export const MAX_FILE_BYTES = 1_000_000;

export function isFileTooLarge(size: number): boolean {
  return size > MAX_FILE_BYTES;
}

export function FileUploader({ onText }: { onText: (text: string, name: string) => void }) {
  const [error, setError] = React.useState<string | null>(null);
  return (
    <div data-testid="file-uploader" className="flex flex-col gap-1">
      <Label htmlFor="file-input">{t("workbench.uploader.label")}</Label>
      <input
        id="file-input"
        type="file"
        accept=".txt,.md,.csv,.json,text/plain"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file === undefined) return;
          if (isFileTooLarge(file.size)) {
            setError(t("workbench.uploader.tooLarge", { kb: MAX_FILE_BYTES / 1000 }));
            return;
          }
          setError(null);
          const reader = new FileReader();
          reader.onload = () => onText(String(reader.result ?? ""), file.name);
          reader.readAsText(file);
        }}
      />
      {error !== null && (
        <p role="alert" className="text-sm text-destructive-text">
          {error}
        </p>
      )}
    </div>
  );
}
