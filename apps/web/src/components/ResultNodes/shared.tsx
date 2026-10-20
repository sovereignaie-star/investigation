import { t } from "@ir/i18n";
import * as React from "react";
import { Handle, Position } from "@xyflow/react";

/**
 * P3-016: the shared frame of the eight result nodes — the new view model's
 * presentation: the @ir/ui token palette ONLY (bg-card / border-border /
 * text-foreground / text-muted-foreground), so every node reads correctly in
 * BOTH themes (light and dark) and in RTL. The legacy hardcoded zinc/blue/
 * emerald palette is gone. Values that are URLs/ids/coordinates render
 * dir="ltr"; the Arabic labels stay inline until P3-017 (documented interim).
 */

export const NODE_FRAME = "bg-card text-foreground border rounded-lg shadow min-w-[200px] max-w-[300px]";

export function NodeFrame({
  selected,
  header,
  children,
  footer,
}: {
  selected: boolean;
  header: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className={`${NODE_FRAME} ${selected ? "border-primary" : "border-border"}`} data-selected={selected}>
      <Handle type="target" position={Position.Top} className="!bg-primary !w-2 !h-2" />
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/50 rounded-t-lg">{header}</div>
      <div className="p-3">{children}</div>
      {footer && <div className="border-t border-border">{footer}</div>}
      <Handle type="source" position={Position.Bottom} className="!bg-primary !w-2 !h-2" />
    </div>
  );
}

/** The node type's header: icon + Arabic label (+ optional trailing meta). */
export function NodeHeader({ icon, label, children }: { icon: React.ReactNode; label: string; children?: React.ReactNode }) {
  return (
    <>
      <span className="text-primary">{icon}</span>
      <span className="text-xs font-medium truncate">{label}</span>
      {children}
    </>
  );
}

/**
 * The P3-008 rule made visible: a node whose data carries evidence references
 * shows them — what is shown links to its evidence (ids in the title tooltip).
 */
export function EvidenceBadge({ evidenceIds }: { evidenceIds: string[] }) {
  return (
    <span
      data-testid="node-evidence-refs"
      className="ms-auto shrink-0 text-[10px] text-muted-foreground"
      title={evidenceIds.join("، ")}
      dir="ltr"
    >
      {t("resultNodes.evidenceBadge", { n: evidenceIds.length })}
    </span>
  );
}

/** The honest shell invalid data renders — never a half-rendered node. */
export function InvalidNode() {
  return (
    <div className={`${NODE_FRAME} border-destructive`} data-testid="invalid-node">
      <Handle type="target" position={Position.Top} className="!bg-destructive !w-2 !h-2" />
      <div className="p-3 text-xs text-muted-foreground">{t("resultNodes.invalid")}</div>
      <Handle type="source" position={Position.Bottom} className="!bg-destructive !w-2 !h-2" />
    </div>
  );
}

/** Clipboard copy guarded for environments without the API (tests, static render). */
export function copyText(value: string): void {
  if (typeof navigator === "undefined" || !navigator.clipboard) return;
  void navigator.clipboard.writeText(value);
}

/** A compact token-styled action row (copy/download/open) for node footers. */
export function NodeAction({ onClick, href, children }: { onClick?: () => void; href?: string; children: React.ReactNode }) {
  const cls =
    "w-full flex items-center justify-center gap-1 py-1.5 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors";
  if (href) {
    return (
      <a href={href} className={cls} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  }
  return (
    <button type="button" className={cls} onClick={onClick}>
      {children}
    </button>
  );
}
