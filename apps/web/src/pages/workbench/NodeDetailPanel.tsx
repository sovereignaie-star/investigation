import type { Graph } from "@ir/ledger/projections";

import { useSelection } from "../../store/selectionStore";
import { buildEvidenceDetail, buildNodeDetail, type EvidenceDetail, type NodeDetail } from "./nodeDetailModel";

/**
 * P3-008 — NodeDetailPanel: the selected node's claims (attributes and relations),
 * each linking to its evidence (acceptance: "كل حقل يحيل إلى دليل"). Evidence
 * links open the record under examination with the claims citing it; the raw
 * evidence viewer is P3-010. A claim with no observation says "لا دليل مسجل" —
 * honesty over invention.
 *
 * Presentational: state reaches it as props so it renders identically in the
 * browser and in headless static-markup tests (zustand's server snapshot is the
 * initial state, so a store-reading component cannot be tested statically).
 */

function EvidenceLinks({ evidenceIds, onSelectEvidence }: { evidenceIds: string[]; onSelectEvidence: (id: string) => void }) {
  if (evidenceIds.length === 0) return <span className="text-muted-foreground">لا دليل مسجل</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {evidenceIds.map((id) => (
        <button
          key={id}
          type="button"
          data-testid="evidence-link"
          className="rounded border px-1 font-mono text-[11px] hover:bg-accent"
          title={`الدليل ${id}`}
          onClick={() => onSelectEvidence(id)}
        >
          {id}
        </button>
      ))}
    </span>
  );
}

export function NodeDetailPanel({
  detail,
  evidenceDetail,
  onSelectEvidence,
  onCloseEvidence,
}: {
  detail: NodeDetail | null;
  evidenceDetail: EvidenceDetail | null;
  onSelectEvidence: (id: string) => void;
  onCloseEvidence: () => void;
}) {
  if (!detail) return null;

  return (
    <aside data-testid="node-detail-panel" className="rounded-lg border bg-card p-4 text-sm" aria-label="تفاصيل العقدة">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">{detail.label}</h3>
          <p className="font-mono text-[11px] text-muted-foreground" data-testid="node-detail-type">
            {detail.type} · {detail.canonicalKey}
          </p>
          {detail.aliases.length > 0 && <p className="text-[11px] text-muted-foreground">كيانات مدمجة: {detail.aliases.join("، ")}</p>}
        </div>
        <span
          className="rounded-full border px-2 py-0.5 text-[11px]"
          data-testid="node-detail-observations"
          title="ملاحظات موجبة / سالبة / أخطاء"
        >
          +{detail.observations.positive} −{detail.observations.negative} !{detail.observations.error}
        </span>
      </div>

      {evidenceDetail ? (
        <div className="mt-3 rounded border bg-muted/40 p-3" data-testid="evidence-detail">
          <div className="flex items-center justify-between">
            <h4 className="font-medium">الدليل {evidenceDetail.evidenceId}</h4>
            <button
              type="button"
              data-testid="evidence-detail-close"
              className="text-[11px] text-muted-foreground hover:underline"
              onClick={onCloseEvidence}
            >
              إغلاق
            </button>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">يُستشهد به في:</p>
          <ul className="mt-1 list-inside list-disc text-[12px]">
            {evidenceDetail.citedBy.map((c, i) => (
              <li key={i}>
                {c.predicate} — {c.nodeLabel}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-3">
        <h4 className="mb-1 font-medium">الخصائص (ادعاءات قيمية)</h4>
        {detail.attributes.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">لا ادعاءات مسجلة</p>
        ) : (
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-start text-muted-foreground">
                <th className="text-start font-normal">الخاصية</th>
                <th className="text-start font-normal">القيمة</th>
                <th className="text-start font-normal">الثقة</th>
                <th className="text-start font-normal">الدليل</th>
              </tr>
            </thead>
            <tbody>
              {detail.attributes.map((a) => (
                <tr key={a.claimId} className="border-t">
                  <td className="py-1 font-mono text-[11px]">{a.predicate}</td>
                  <td className="py-1">{String(a.value)}</td>
                  <td className="py-1">
                    <span className="font-mono text-[11px] text-muted-foreground" data-testid="claim-confidence">
                      {a.confidence.toFixed(2)}
                    </span>
                  </td>
                  <td className="py-1">
                    <EvidenceLinks evidenceIds={a.evidenceIds} onSelectEvidence={onSelectEvidence} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="mt-3">
        <h4 className="mb-1 font-medium">العلاقات</h4>
        {detail.relations.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">لا علاقات مسجلة</p>
        ) : (
          <ul className="space-y-1 text-[12px]">
            {detail.relations.map((r) => (
              <li key={r.edgeId} className="flex items-center justify-between gap-2 border-t py-1">
                <span>
                  {r.direction === "out" ? "← " : "→ "}
                  <span className="font-mono text-[11px]">{r.predicate}</span> {r.otherLabel}
                  <span className="ms-1 font-mono text-[11px] text-muted-foreground" data-testid="claim-confidence">
                    {r.confidence.toFixed(2)}
                  </span>
                </span>
                <EvidenceLinks evidenceIds={r.evidenceIds} onSelectEvidence={onSelectEvidence} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

/**
 * The container: connects the presentational panel to the selection store.
 * Thin by design — all rendering logic lives in the presentational component.
 */
export function NodeDetailPanelContainer({ graph }: { graph: Graph }) {
  const selectedNodeId = useSelection((s) => s.selectedNodeId);
  const selectedEvidenceId = useSelection((s) => s.selectedEvidenceId);
  const selectEvidence = useSelection((s) => s.selectEvidence);
  const detail = selectedNodeId ? buildNodeDetail(graph, selectedNodeId) : null;
  const evidenceDetail = selectedEvidenceId ? buildEvidenceDetail(graph, selectedEvidenceId) : null;
  return (
    <NodeDetailPanel
      detail={detail}
      evidenceDetail={evidenceDetail}
      onSelectEvidence={selectEvidence}
      onCloseEvidence={() => selectEvidence(null)}
    />
  );
}
