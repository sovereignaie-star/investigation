import { existsSync } from "node:fs";
import path from "node:path";
import express, { type Express, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import apiRouter from "./routes";
import { logger } from "./lib/logger";

/** Avoid placing a target identifier in application logs, including requests to a retired legacy lookup URL. */
export function redactRequestUrl(url: string | undefined): string | undefined {
  const path = url?.split("?")[0];
  return path?.startsWith("/api/lookup/") ? "/api/lookup/[redacted]" : path;
}

/**
 * Builds the single-service app. API CORS is deliberately absent: the built web application is served by this
 * process, and Vite development requests are same-origin after its `/api` proxy. Sensitive API routes must not be
 * callable by an arbitrary browser origin.
 */
export function createApp(router: IRouter = apiRouter): Express {
  const app: Express = express();

  // Behind Render/Railway (one proxy hop) set TRUST_PROXY=1 so rate limits key on the real client address.
  if (process.env["TRUST_PROXY"]) app.set("trust proxy", Number(process.env["TRUST_PROXY"]));

  app.use(
    pinoHttp({
      logger,
      serializers: {
        req(req) {
          return {
            id: req.id,
            method: req.method,
            url: redactRequestUrl(req.url),
          };
        },
        res(res) {
          return {
            statusCode: res.statusCode,
          };
        },
      },
    }),
  );
  app.use(express.json({ limit: "8kb" }));

  app.use("/api", router);

  /**
   * Single-service deployment (P1-024): when the web build exists, the API also serves it, so one process runs the
   * whole platform on Render, Railway, Docker or a local machine. WEB_DIST overrides the location.
   */
  const webDist = process.env["WEB_DIST"] ?? path.resolve(import.meta.dirname, "..", "..", "web", "dist", "public");
  if (existsSync(path.join(webDist, "index.html"))) {
    // Static files and the SPA fallback touch the file system: limit per client (CodeQL js/missing-rate-limiting).
    const webLimiter = rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: "draft-8", legacyHeaders: false });
    app.use(webLimiter);
    app.use(express.static(webDist, { index: false, maxAge: "1h" }));
    app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => {
      res.sendFile(path.join(webDist, "index.html"));
    });
  }

  return app;
}

export default createApp();
