import * as React from "react";
import { t } from "@ir/i18n";
import { ATTACK_KNOWLEDGE, buildAttackMatrix, type AttackMatrix, type TechniqueTag } from "@ir/interop";
import type { Graph } from "@ir/ledger/projections";

/**
 * P4-020 (بيانات STIX محلية) — عرض مصفوفة ATT&CK للقضية. The view reads the
 * opened case's OWN graph (the `uses_technique` attributes) joined with the
 * frozen local STIX knowledge — imported, bundled: OFFLINE by construction,
 * zero network egress (the same honest-isolation rule as the map view's clean
 * background). Every technique entry carries its claim and that claim's
 * evidence ids ("كل وسم تقنية يحيل إلى الملاحظة التي اقتضته"); unknown
 * technique ids are reported, never dropped and never invented names for;
 * no technique claims ⇒ an honest empty state, no fabricated rows.
 */

/** Extract the case's technique tags: `uses_technique` attributes, evidence kept. */
export function buildMatrixFromGraph(graph: Graph): AttackMatrix {
  const tags: TechniqueTag[] = [];
  for (const node of graph.nodes) {
    for (const attr of node.attributes) {
      if (attr.predicate === "uses_technique") {
        tags.push({ claimId: attr.claimId, techniqueId: String(attr.value), evidenceIds: attr.evidenceIds });
      }
    }
  }
  return buildAttackMatrix(tags, ATTACK_KNOWLEDGE);
}

function MatrixTechniqueRow({ tech }: { tech: AttackMatrix["tactics"][number]["techniques"][number] }) {
  return (
    <li data-testid="attack-matrix-technique" className="border-b border-border py-1.5 last:border-b-0">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span dir="ltr" className="font-mono font-medium">
          {tech.techniqueId}
        </span>
        <span dir="auto">{tech.name}</span>
        <span className="text-xs text-muted-foreground">{tech.matrix}</span>
      </div>
      {/* الوسم يحيل إلى الملاحظة التي اقتضته: كل ادعاء بأدلته */}
      <ul className="mt-0.5 space-y-0.5 text-[11px] text-muted-foreground">
        {tech.claims.map((claim) => (
          <li key={claim.claimId} data-testid="attack-matrix-claim" dir="ltr">
            {claim.claimId} — {claim.evidenceIds.length > 0 ? claim.evidenceIds.join(" ") : t("workbench.attackMatrix.noEvidence")}
          </li>
        ))}
      </ul>
    </li>
  );
}

export function AttackMatrixView({ graph }: { graph: Graph }) {
  const matrix = React.useMemo(() => buildMatrixFromGraph(graph), [graph]);
  const hasAny = matrix.tactics.length + matrix.capec.length + matrix.d3fend.length + matrix.unknownTechniques.length > 0;
  return (
    <section aria-label={t("workbench.attackMatrix.ariaLabel")} data-testid="attack-matrix" className="rounded-md border border-border p-3">
      <h3 className="mb-2 text-sm font-semibold">{t("workbench.attackMatrix.heading")}</h3>
      {hasAny ? (
        <div className="space-y-3 text-sm">
          {matrix.tactics.map((row) => (
            <div key={row.tactic} data-testid="attack-matrix-row">
              <h4 dir="ltr" className="text-xs font-semibold uppercase text-muted-foreground">
                {row.tactic}
              </h4>
              <ul>
                {row.techniques.map((tech) => (
                  <MatrixTechniqueRow key={tech.techniqueId} tech={tech} />
                ))}
              </ul>
            </div>
          ))}
          {matrix.capec.length > 0 || matrix.d3fend.length > 0 ? (
            <div data-testid="attack-matrix-other">
              {[...matrix.capec, ...matrix.d3fend].map((tech) => (
                <ul key={tech.techniqueId}>
                  <MatrixTechniqueRow tech={tech} />
                </ul>
              ))}
            </div>
          ) : null}
          {matrix.unknownTechniques.length > 0 ? (
            <p data-testid="attack-matrix-unknown" dir="ltr" className="text-[11px] text-muted-foreground">
              {t("workbench.attackMatrix.unknown")}: {matrix.unknownTechniques.join(" ")}
            </p>
          ) : null}
        </div>
      ) : (
        <p data-testid="attack-matrix-empty" className="text-sm text-muted-foreground">
          {t("workbench.attackMatrix.empty")}
        </p>
      )}
    </section>
  );
}
