import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import { caseFingerprint, openCase, type Case, type CaseFingerprint, type CaseInit } from "@ir/store";
import { ER_MODEL_VERSION, ER_MODEL_WEIGHTS, resolveEntities, scorePair, toErRecord, ulidFactory } from "@ir/core";
import { projectionHash, type GraphNode } from "@ir/ledger/projections";
import { isTextualMime } from "@ir/schema";
import { AcceptCaseMergeBody, AddCaseNoteBody, CreateCaseBody, UpdateCaseLifecycleBody } from "@workspace/api-zod";
import { requireAdmin } from "../lib/admin";
import { logger } from "../lib/logger";

/**
 * Case lifecycle REST routes (P3-003, طلب أ). The owner's decisions of 2026-10-19:
 *
 * - J-16 (archive): archivedAt + write-block. An archived case is hidden from the default
 *   listing (includeArchived=true lists it), PATCHing it again is a conflict, and unarchive
 *   is an explicit action that REQUIRES a PurposeConfirmation (E-02 pattern, fail-closed).
 *   No delete, no destruction — there is no DELETE route at all.
 * - J-17 (locked): a locked-encrypted case shows ONLY its identifier, status, createdAt and
 *   lastActivityAt — no title, no purpose, no names. The detail returns an explicit message.
 * - J-18 (root): SOVEREIGN_DATA_ROOT/cases/, falling back to the vault's data dir pattern
 *   (IR_DATA_DIR, default ./data) when SOVEREIGN_DATA_ROOT is unset. No custom path.
 *
 * Security posture (D-037): the case routes are not browser-public — they sit behind the same
 * admin boundary as the engine and vault routes (requireAdmin) and are rate-limited.
 *
 * Each request opens the case's sqlite ledger and closes it in a finally block; nothing is
 * cached between requests (the chain is the truth, not memory).
 */

/** J-17: the only message a locked case ever yields — no content, no auto-decrypt. */
export const param = (v: string | string[] | undefined): string => (typeof v === "string" ? v : "");

/**
 * P3-010: the raw viewer serves evidence up to this size. Anything larger is refused with its
 * metadata (413) — never partial content. Blobs are already capped at ingestion; this caps the
 * JSON envelope a single request can produce (local imports can be big).
 */
const EVIDENCE_MAX_BYTES = 16 * 1024 * 1024;

/**
 * A case id is a ULID (26 Crockford-base32 chars). The :id path parameter reaches the file
 * system (the cases root is <root>/<id>), so it is validated against this closed pattern
 * before any path is built — anything else is an unknown case (404), never a path.
 */
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const caseIdParam = (v: string | string[] | undefined): string | null => {
  const id = param(v);
  return ULID_RE.test(id) ? id : null;
};

const LOCKED_MESSAGE = "مقفلة — تتطلب فك التشفير";

/** The wire shape of a case as it appears in a listing or after a lifecycle update. */
export interface CaseWireSummary {
  id: string;
  title: string | null;
  purpose: string | null;
  legalBasis: string | null;
  createdAt: string;
  archivedAt: string | null;
  sensitivity: string | null;
  tags: string[] | null;
  encrypted: boolean;
  status: "active" | "archived" | "locked-encrypted";
  lastActivityAt: string | null;
}

type CaseRecordShape = {
  id: string;
  title: string;
  purpose: string;
  legalBasis: string;
  createdAt: string;
  archivedAt: string | null;
  sensitivity: string;
  tags: string[];
};

/** Full summary of a readable case (J-17 does not apply — the caller could read the content). */
function summaryOf(rec: CaseRecordShape, fp: CaseFingerprint): CaseWireSummary {
  return {
    id: rec.id,
    title: rec.title,
    purpose: rec.purpose,
    legalBasis: rec.legalBasis,
    createdAt: fp.createdAt || rec.createdAt,
    archivedAt: rec.archivedAt ?? null,
    sensitivity: rec.sensitivity,
    tags: rec.tags ?? null,
    encrypted: fp.encrypted,
    status: rec.archivedAt ? "archived" : "active",
    lastActivityAt: fp.lastActivityAt,
  };
}

