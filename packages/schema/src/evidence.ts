import { z } from "zod/v4";
import { Sensitivity, Sha256, Slug, Timestamp, Ulid, LicenseClass } from "./primitives.ts";

/** Header names that must never be persisted (5.5 privacy). */
export const REDACTED_HEADERS = ["authorization", "proxy-authorization", "cookie", "set-cookie", "x-api-key"] as const;

export const RecordedRequest = z
  .object({
    method: z.enum(["GET", "POST", "HEAD", "DNS", "LOCAL"]),
    url: z.string().min(1),
    headers: z.record(z.string(), z.string()).default({}),
    status: z.number().int().optional(),
  })
  .refine((r) => Object.keys(r.headers).every((h) => !(REDACTED_HEADERS as readonly string[]).includes(h.toLowerCase())), {
    message: "secret headers must be redacted before saving (5.5)",
    path: ["headers"],
  });

/** D1: raw evidence, content-addressed (blobs/<sha256[0:2]>/<sha256>). */
export const Evidence = z
  .object({
    id: Ulid,
    sha256: Sha256,
    mime: z.string().regex(/^[\w.+-]+\/[\w.+-]+/),
    size: z.number().int().min(0),
    blobRef: z.string().regex(/^blobs\/[0-9a-f]{2}\/[0-9a-f]{64}$/),
    fetchedAt: Timestamp,
    request: RecordedRequest,
    transformId: Slug,
    version: z.string().min(1),
    /**
     * P2-014: how this request was EXECUTED (an execution mode, not proof a connection happened):
     * "network" = the real gateway path — which may still end in a denial BEFORE any transport call
     * (a request row with zero transport calls is the honest record of that);
     * "sim" = the deterministic simulation world; "replay" = served from stored evidence.
     * Absent on entries recorded before this field existed (legacy: treat as unknown, not as a real connection).
     */
    origin: z.enum(["network", "sim", "replay"]).optional(),
  })
  .refine((e) => e.blobRef === `blobs/${e.sha256.slice(0, 2)}/${e.sha256}`, { message: "blobRef must match sha256", path: ["blobRef"] });
export type Evidence = z.infer<typeof Evidence>;

export const LedgerKind = z.enum([
  "case.created",
  "entity.added",
  "claim.added",
  "observation.added",
  "evidence.stored",
  "merge.decided",
  "merge.reverted",
  "checkpoint",
  "note.added",
  "case.updated",
  "audit.event",
]);

/** Append-only hash chain entry (5.5, ADR-06). entryHash = SHA-256(JCS(["ir-ledger/1", prevHash, seq, kind, at, actor, payload])). */
export const LedgerEntry = z
  .object({
    seq: z.number().int().min(0),
    prevHash: Sha256.nullable(),
    entryHash: Sha256,
    kind: LedgerKind,
    payload: z.unknown(),
    at: Timestamp,
    actor: z.string().min(1),
  })
  .refine((l) => (l.seq === 0) === (l.prevHash === null), { message: "only seq 0 has prevHash null", path: ["prevHash"] });
export type LedgerEntry = z.infer<typeof LedgerEntry>;

/** E-10: immutable audit trail for every sensitive action. */
export const AuditEvent = z.object({
  id: Ulid,
  at: Timestamp,
  actor: z.string().min(1),
  action: Slug,
  target: z.string().min(1),
  purposeRef: Ulid,
  detail: z.record(z.string(), z.unknown()).optional(),
});
export type AuditEvent = z.infer<typeof AuditEvent>;

/** D7: capability manifest of a sandboxed transform. */
export const TransformManifest = z.object({
  id: z.string().regex(/^TR-\d{3}$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  inputs: z.array(Slug).min(1),
  outputs: z.array(Slug).min(1),
  // ADR-08 §3 (P2-004): a transform declares its destination mode explicitly.
  // `pinned` requires a non-empty allow list (exact-match destinations, e.g. secret
  // transport); `public` requires an empty one (any public host, no secrets). A
  // manifest without a mode is invalid (fail-closed: no mode = no network).
  network: z
    .object({
      mode: z.enum(["public", "pinned"]),
      allow: z.array(z.string().regex(/^[a-z0-9.-]+$/)),
    })
    .refine((n) => (n.mode === "pinned" ? n.allow.length > 0 : n.allow.length === 0), {
      message: "pinned mode requires a non-empty allow list; public mode requires an empty one",
    }),
  secrets: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/)).default([]),
  // Run-time environment the transform reads by name (fail-closed in isolation: the sandboxed child
  // gets ONLY these names, and only when the parent has them — an undeclared name never reaches the
  // sandbox. P2-011 review fix, 2026-10-15: TR-028's catalog token (IR_EU_FSD_TOKEN) arrives this way).
  env: z.array(z.string().regex(/^IR_[A-Z0-9_]+$/)).default([]),
  limits: z.object({
    rps: z.number().positive(),
    timeoutMs: z.number().int().positive(),
    maxBytes: z.number().int().positive(),
  }),
  sensitivity: Sensitivity,
  license: LicenseClass,
});
export type TransformManifest = z.infer<typeof TransformManifest>;

/** View state is separate from the domain model (fixes D-026). */
export const ViewState = z.object({
  positions: z.record(z.string(), z.object({ x: z.number(), y: z.number() })).default({}),
  layout: z.enum(["force", "hierarchy", "radial", "timeline", "geo"]).default("force"),
  filters: z.record(z.string(), z.unknown()).default({}),
});
export type ViewState = z.infer<typeof ViewState>;
