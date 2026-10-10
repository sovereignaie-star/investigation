import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

/**
 * Guards vault administration and keyed lookups. Every sensitive request requires an explicitly configured
 * `IR_ADMIN_TOKEN`; loopback is a network location, not an authentication boundary for browser-reachable endpoints.
 */
export function requireAdmin(env: NodeJS.ProcessEnv = process.env) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const token = env["IR_ADMIN_TOKEN"];
    if (!token) {
      res.status(503).json({ error: "IR_ADMIN_TOKEN must be configured for this endpoint" });
      return;
    }

    const got = Buffer.from(/^Bearer (.+)$/.exec(req.get("authorization") ?? "")?.[1] ?? "");
    const want = Buffer.from(token);
    if (got.length === want.length && timingSafeEqual(got, want)) return next();
    res.status(401).json({ error: "admin token required" });
  };
}
