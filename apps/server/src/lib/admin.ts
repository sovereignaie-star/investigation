import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/**
 * Guards vault administration (P1-015). With IR_ADMIN_TOKEN set, requests need `Authorization: Bearer <token>`
 * (constant-time compare). Without it, only loopback clients are allowed: a local install works with no setup, and a
 * hosted deployment (requests arrive through the platform proxy) stays closed until a token is configured.
 */
export function requireAdmin(env: NodeJS.ProcessEnv = process.env) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const token = env["IR_ADMIN_TOKEN"];
    if (token) {
      const got = Buffer.from(/^Bearer (.+)$/.exec(req.get("authorization") ?? "")?.[1] ?? "");
      const want = Buffer.from(token);
      if (got.length === want.length && timingSafeEqual(got, want)) return next();
      res.status(401).json({ error: "admin token required" });
      return;
    }
    if (LOOPBACK.has(req.socket.remoteAddress ?? "") && !req.get("x-forwarded-for")) return next();
    res.status(403).json({ error: "set IR_ADMIN_TOKEN to manage keys on a hosted deployment" });
  };
}
