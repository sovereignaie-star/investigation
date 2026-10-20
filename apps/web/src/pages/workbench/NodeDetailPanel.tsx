import { t } from "@ir/i18n";
import type { Graph } from "@ir/ledger/projections";

import { useSelection } from "../../store/selectionStore";
import { buildEvidenceDetail, buildNodeDetail, type EvidenceDetail, type NodeDetail } from "./nodeDetailModel";
import type { StoredNote } from "./savedInvestigationsModel";

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
  if (evidenceIds.length === 0) return <span className="text-muted-foreground">{t("workbench.nodeDetail.noEvidence")}</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {evidenceIds.map((id) => (
        <button
          key={id}
          type="button"
          data-testid="evidence-link"
          className="rounded border px-1 font-mono text-[11px] hover:bg-accent"
          title={t("workbench.nodeDetail.evidenceTitle", { id })}
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
  notes,
  onSelectEvidence,
  onCloseEvidence,
}: {
  detail: NodeDetail | null;
  evidenceDetail: EvidenceDetail | null;
  /** P3-021: the case's notes targeting THIS node (ledger order). */
  notes?: readonly StoredNote[];
  onSelectEvidence: (id: string) => void;
  onCloseEvidence: () => void;
}) {
  if (!detail) return null;

  return (
    <aside
      data-testid="node-detail-panel"
      className="rounded-lg border bg-card p-4 text-sm"
      aria-label={t("workbench.nodeDetail.ariaLabel")}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">{detail.label}</h3>
          <p className="font-mono text-[11px] text-muted-foreground" data-testid="node-detail-type">
            {detail.type} · {detail.canonicalKey}
          </p>
          {detail.aliases.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              {t("workbench.nodeDetail.mergedEntities", { aliases: detail.aliases.join("، ") })}
            </p>
          )}
        </div>
        <span
          className="rounded-full border px-2 py-0.5 text-[11px]"
          data-testid="node-detail-observations"
          title={t("workbench.nodeDetail.notesTitle")}
        >
          +{detail.observations.positive} −{detail.observations.negative} !{detail.observations.error}
        </span>
      </div>

      {/* P3-021: the node's notes — durable case data (note.added entries), shown with
          their author and time; a node without notes says so honestly. */}
      <section className="mt-3" data-testid="node-notes">
        <h4 className="font-medium">{t("workbench.nodeDetail.notesHeading")}</h4>
        {(notes ?? []).length === 0 ? (
          <p className="text-[12px] text-muted-foreground">{t("workbench.nodeDetail.noNotes")}</p>
        ) : (
          <ul className="mt-1 flex flex-col gap-1">
            {(notes ?? []).map((note) => (
              <li key={note.seq} data-testid={`node-note-${note.seq}`} className="rounded border bg-muted/40 p-2 text-[12px]">
                <p>{note.text}</p>
                <p className="text-[11px] text-muted-foreground">{t("workbench.nodeDetail.noteBy", { actor: note.actor, at: note.at })}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {evidenceDetail ? (
        <div className="mt-3 rounded border bg-muted/40 p-3" data-testid="evidence-detail">
          <div className="flex items-center justify-between">
            <h4 className="font-medium">{t("workbench.nodeDetail.evidenceHeading", { id: evidenceDetail.evidenceId })}</h4>
            <button
              type="button"
              data-testid="evidence-detail-close"
              className="text-[11px] text-muted-foreground hover:underline"
              onClick={onCloseEvidence}
            >
              {t("common.close")}
            </button>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">{t("workbench.nodeDetail.citedIn")}</p>
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
        <h4 className="mb-1 font-medium">{t("workbench.nodeDetail.attributes")}</h4>
        {detail.attributes.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">{t("workbench.nodeDetail.noAttributes")}</p>
        ) : (
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-start text-muted-foreground">
                <th className="text-start font-normal">{t("workbench.nodeDetail.attribute")}</th>
                <th className="text-start font-normal">{t("workbench.nodeDetail.value")}</th>
                <th className="text-start font-normal">{t("workbench.nodeDetail.confidence")}</th>
                <th className="text-start font-normal">{t("workbench.nodeDetail.evidence")}</th>
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
        <h4 className="mb-1 font-medium">{t("workbench.nodeDetail.relations")}</h4>
        {detail.relations.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">{t("workbench.nodeDetail.noRelations")}</p>
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
                  {r.explanation !== null ? (
                    <span
                      className="block text-xs text-muted-foreground"
                      data-testid="relation-source-note"
                      title={t("workbench.nodeDetail.sourceNoteTitle")}
                    >
                      {r.explanation}
                    </span>
                  ) : null}
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
export function NodeDetailPanelContainer({ graph, notes }: { graph: Graph; notes?: readonly StoredNote[] }) {
  const selectedNodeId = useSelection((s) => s.selectedNodeId);
  const selectedEvidenceId = useSelection((s) => s.selectedEvidenceId);
  const selectEvidence = useSelection((s) => s.selectEvidence);
  const detail = selectedNodeId ? buildNodeDetail(graph, selectedNodeId) : null;
  const evidenceDetail = selectedEvidenceId ? buildEvidenceDetail(graph, selectedEvidenceId) : null;
  // P3-021: the node's notes — the case's own note.added entries targeting this node.
  const nodeNotes = selectedNodeId ? (notes ?? []).filter((n) => n.nodeId === selectedNodeId) : [];
  return (
    <NodeDetailPanel
      detail={detail}
      evidenceDetail={evidenceDetail}
      notes={nodeNotes}
      onSelectEvidence={selectEvidence}
      onCloseEvidence={() => selectEvidence(null)}
    />
  );
}
