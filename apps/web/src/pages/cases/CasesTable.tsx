import type { CaseSummary } from "@workspace/api-client-react";
import { Badge, Button } from "@ir/ui";
import { ExportMenu } from "./ExportMenu";

/**
 * P3-003 (طلب ب): the case list table. The owner's decisions are the rendering rules:
 *
 * - J-16: an archived case is hidden unless includeArchived is true, and it is labeled
 *   as archived with an explicit reopen path (which the API gates behind a
 *   PurposeConfirmation — E-02).
 * - J-17: a locked-encrypted case shows ONLY its identifier, status and timestamps —
 *   no title, no purpose, no names — with the explicit locked indicator.
 */

const LOCKED_MESSAGE = "مقفلة — تتطلب فك التشفير";

export function CasesTable({
  cases,
  includeArchived,
  exportToken,
  onArchive,
  onReopen,
  onStats,
}: {
  cases: CaseSummary[];
  includeArchived: boolean;
  /** The admin token for the export download — the menu appears only once it is provided. */
  exportToken?: string;
  onArchive?: (id: string) => void;
  onReopen?: (id: string) => void;
  onStats?: (id: string) => void;
}) {
  const visible = cases.filter((c) => includeArchived || c.status !== "archived");
  return (
    <table className="w-full text-sm" data-testid="cases-table">
      <thead>
        <tr className="border-b border-border text-start text-muted-foreground">
          <th className="py-2 text-start font-medium">العنوان</th>
          <th className="py-2 text-start font-medium">الأساس القانوني</th>
          <th className="py-2 text-start font-medium">الحالة</th>
          <th className="py-2 text-start font-medium">آخر نشاط</th>
          <th className="py-2 text-start font-medium">إجراءات</th>
        </tr>
      </thead>
      <tbody>
        {visible.map((c) => (
          <tr key={c.id} className="border-b border-border/50" data-status={c.status}>
            <td className="py-2 pe-2">
              {c.status === "locked-encrypted" ? (
                // J-17: identifier and indicator only — the API sends no content to leak.
                <span className="text-muted-foreground" dir="rtl">
                  {LOCKED_MESSAGE}
                </span>
              ) : (
                c.title
              )}
              <span dir="ltr" className="block text-xs text-muted-foreground">
                {c.id}
              </span>
            </td>
            <td className="py-2 pe-2">{c.legalBasis ?? "—"}</td>
            <td className="py-2 pe-2">
              {c.status === "locked-encrypted" && <Badge variant="outline">مقفلة</Badge>}
              {c.status === "active" && <Badge variant="secondary">نشطة</Badge>}
              {c.status === "archived" && <Badge variant="outline">مؤرشفة</Badge>}
            </td>
            <td dir="ltr" className="py-2 pe-2 tabular-nums text-muted-foreground">
              {c.lastActivityAt ?? "—"}
            </td>
            <td className="py-2">
              {c.status !== "locked-encrypted" && onStats && (
                <Button variant="outline" size="sm" data-action="stats" onClick={() => onStats(c.id)}>
                  الإحصاءات
                </Button>
              )}
              {c.status === "active" && onArchive && (
                <Button variant="outline" size="sm" data-action="archive" onClick={() => onArchive(c.id)}>
                  أرشفة
                </Button>
              )}
              {c.status === "archived" && onReopen && (
                <Button variant="outline" size="sm" data-action="unarchive" onClick={() => onReopen(c.id)}>
                  إعادة فتح
                </Button>
              )}
              {exportToken !== undefined && <ExportMenu caseId={c.id} canExport={c.status !== "locked-encrypted"} token={exportToken} />}
              {c.status === "locked-encrypted" && <span className="text-xs text-muted-foreground">لا إجراء قبل فك التشفير</span>}
            </td>
          </tr>
        ))}
        {visible.length === 0 && (
          <tr>
            <td colSpan={5} className="py-6 text-center text-muted-foreground">
              لا قضايا بعد — أنشئ أول قضية بصيغة غرض موثق.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