/** J-17: the identifier-only summary of a locked case — no title, no purpose, no names. */
function lockedSummaryOf(fp: CaseFingerprint): CaseWireSummary {
  return {
    id: fp.caseId,
    title: null,
    purpose: null,
    legalBasis: null,
    createdAt: fp.createdAt,
    archivedAt: null,
    sensitivity: null,
    tags: null,
    encrypted: true,
    status: "locked-encrypted",
    lastActivityAt: fp.lastActivityAt,
  };
}

export function casesRouter(getRoot: () => string, opts: { env?: NodeJS.ProcessEnv } = {}): IRouter {
  const router: IRouter = Router();
  const admin = requireAdmin(opts.env ?? process.env);
  // L-53: the ceiling is env-configurable (default unchanged — production keeps 60/min).
  // What the CI failure artifact PROVED is that case-open received HTTP 429; which of
  // the two /api limiters (this one or the global one) rejected it is not conclusively
  // distinguishable from the artifact. The override makes the ceiling a deployment
  // decision; raising it for the e2e suite is mitigation, not proof of the cause.
  const routeRateLimit = Number((opts.env ?? process.env)["IR_CASES_RATE_LIMIT"] ?? 60);
  const limiter = rateLimit({ windowMs: 60_000, limit: routeRateLimit, standardHeaders: "draft-8", legacyHeaders: false });

  /**
   * Lists case directories, skipping staging dirs (they start with a dot). The directory
   * names come from readdirSync — never from request input — so every path built from
   * them is untainted by construction (the CodeQL path-injection flow ends here).
   */
  const caseDirs = (): Array<{ dir: string; fp: CaseFingerprint }> => {
    const root = getRoot();
    const out: Array<{ dir: string; fp: CaseFingerprint }> = [];
    // P3-020: a fresh deployment's root may not exist yet (no case was ever created) —
    // that is an honest empty list, never an ENOENT 500 (UC-01's cold journey).
    if (!existsSync(root)) return out;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const dir = path.join(root, entry.name);
      const fp = caseFingerprint(dir);
      if (fp) out.push({ dir, fp });
    }
    return out;
  };

  /**
   * Resolves a case id to its directory by matching the id against the case ids the root
   * actually contains. The returned path is built from the readdir result, so request
   * input never becomes a file path (defense in depth on top of the ULID gate).
   */
  const findCaseDir = (id: string): { dir: string; fp: CaseFingerprint } | null => {
    for (const c of caseDirs()) if (c.fp.caseId === id) return c;
    return null;
  };

  // GET /cases — list. J-17: locked cases as identifiers only; J-16: archived hidden by default.
  router.get("/cases", limiter, admin, (req, res) => {
    const includeArchived = req.query["includeArchived"] === "true";
    const cases: CaseWireSummary[] = [];
    for (const { dir, fp } of caseDirs()) {
      if (fp.encrypted) {
        cases.push(lockedSummaryOf(fp));
        continue;
      }
      const c = openCase(dir, { readOnly: true, skipChainCheck: true, actor: "system" });
      try {
        const info = c.info() as CaseRecordShape;
        if (info.archivedAt && !includeArchived) continue;
        cases.push(summaryOf(info, fp));
      } finally {
        c.close();
      }
    }
    res.json({ cases });
  });

  // POST /cases — create (UC-01). E-01 is enforced by the schema: no purpose, no case.
  router.post("/cases", limiter, admin, (req, res) => {
    const parsed = CreateCaseBody.safeParse(req.body);
    if (!parsed.success) {
      // E-01 fail-closed: a purpose shorter than 10 characters is rejected here.
      res.status(400).json({ error: "invalid case input", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
      return;
    }
    const { passphrase, ...create } = parsed.data;
    const root = getRoot();
    mkdirSync(root, { recursive: true });
    // The case id is minted inside the store, so create in a staging dir and rename to <root>/<caseId>.
    const staging = path.join(root, `.tmp-${randomUUID().slice(0, 8)}`);
    try {
      const c = openCase(staging, { create: create as CaseInit, passphrase, actor: "web" });
      let info: CaseRecordShape;
      try {
        info = c.info() as CaseRecordShape;
      } finally {
        c.close();
      }
      renameSync(staging, path.join(root, info.id));
      const fp = caseFingerprint(path.join(root, info.id));
      res
        .status(201)
        .json(
          fp
            ? summaryOf(info, fp)
            : summaryOf(info, { caseId: info.id, createdAt: info.createdAt, encrypted: Boolean(passphrase), lastActivityAt: null }),
        );
    } catch (x) {
      rmSync(staging, { recursive: true, force: true }); // a rejected case leaves no files behind (E-01)
      logger.error({ err: x }, "case creation failed");
      res.status(500).json({ error: "case creation failed" });
    }
  });

  // GET /cases/:id — detail. J-17: a locked case yields an explicit message and no content.
  router.get("/cases/:id", limiter, admin, (req, res) => {
    const id = caseIdParam(req.params["id"]);
    if (!id) {
      res.status(404).json({ error: "no case with this id" });
      return;
    }
    const found = findCaseDir(id);
    if (!found) {
      res.status(404).json({ error: "no case with this id" });
      return;
    }
    const { dir, fp } = found;
    if (fp.encrypted) {
      res.json({ ...lockedSummaryOf(fp), retention: null, ownerId: null, message: LOCKED_MESSAGE });
      return;
    }
    const c = openCase(dir, { readOnly: true, skipChainCheck: true, actor: "system" });
    try {
      const info = c.info() as CaseRecordShape & { retention: unknown; ownerId: string };
      res.json({ ...summaryOf(info, fp), retention: info.retention ?? null, ownerId: info.ownerId, message: null });
    } finally {
      c.close();
    }
  });

  // GET /cases/:id/stats — P3-012 («أرقام تطابق الإسقاط"): the case's own projection
  // counts, taken from ONE projection snapshot — never a parallel recount that could
  // drift from the ledger. J-17: a locked case fails closed with the identifier-only
  // message and NO numbers — never zeros that look like real statistics. A read
  // failure is a 500, not fake numbers. Same admin boundary as every case route.
  router.get("/cases/:id/stats", limiter, admin, (req, res) => {
    const id = caseIdParam(req.params["id"]);
    if (!id) {
      res.status(404).json({ error: "no case with this id" });
      return;
    }
    const found = findCaseDir(id);
    if (!found) {
      res.status(404).json({ error: "no case with this id" });
      return;
    }
    if (found.fp.encrypted) {
      // J-17: not even a count is readable from a locked case.
      res.status(403).json({ error: LOCKED_MESSAGE });
      return;
    }
    const { dir } = found;
    const c = openCase(dir, { readOnly: true, skipChainCheck: true, actor: "system" });
    try {
      const p = c.projection();
      res.json({ seq: p.seq, counts: p.counts });
    } finally {
      c.close();
    }
  });

  // GET /cases/:id/projection — P3-015 («فتح قضية بعد إعادة التشغيل»): the data path of
  // re-opening a saved case in the workbench. Serves the case's own projection
  // snapshot — the exact shape `ir project --json` emits ({...projection, sha256}) —
  // from the durable store, so the graph the workbench renders after a restart is
  // the case's own snapshot, never a browser rebuild. J-17: a locked case fails
  // closed with the locked message — never an empty graph that looks like an opened
  // case. The route opens the case readOnly and never mutates it; same admin
  // boundary as every case route (D-037).
  router.get("/cases/:id/projection", limiter, admin, (req, res) => {
    const id = caseIdParam(req.params["id"]);
    if (!id) {
      res.status(404).json({ error: "no case with this id" });
      return;
    }
    const found = findCaseDir(id);
    if (!found) {
      res.status(404).json({ error: "no case with this id" });
      return;
    }
    if (found.fp.encrypted) {
      // J-17: not even the projection shape is readable — an empty case would look
      // like an opened one, so the locked case fails closed instead.
      res.status(403).json({ error: LOCKED_MESSAGE });
      return;
    }
    const { dir } = found;
    const c = openCase(dir, { readOnly: true, skipChainCheck: true, actor: "system" });
    try {
      const p = c.projection();
      res.json({ ...p, sha256: projectionHash(p) });
    } finally {
      c.close();
    }
  });

  // GET /cases/:id/export — P3-014 (يصدر الصيغ المتاحة في المرحلة): the phase's export
  // format is the projection snapshot JSON — the exact shape `ir project --json` emits
  // ({...projection, sha256}) — served as a download from ONE projection snapshot of the
  // case itself, never a parallel rebuild. The file is named what it is: a projection
  // snapshot, NOT a full copy of the case and its evidence. J-17: a locked case fails
  // closed. An unsupported format is an explicit 400 naming the supported formats — never
  // a silent fallback. Exporting opens the case readOnly and never mutates it.
  router.get("/cases/:id/export/:format", limiter, admin, (req, res) => {
    const format = req.params["format"];
    if (format !== "projection") {
      res.status(400).json({ error: "unsupported export format — supported: projection" });
      return;
    }
    const id = caseIdParam(req.params["id"]);
    if (!id) {
      res.status(404).json({ error: "no case with this id" });
      return;
    }
    const found = findCaseDir(id);
    if (!found) {
      res.status(404).json({ error: "no case with this id" });
      return;
    }
    if (found.fp.encrypted) {
      // J-17: nothing is exported from a locked case.
      res.status(403).json({ error: LOCKED_MESSAGE });
      return;
    }
    const { dir } = found;
    const c = openCase(dir, { readOnly: true, skipChainCheck: true, actor: "system" });
    try {
      const p = c.projection();
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="case-${id}-projection.json"`);
      res.json({ ...p, sha256: projectionHash(p) });
    } finally {
      c.close();
    }
  });

  // GET /cases/:id/evidence/:evidenceId — raw evidence content (P3-010).
  // The safe raw viewer's data path: the bytes come from the case's content-addressed blobs
  // (P1-010) through the same admin boundary as every case route (D-037). Every read
  // re-verifies the blob (T-LED-019), so a missing or corrupt blob is a fail-closed 500 — never
  // partial content. A locked (encrypted) case fails closed with the J-17 message and no
  // content. Binary evidence is refused honestly (encoding: "binary", empty content) instead
  // of being corrupted by a lossy decode — the declared raw-viewer limit.
  router.get("/cases/:id/evidence/:evidenceId", limiter, admin, (req, res) => {
    const id = caseIdParam(req.params["id"]);
    const evidenceId = caseIdParam(req.params["evidenceId"]);
    if (!id || !evidenceId) {
      res.status(404).json({ error: "no case with this id" });
      return;
    }
    const found = findCaseDir(id);
    if (!found) {
      res.status(404).json({ error: "no case with this id" });
      return;
    }
    const { dir, fp } = found;
    if (fp.encrypted) {
      // J-17: not even a title is readable — evidence content never leaves a locked case.
      res.status(403).json({ error: LOCKED_MESSAGE });
      return;
    }
    const c = openCase(dir, { readOnly: true, skipChainCheck: true, actor: "system" });
    try {
      const row = c.db.prepare("SELECT id, sha256, mime, size, fetched_at, transform_id FROM evidence WHERE id = ?").get(evidenceId) as
        { id: string; sha256: string; mime: string; size: number; fetched_at: string; transform_id: string } | undefined;
      if (!row) {
        res.status(404).json({ error: "no evidence with this id" });
        return;
      }
      if (row.size > EVIDENCE_MAX_BYTES) {
        // The raw viewer refuses oversized evidence with its metadata — never partial content.
        res.status(413).json({ error: "evidence too large for the raw viewer (16 MiB cap)", size: row.size });
        return;
      }
      let bytes: Uint8Array;
      try {
        bytes = c.blobs.get(row.sha256); // verifies the content hash (or HMAC) on every read
      } catch (x) {
        logger.error({ err: x, caseId: id, evidenceId }, "evidence read failed");
        res.status(500).json({ error: "evidence read failed — the blob is missing or corrupt" });
        return;
      }
      if (bytes.length !== row.size) {
        logger.error({ caseId: id, evidenceId, indexed: row.size, actual: bytes.length }, "evidence size mismatch");
        res.status(500).json({ error: "evidence read failed — the blob is missing or corrupt" });
        return;
      }
      const base = {
        id: row.id,
        mime: row.mime,
        sha256: row.sha256,
        size: row.size,
        fetchedAt: row.fetched_at,
        transformId: row.transform_id,
      };
      if (isTextualMime(row.mime)) {
        // Display-only lossy decode (replacement characters); integrity stays checkable via sha256.
        res.json({ evidence: { ...base, encoding: "utf-8", content: new TextDecoder().decode(bytes) } });
      } else {
        res.json({ evidence: { ...base, encoding: "binary", content: "" } });
      }
    } finally {
      c.close();
    }
  });

  // POST /cases/:id/notes — P3-021 («ملاحظة»): the context-menu note action's data path.
  // The note is durable case data — a `note.added` entry appended to the case's own
  // hash-chained ledger (the kind already exists in the schema; every projection counts
  // it), targeting the node by its permanent entity id (stable across merges). The same
  // posture as every case write: admin boundary, rate limit, locked case fails closed
  // (J-17), archived case is write-blocked (J-16), and the target node must exist in the
  // case's OWN projection — a note about a node the case does not contain is a 422,
  // never a silently orphaned event. The write itself is the case store's append (the
  // same path the lifecycle audit events use), inside a transaction the store owns.
  router.post("/cases/:id/notes", limiter, admin, (req, res) => {
    const parsed = AddCaseNoteBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid note input", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
      return;
    }
    const { nodeId, text } = parsed.data;
    const id = caseIdParam(req.params["id"]);
    if (!id) {
      res.status(404).json({ error: "no case with this id" });
      return;
    }
    const found = findCaseDir(id);
    if (!found) {
      res.status(404).json({ error: "no case with this id" });
      return;
    }
    const { dir, fp } = found;
    if (fp.encrypted) {
      // J-17: no content is written to a locked case — not even a note.
      res.status(403).json({ error: LOCKED_MESSAGE });
      return;
    }
    const c = openCase(dir, { actor: "web" });
    try {
      const info = c.info() as CaseRecordShape;
      if (info.archivedAt) {
        // J-16: archived = write-blocked — a note is a content write, and unarchiving is
        // the only path back to writing (with a PurposeConfirmation).
        res.status(409).json({ error: "القضية مؤرشفة — لا كتابة على المؤرشف (J-16)" });
        return;
      }
      // The target must be part of the case's own projection — its graph's node ids are
      // the permanent entity ids (the survivor's after merges).
      const p = c.projection();
      if (!p.graph.nodes.some((n) => n.id === nodeId)) {
        res.status(422).json({ error: "no node with this id in this case" });
        return;
      }
      const entry = c.append("note.added", { nodeId, text });
      c.audit("note.added", id, { nodeId, seq: entry.seq });
      res.status(201).json({ seq: entry.seq, nodeId, text, at: entry.at, actor: entry.actor });
    } finally {
      c.close();
    }
  });

  // GET /cases/:id/merge-suggestions — P4-005 (UC-11): the merge-review data path.
  // An EXPLICIT request — no background job ever computes suggestions. The records
  // come from the case's OWN projection (its graph nodes are the CURRENT nodes:
  // already-merged pairs are not separate nodes, so they are excluded by construction)
  // through the thin adapter (a fixed documented policy — labels.ar ?? labels.en ??
  // canonicalKey; props read only when actually present). Scoring uses the PINNED
  // model er-model/1 — frozen weights with a documented training origin; the cases
  // are unlabeled so the model is never estimated from production data. The response
  // carries the model version and the case version stamp (the projection seq) —
  // the accept request MUST echo both. The score is a match score (log-odds), NOT
  // a calibrated confidence; a strong suggestion is still a SUGGESTION (D9: no
  // automatic merge). Read-only: this route never mutates the case.
  router.get("/cases/:id/merge-suggestions", limiter, admin, (req, res) => {
    const id = caseIdParam(req.params["id"]);
    if (!id) {
      res.status(404).json({ error: "no case with this id" });
      return;
    }
    const found = findCaseDir(id);
    if (!found) {
      res.status(404).json({ error: "no case with this id" });
      return;
    }
    if (found.fp.encrypted) {
      res.status(403).json({ error: LOCKED_MESSAGE });
      return;
    }
    const c = openCase(found.dir, { readOnly: true, skipChainCheck: true, actor: "system" });
    try {
      const p = c.projection();
      const records = p.graph.nodes.map(toErRecord);
      const suggestions = resolveEntities(records, ER_MODEL_WEIGHTS);
      res.json({ modelVersion: ER_MODEL_VERSION, caseVersion: p.seq, suggestions });
    } finally {
      c.close();
    }
  });

  // GET /cases/:id/merges — P4-005: the durable merge log (every merge.decided with
  // its revert state, in ledger order). The review UI serves the revert action
  // from THIS list — the id it posts is the merge's own id.
  router.get("/cases/:id/merges", limiter, admin, (req, res) => {
    const id = caseIdParam(req.params["id"]);
    if (!id) {
      res.status(404).json({ error: "no case with this id" });
      return;
    }
    const found = findCaseDir(id);
    if (!found) {
      res.status(404).json({ error: "no case with this id" });
      return;
    }
    if (found.fp.encrypted) {
      res.status(403).json({ error: LOCKED_MESSAGE });
      return;
    }
    const c = openCase(found.dir, { readOnly: true, skipChainCheck: true, actor: "system" });
    try {
      const p = c.projection();
      res.json({ merges: p.mergeDecisions });
    } finally {
      c.close();
    }
  });

  // POST /cases/:id/merges — P4-005 (UC-11): the human-accepted merge — a
  // `merge.decided` entry in the case's own hash-chained ledger. EXACTLY two
  // entities (binary merge) of COMPATIBLE types — the declared compatibility
  // table is initially: SAME TYPE ONLY (an empty extension table; extending it
  // is an explicit owner decision, never a silent behavior). The server NEVER
  // trusts client-sent scores/reasons: it re-derives the reasons itself by
  // re-scoring the pair with the pinned model. The body echoes the
  // modelVersion and caseVersion of the answered suggestion — the check and
  // the append run in ONE atomic write scope (appendIfSeq), so a stale stamp
  // can never append on top of a changed case (409, no partial write). The
  // entities must be CURRENT distinct nodes of the case's own projection; a
  // pair already merged is a 409; an id the case never contained is a 422 —
  // never a silently orphaned event.
  /**
   * P4-005: the accept-merge entity validation (extracted to keep the route handler
   * simple). Returns the two CURRENT nodes on success, or the error response
   * (status + message) the route answers with: an already-merged pair is a 409;
   * an id the case's own projection never contained is a 422 — never an orphaned
   * event; incompatible types are a 422 (the declared table: same type only).
   */
  const validateMergeEntities = (
    p: ReturnType<Case["projection"]>,
    entityIds: [string, string],
    survivorId: string,
  ): { status: number; error: string } | { nodes: [GraphNode, GraphNode] } => {
    const [a, b] = entityIds;
    if (a === b) return { status: 422, error: "entityIds must be two DISTINCT entities" };
    const nodes = new Map(p.graph.nodes.map((n) => [n.id, n]));
    // the node each id is CURRENTLY shown under: a current node is itself; a
    // merged-away (or canonical-key duplicate) id resolves to its survivor node
    const knownAlias = new Map<string, string>();
    for (const n of p.graph.nodes) for (const x of n.aliases) knownAlias.set(x, n.id);
    const resolveOf = (x: string): string | undefined => (nodes.has(x) ? x : knownAlias.get(x));
    const ra = resolveOf(a);
    const rb = resolveOf(b);
    if (ra !== undefined && rb !== undefined && ra === rb) {
      // both ids are the SAME current node — the pair is already merged (409)
      return { status: 409, error: "this pair is already merged" };
    }
    if (ra === undefined || rb === undefined) {
      return { status: 422, error: "no entity with this id in this case" };
    }
    const na = nodes.get(ra);
    const nb = nodes.get(rb);
    if (!na || !nb) return { status: 422, error: "no entity with this id in this case" };
    if (na.type !== nb.type) {
      // the declared compatibility table: same type only (see the route doc)
      return { status: 422, error: `incompatible types (${na.type} vs ${nb.type}) — the declared table allows same-type merges only` };
    }
    if (!entityIds.includes(survivorId)) return { status: 422, error: "survivor must be one of entityIds" };
    return { nodes: [na, nb] };
  };

  router.post("/cases/:id/merges", limiter, admin, (req, res) => {
    const parsed = AcceptCaseMergeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid merge input", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
      return;
    }
    const { entityIds, survivorId, modelVersion, caseVersion } = parsed.data;
    const id = caseIdParam(req.params["id"]);
    if (!id) {
      res.status(404).json({ error: "no case with this id" });
      return;
    }
    const found = findCaseDir(id);
    if (!found) {
      res.status(404).json({ error: "no case with this id" });
      return;
    }
    const { dir, fp } = found;
    if (fp.encrypted) {
      res.status(403).json({ error: LOCKED_MESSAGE });
      return;
    }
    if (modelVersion !== ER_MODEL_VERSION) {
      // the pinned model is part of the contract — an unknown version is never silently accepted
      res.status(409).json({ error: `unknown model version ${modelVersion} — the pinned model is ${ER_MODEL_VERSION}` });
      return;
    }
    const c = openCase(dir, { actor: "web" });
    try {
      const info = c.info() as CaseRecordShape;
      if (info.archivedAt) {
        res.status(409).json({ error: "القضية مؤرشفة — لا كتابة على المؤرشف (J-16)" });
        return;
      }
      const p = c.projection();
      const validated = validateMergeEntities(p, entityIds as [string, string], survivorId);
      if ("status" in validated) {
        res.status(validated.status).json({ error: validated.error });
        return;
      }
      const [na, nb] = validated.nodes;
      // SERVER-derived reasons: re-score the pair with the pinned model — the
      // human's acceptance is itself a reason (UC-11: دمج بأسباب), so the list is
      // never empty even when the model alone scores the pair "none".
      const scored = scorePair(toErRecord(na), toErRecord(nb), ER_MODEL_WEIGHTS);
      const reasons = ["دمج مقبول بشرياً (UC-11)", ...scored.reasons.map((r) => `${r.detail} (وزن ${r.weight.toFixed(2)})`)];
      const mergeId = ulidFactory()();
      const decidedAt = new Date().toISOString(); // the decision's own timestamp (the entry's `at` is the append's)
      // ONE atomic write scope: the stale check and the append cannot interleave
      // with another writer (appendIfSeq) — a stale suggestion never writes.
      const entry = c.appendIfSeq(
        "merge.decided",
        { id: mergeId, entityIds, survivorId, reasons, decidedBy: "web", decidedAt, reverted: false },
        caseVersion,
      );
      if (!entry) {
        res.status(409).json({ error: "the case changed since the suggestion — refresh and review again" });
        return;
      }
      c.audit("merge.decided", id, { mergeId, seq: entry.seq });
      res.status(201).json({ id: mergeId, entityIds, survivorId, reasons, decidedBy: "web", decidedAt, seq: entry.seq });
    } finally {
      c.close();
    }
  });

  // POST /cases/:id/merges/:mergeId/revert — P4-005 (UC-11): the revert. A
  // merge.reverted EVENT (never a deletion — both events stay in the valid
  // ledger) that restores the case's contract-covered semantic state to its
  // prior sequence. A repeated revert is an idempotent 200 with NO new event.
  // The merge id comes from the case's own merge log; an unknown id is a 404.
  router.post("/cases/:id/merges/:mergeId/revert", limiter, admin, (req, res) => {
    const id = caseIdParam(req.params["id"]);
    const mergeId = param(req.params["mergeId"]);
    if (!id || !mergeId) {
      res.status(404).json({ error: "no case with this id" });
      return;
    }
    const found = findCaseDir(id);
    if (!found) {
      res.status(404).json({ error: "no case with this id" });
      return;
    }
    const { dir, fp } = found;
    if (fp.encrypted) {
      res.status(403).json({ error: LOCKED_MESSAGE });
      return;
    }
    const c = openCase(dir, { actor: "web" });
    try {
      const info = c.info() as CaseRecordShape;
      if (info.archivedAt) {
        res.status(409).json({ error: "القضية مؤرشفة — لا كتابة على المؤرشف (J-16)" });
        return;
      }
      const p = c.projection();
      const merge = p.mergeDecisions.find((m) => m.id === mergeId);
      if (!merge) {
        res.status(404).json({ error: "no merge with this id in this case" });
        return;
      }
      if (merge.reverted) {
        // idempotent: the state is already reverted — no new event
        res.json(merge);
        return;
      }
      const entry = c.appendIfSeq("merge.reverted", { mergeId }, p.seq);
      if (!entry) {
        res.status(409).json({ error: "the case changed — refresh and retry" });
        return;
      }
      c.audit("merge.reverted", id, { mergeId, seq: entry.seq });
      const after = c.projection().mergeDecisions.find((m) => m.id === mergeId);
      res.json(after ?? { ...merge, reverted: true });
    } finally {
      c.close();
    }
  });

  // PATCH /cases/:id — lifecycle only (J-16). No content modification, no delete.
  router.patch("/cases/:id", limiter, admin, (req, res) => {
    const parsed = UpdateCaseLifecycleBody.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "invalid lifecycle input", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
      return;
    }
    const { action, reason, purposeConfirmation } = parsed.data;
    const id = caseIdParam(req.params["id"]);
    if (!id) {
      res.status(404).json({ error: "no case with this id" });
      return;
    }
    const found = findCaseDir(id);
    if (!found) {
      res.status(404).json({ error: "no case with this id" });
      return;
    }
    const { dir, fp } = found;
    if (fp.encrypted) {
      // A locked case cannot be lifecycle-managed — fail closed (J-17: not even a title is readable).
      res.status(409).json({ error: "القضية مقفلة — لا يمكن تعديل دورة حياتها قبل فك التشفير" });
      return;
    }
    const c = openCase(dir, { actor: "web" });
    try {
      const info = c.info() as CaseRecordShape;
      if (action === "archive") {
        if (info.archivedAt) {
          res.status(409).json({ error: "القضية مؤرشفة أصلاً — لا كتابة على المؤرشف (J-16)" });
          return;
        }
        const rec = c.update({ archivedAt: new Date().toISOString() }, reason) as CaseRecordShape;
        c.audit("case.archived", rec.id, { reason });
        res.json(summaryOf(rec, fp));
        return;
      }
      // unarchive — an explicit action that requires a PurposeConfirmation (E-02 pattern).
      if (!info.archivedAt) {
        res.status(409).json({ error: "القضية نشطة أصلاً" });
        return;
      }
      const confirmation = purposeConfirmation?.trim() ?? "";
      if (confirmation.length < 10) {
        // E-02 fail-closed: no purpose confirmation, no unarchive.
        res.status(422).json({ error: "إعادة الفتح تتطلب تأكيد غرض صريحاً (PurposeConfirmation — نمط E-02)" });
        return;
      }
      const rec = c.update({ archivedAt: null }, `${reason} — تأكيد الغرض: ${confirmation}`) as CaseRecordShape;
      c.audit("case.unarchived", rec.id, { reason, purposeConfirmation: confirmation });
      res.json(summaryOf(rec, fp));
    } finally {
      c.close();
    }
  });

  return router;
}
