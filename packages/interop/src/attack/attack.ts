/**
 * P4-020 — MITRE ATT&CK / CAPEC / D3FEND from LOCAL STIX data (T-IO-006 era
 * follow-up; "يعمل بلا شبكة" by construction: the module only ever reads the
 * frozen knowledge bundle `fixtures/attack/knowledge.json`, extracted from the
 * OFFICIAL sources by `tools/attack/build_reference.py` — ATT&CK STIX verbatim,
 * CAPEC XML and D3FEND ontology converted to STIX).
 *
 * The case side of the mapping is a typed claim: predicate `uses_technique`,
 * object = the technique id (T…/CAPEC-…/D3-…). The matrix never loses the
 * referral: every technique entry carries the claims that tagged it AND each
 * claim's evidence ids — "كل وسم تقنية يحيل إلى الملاحظة التي اقتضته".
 *
 * Fail-closed: a technique id the knowledge does not know is reported in
 * `unknownTechniques`, never silently dropped and never invented a name for.
 */
/** The STIX objects the knowledge bundle actually uses (structurally parsed, no invention). */
interface AttackStixObject {
  type: string;
  id: string;
  name?: string;
  external_references?: { source_name?: string; external_id?: string }[];
  kill_chain_phases?: { kill_chain_name?: string; phase_name?: string }[];
}

/** Anything shaped like a STIX bundle of such objects. */
import { ATTACK_KNOWLEDGE_BUNDLE } from "./knowledge.generated.ts";

export interface AttackKnowledgeBundle {
  objects: readonly unknown[];
}

/** One technique (ATT&CK/CAPEC attack-pattern or D3FEND course-of-action). */
export interface AttackTechniqueInfo {
  /** The human technique name, verbatim from the source of record. */
  name: string;
  /** Which matrix the technique belongs to. */
  matrix: "mitre-attack" | "capec" | "d3fend";
  /** ATT&CK kill-chain tactics (CAPEC/D3FEND have none — none are invented). */
  tactics: string[];
  /** The STIX object id, for stable linking into the knowledge bundle. */
  stixId: string;
}

export interface AttackKnowledge {
  techniques: Map<string, AttackTechniqueInfo>;
}

/** A technique tag on a case claim — the claim and the evidence behind it. */
export interface TechniqueTag {
  claimId: string;
  techniqueId: string;
  evidenceIds: string[];
}

export interface MatrixTechnique {
  techniqueId: string;
  name: string;
  matrix: AttackTechniqueInfo["matrix"];
  claims: { claimId: string; evidenceIds: string[] }[];
}

export interface AttackMatrix {
  /** ATT&CK: tactics → techniques. */
  tactics: { tactic: string; techniques: MatrixTechnique[] }[];
  /** CAPEC has no kill-chain tactics — its techniques list flat. */
  capec: MatrixTechnique[];
  /** D3FEND defensive techniques list flat. */
  d3fend: MatrixTechnique[];
  /** Technique ids the knowledge does not know — reported, never dropped. */
  unknownTechniques: string[];
}

const matrixOf = (sourceName: string): AttackTechniqueInfo["matrix"] | null =>
  sourceName === "mitre-attack" ? "mitre-attack" : sourceName === "capec" ? "capec" : sourceName === "d3fend" ? "d3fend" : null;

/** Parse the frozen STIX knowledge bundle into the technique index. */
export function loadAttackKnowledge(bundle: AttackKnowledgeBundle): AttackKnowledge {
  const techniques = new Map<string, AttackTechniqueInfo>();
  for (const raw of bundle.objects) {
    const o = raw as AttackStixObject;
    if (o.type !== "attack-pattern" && o.type !== "course-of-action") continue;
    const ref = (o.external_references ?? []).find((r) => r.external_id !== undefined);
    if (!ref) continue;
    const matrix = matrixOf(ref.source_name ?? "");
    if (!matrix) continue;
    const id = String(ref.external_id);
    techniques.set(id, {
      name: String(o.name ?? id),
      matrix,
      tactics: o.type === "attack-pattern" ? (o.kill_chain_phases ?? []).map((p) => String(p.phase_name)).sort() : [],
      stixId: String(o.id),
    });
  }
  return { techniques };
}

/** Build the case's matrices from its technique tags. Deterministic order throughout. */
export function buildAttackMatrix(tags: readonly TechniqueTag[], knowledge: AttackKnowledge): AttackMatrix {
  const byTechnique = new Map<string, { claimId: string; evidenceIds: string[] }[]>();
  for (const tag of tags) {
    const list = byTechnique.get(tag.techniqueId) ?? [];
    list.push({ claimId: tag.claimId, evidenceIds: [...tag.evidenceIds] });
    byTechnique.set(tag.techniqueId, list);
  }
  const matrix: AttackMatrix = { tactics: [], capec: [], d3fend: [], unknownTechniques: [] };
  const tacticIndex = new Map<string, Map<string, MatrixTechnique>>();
  for (const techniqueId of [...byTechnique.keys()].sort()) {
    const info = knowledge.techniques.get(techniqueId);
    if (!info) {
      matrix.unknownTechniques.push(techniqueId);
      continue;
    }
    const claims = (byTechnique.get(techniqueId) ?? []).sort((a, b) => (a.claimId < b.claimId ? -1 : 1));
    const entry: MatrixTechnique = { techniqueId, name: info.name, matrix: info.matrix, claims };
    if (info.matrix === "mitre-attack" && info.tactics.length > 0) {
      for (const tactic of info.tactics) {
        const row = tacticIndex.get(tactic) ?? new Map<string, MatrixTechnique>();
        row.set(techniqueId, entry);
        tacticIndex.set(tactic, row);
      }
    } else if (info.matrix === "capec") {
      matrix.capec.push(entry);
    } else {
      matrix.d3fend.push(entry);
    }
  }
  matrix.tactics = [...tacticIndex.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([tactic, techniques]) => ({ tactic, techniques: [...techniques.values()] }));
  return matrix;
}

/** The frozen local knowledge, loaded — the default argument for buildAttackMatrix callers. */
export const ATTACK_KNOWLEDGE: AttackKnowledge = loadAttackKnowledge(ATTACK_KNOWLEDGE_BUNDLE);
