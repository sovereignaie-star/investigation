// P3-010: the raw evidence viewer. The defense is layered — the HTML is DOMPurified first,
// and the iframe renders it under sandbox="" so even a sanitizer escape executes nothing
// (no scripts, no same-origin, no forms). Text renders escaped; binary is refused honestly.
import * as React from "react";

import type { EvidenceView } from "./evidenceViewerModel";

export interface EvidenceViewerProps {
  view: EvidenceView;
  evidenceId: string | null;
  fetchedAt: string | null;
}

export function EvidenceViewer({ view, evidenceId, fetchedAt }: EvidenceViewerProps): React.ReactElement {
  return (
    <section className="evidence-viewer" data-testid="evidence-viewer">
      <header className="evidence-viewer__meta">
        <span data-testid="evidence-id">{evidenceId ?? "—"}</span>
        <span aria-hidden="true"> · </span>
        <span data-testid="evidence-fetched-at">{fetchedAt ?? "—"}</span>
      </header>
      {view.kind === "html" ? (
        <iframe title="دليل" data-testid="evidence-frame" className="evidence-viewer__frame" srcDoc={view.body} sandbox="" />
      ) : view.kind === "text" ? (
        <>
          {view.truncated ? (
            <p className="evidence-viewer__notice" data-testid="evidence-truncated">
              النص مبتور للعرض — طول العرض محدود
            </p>
          ) : null}
          <pre data-testid="evidence-text" className="evidence-viewer__text">
            {view.body}
          </pre>
        </>
      ) : (
        <p className="evidence-viewer__notice" data-testid="evidence-binary">
          هذا الدليل ثنائي ({view.mime}، {view.size} بايت) — لا يُعرض خاماً في العارض. البايتات كاملة موجودة في مخزن القضية مع بصمة sha256
          للتحقق، وعرضها الخام ليس جزءاً من هذا العارض.
        </p>
      )}
    </section>
  );
}
