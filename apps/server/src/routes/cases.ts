import { mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import { caseFingerprint, openCase, type CaseFingerprint, type CaseInit } from "@ir/store";
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

/** A case directory must exist and hold a complete case, otherwise 404. */
function fingerprintOr404(res: { status: (code: number) => { json: (b: unknown) => void } }, dir: string): CaseFingerprint | null {
  const fp = caseFingerprint(dir);
  if (!fp) {
    res.status(404).json({ error: "no case with this id" });
    return null;
  }
  return fp;
}

export function casesRouter(getRoot: () => string, opts: { env?: NodeJS.ProcessEnv } = {}): IRouter {
  const router: IRouter = Router();
  const admin = requireAdmin(opts.env ?? process.env);
  const limiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: "draft-8", legacyHeaders: false });

  /** Lists case directories, skipping staging dirs (they start with a dot). */
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
    const dir = path.join(getRoot(), param(req.params["id"]));
    const fp = fingerprintOr404(res, dir);
    if (!fp) return;
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
    const dir = path.join(getRoot(), param(req.params["id"]));
    const fp = fingerprintOr404(res, dir);
    if (!fp) return;
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
