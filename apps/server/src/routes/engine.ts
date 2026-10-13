import { Router, type IRouter, type Request } from "express";
import express from "express";
import rateLimit from "express-rate-limit";
import { RunEngine, type RunInput, type RunPhaseEvent } from "@ir/engine";
import { requireAdmin } from "../lib/admin";

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
   */
  router.get("/runs/:id/events", (req, res) => {
    const runId = param(req.params["id"]);
    const engine = getEngine();
    if (!engine.has(runId)) {
      res.status(404).json({ error: "run not found" });
      return;
    }
    const result = engine.result(runId);
    // A finished run has no further transitions: send the terminal event and close.
    if (result && (result.phase === "succeeded" || result.phase === "failed" || result.phase === "cancelled")) {
      res.setHeader("content-type", "text/event-stream");
      res.setHeader("cache-control", "no-cache");
      res.setHeader("connection", "keep-alive");
      res.write(`event: phase\ndata: ${JSON.stringify({ runId, phase: result.phase })}\n\n`);
      res.end();
      return;
    }
    res.setHeader("content-type", "text/event-stream");
    res.setHeader("cache-control", "no-cache");
    res.setHeader("connection", "keep-alive");
    res.flushHeaders();
    const send = (e: RunPhaseEvent) => {
      res.write(`event: phase\ndata: ${JSON.stringify({ runId: e.runId, phase: e.phase })}\n\n`);
      if (e.phase === "succeeded" || e.phase === "failed" || e.phase === "cancelled") {
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
