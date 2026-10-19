import { Router, type IRouter, type Request } from "express";
import express from "express";
import rateLimit from "express-rate-limit";
import { RunEngine, type RunInput, type RunPhaseEvent } from "@ir/engine";
import { requireAdmin } from "../lib/admin";
import { logger } from "../lib/logger";

/**
 * Engine REST + SSE routes (P2-019). The engine is injected so tests use a deterministic
 * fake transport; the production server wires a fail-closed transport (no real network
 * until the egress and isolation gates are approved). No route ever performs real
 * network I/O itself.
 *
 * Security posture (D-037): the run routes are not browser-public. They are mounted behind
 * the same admin boundary as the vault (requireAdmin) and rate-limited, so an
 * unauthenticated request cannot submit runs or open event streams.
 */

const param = (v: string | string[] | undefined): string => (typeof v === "string" ? v : "");

function bodyString(req: Request, key: string): string {
  const value: unknown = (req.body as Record<string, unknown> | undefined)?.[key];
  return typeof value === "string" ? value : "";
}

function bodyNumber(req: Request, key: string): number | undefined {
  const value: unknown = (req.body as Record<string, unknown> | undefined)?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Validates a run input body. Returns the input or an error message. */
function parseRunInput(req: Request): { input?: RunInput; error?: string } {
  const kind = bodyString(req, "kind");
  const canonicalInput = bodyString(req, "canonicalInput");
  if (!kind) return { error: "kind is required" };
  if (!canonicalInput) return { error: "canonicalInput is required" };
  const input: RunInput = {
    kind,
    canonicalInput,
    priority: bodyNumber(req, "priority"),
    depth: bodyNumber(req, "depth"),
    costEstimate: bodyNumber(req, "costEstimate"),
  };
  return { input };
}

/** Serializes a run result for the wire (no secrets, no internal fields). */
function serializeResult(runId: string, result: { phase: string; processed: number; transportAttempts: number; failure?: unknown }) {
  return {
    runId,
    phase: result.phase,
    processed: result.processed,
    transportAttempts: result.transportAttempts,
    failure: result.failure ?? null,
  };
}

export function engineRouter(getEngine: () => RunEngine, opts: { env?: NodeJS.ProcessEnv } = {}): IRouter {
  const router: IRouter = Router();
  const admin = requireAdmin(opts.env ?? process.env);
  const limiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: "draft-8", legacyHeaders: false });

  /**
   * P3-011: the run lifecycle. A submitted run must move on its own — nothing in
   * production ever called engine.drain() before this, so runs stayed queued
   * forever. Every submission schedules a drain; drains are SERIALIZED (the
   * engine rejects overlapping drains) through one promise chain, and a failed
   * drain is logged and swallowed — it never disables the next submission's
   * drain (the failed run stays queued per the queue-store contract and is
   * re-attempted by the next drain).
   */
  let drainChain: Promise<void> = Promise.resolve();
  const scheduleDrain = (): void => {
    drainChain = drainChain
      .then(async () => {
        await getEngine().drain();
      })
      .catch((err: unknown) => {
        logger.error({ err }, "engine drain failed");
      });
  };

  // Run submission and event streams are not browser-public: parsing, throttling and
  // authentication are applied as one boundary (same posture as the vault routes).
  router.use(["/runs"], express.json({ limit: "8kb" }), limiter, admin);

  router.post("/runs", (req, res) => {
    const { input, error } = parseRunInput(req);
    if (error) {
      res.status(400).json({ error });
      return;
    }
    if (!input) {
      res.status(400).json({ error: "invalid input" });
      return;
    }
    const handle = getEngine().submit(input);
    // P3-011: the submitted run is executed without waiting for a manual drain.
    scheduleDrain();
    res.status(202).json({ runId: handle.runId, status: "queued" });
  });

  router.get("/runs/:id", (req, res) => {
    const runId = param(req.params["id"]);
    const result = getEngine().result(runId);
    if (!result) {
      res.status(404).json({ error: "run not found" });
      return;
    }
    res.json(serializeResult(runId, result));
  });

  router.delete("/runs/:id", (req, res) => {
    const runId = param(req.params["id"]);
    const cancelled = getEngine().cancel(runId, "user");
    if (!cancelled) {
      res.status(404).json({ error: "run not found or already finished" });
      return;
    }
    res.status(202).json({ runId, status: "cancelling" });
  });

  /**
   * Server-Sent Events stream of phase transitions for a run (P2-019, P3-011).
   * The stream closes when the run reaches a terminal phase (succeeded/failed/cancelled)
   * or the client disconnects. Events are `event: phase` with a JSON data payload.
   *
   * P3-011: two isolation rules. (1) A stream carries ONLY its own run's phases —
   * another run's terminal phase must neither appear on it nor close it. (2) A
   * late subscriber sees the run's CURRENT phase first (snapshot), then the live
   * transitions — a run that started before the browser opened the stream is not
   * rendered as silent until it finishes.
   */
  router.get("/runs/:id/events", (req, res) => {
    const runId = param(req.params["id"]);
    const engine = getEngine();
    if (!engine.has(runId)) {
      res.status(404).json({ error: "run not found" });
      return;
    }
    const isTerminal = (phase: string): boolean => phase === "succeeded" || phase === "failed" || phase === "cancelled";
    res.setHeader("content-type", "text/event-stream");
    res.setHeader("cache-control", "no-cache");
    res.setHeader("connection", "keep-alive");
    const write = (phase: string) => {
      res.write(`event: phase\ndata: ${JSON.stringify({ runId, phase })}\n\n`);
    };
    // Snapshot first: the subscriber sees the phase as of NOW. The listener is
    // registered in the same synchronous tick, so no transition can fall between
    // the snapshot and the subscription.
    const current = engine.phaseOf(runId) ?? "queued";
    write(current);
    if (isTerminal(current)) {
      res.end();
      return;
    }
    const send = (e: RunPhaseEvent) => {
      if (e.runId !== runId) return;
      write(e.phase);
      if (isTerminal(e.phase)) {
        res.end();
        off();
      }
    };
    const off = engine.onPhaseChange(send);
    req.on("close", () => {
      off();
      if (!res.writableEnded) res.end();
    });
  });

  return router;
}
