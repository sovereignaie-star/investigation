import * as React from "react";
import { Badge } from "@ir/ui";

import type { IdentifierRow } from "./model";

/**
 * P3-004 (UC-02): the classified identifier list. Every row shows the value (LTR), the Arabic
 * type label from the catalog, the detector's confidence as a percentage, and the validation
 * badge when the winning candidate passed a checksum/registry/PSL check. Rows are selectable —
 * the selection drives later expansion steps and lives in view state only.
 */
export function IdentifierSelector({
  rows,
  selected,
  onToggle,
}: {
  rows: readonly IdentifierRow[];
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <p data-testid="identifier-selector" className="text-sm text-muted-foreground">
        لا معرّفات بعد — الصق نصاً أو ارفع ملفاً لاستخراج المعرّفات.
      </p>
    );
  }
  return (
    <div data-testid="identifier-selector" className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        محدد المعرّفات: {selected.size}/{rows.length}
      </p>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-start text-muted-foreground">
            <th className="py-2 text-start font-medium">القيمة</th>
            <th className="py-2 text-start font-medium">النوع</th>
            <th className="py-2 text-start font-medium">الثقة</th>
            <th className="py-2 text-start font-medium">التحقق</th>
            <th className="py-2 text-start font-medium">اختيار</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-border/50">
              <td dir="ltr" className="py-2 pe-2 font-mono">
                {row.value}
              </td>
              <td className="py-2 pe-2">
                {row.typeLabelAr}
                <span className="block text-xs text-muted-foreground">{row.category}</span>
              </td>
              <td className="py-2 pe-2">{Math.round(row.confidence * 100)}%</td>
              <td className="py-2 pe-2">{row.validated && <Badge variant="outline">مؤكد</Badge>}</td>
              <td className="py-2 pe-2">
                <input
                  type="checkbox"
                  name={`identifier:${row.id}`}
                  checked={selected.has(row.id)}
                  onChange={() => onToggle(row.id)}
                  aria-label={`اختر ${row.value}`}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
