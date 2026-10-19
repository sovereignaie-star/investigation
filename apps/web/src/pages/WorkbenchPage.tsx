import * as React from "react";
import { extract } from "@ir/core/identifiers";

import { FileUploader } from "./workbench/FileUploader";
import { IdentifierSelector } from "./workbench/IdentifierSelector";
import { SearchBar } from "./workbench/SearchBar";
import { toIdentifierRows, toggleSelection } from "./workbench/model";

/**
 * P3-004 (UC-02): the workbench input flow — paste free text or read a text file, extract
 * identifiers with the real engine, and present the classified list with confidence. The
 * selection is view state only (D-033); expansion of the selected identifiers belongs to the
 * later engine-run tasks.
 */
export function WorkbenchPage({ initialText = "" }: { initialText?: string }) {
  const [rows, setRows] = React.useState(() => toIdentifierRows(extract(initialText)));
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(() => new Set());

  const handleText = React.useCallback((text: string) => {
    setRows(toIdentifierRows(extract(text)));
    setSelected(new Set());
  }, []);

  return (
    <div data-testid="workbench-page" className="flex flex-col gap-6 p-4 md:p-6">
      <h1 className="text-xl font-semibold">محطة العمل</h1>
      <SearchBar onText={handleText} />
      <FileUploader onText={handleText} />
      <IdentifierSelector rows={rows} selected={selected} onToggle={(id) => setSelected((current) => toggleSelection(current, id))} />
    </div>
  );
}
