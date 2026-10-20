import { mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import { caseFingerprint, openCase, type CaseFingerprint, type CaseInit } from "@ir/store";
import { projectionHash } from "@ir/ledger/projections";
import { isTextualMime } from "@ir/schema";
import { CreateCaseBody, UpdateCaseLifecycleBody } from "@workspace/api-zod";
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
  const limiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: "draft-8", legacyHeaders: false });

  /**
   * Lists case directories, skipping staging dirs (they start with a dot). The directory
   * names come from readdirSync — never from request input — so every path built from
   * them is untainted by construction (the CodeQL path-injection flow ends here).
   */
  const caseDirs = (): Array<{ dir: string; fp: CaseFingerprint }> => {
    const root = getRoot();
    const out: Array<{ dir: string; fp: CaseFingerprint }> = [];
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
