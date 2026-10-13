import { existsSync } from "node:fs";
import path from "node:path";
import express, { type Express, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import pinoHttp from "pino-http";
import apiRouter from "./routes";
import { logger } from "./lib/logger";
import { sessionMiddleware, type SessionOptions } from "./lib/session";

/** Avoid placing a target identifier in application logs, including requests to a retired legacy lookup URL. */
export function redactRequestUrl(url: string | undefined): string | undefined {
  const path = url?.split("?")[0];
  return path?.startsWith("/api/lookup/") ? "/api/lookup/[redacted]" : path;
}

/**
 * Content-Security-Policy for the built web app (P2-020, D-037). The app is served
 * same-origin; its only external resources are the investigation-result embeds
 * (YouTube / OpenStreetMap iframes, arbitrary image URLs) and the provider lookups
 * that the web client performs directly (dns.google, api.github.com, blockchain.info,
 * api.etherscan.io, api.macvendors.com). Everything else is 'self'.
 */
const CSP_DIRECTIVES: Record<string, string[]> = {
  "default-src": ["'self'"],
  "base-uri": ["'self'"],
  "object-src": ["'none'"],
  "script-src": ["'self'"],
  "style-src": ["'self'", "'unsafe-inline'"], // reactflow / framer-motion inject inline styles
  "img-src": ["'self'", "data:", "https:"], // result images come from arbitrary https hosts
  "font-src": ["'self'", "data:"],
  "connect-src": [
    "'self'",
    "https://dns.google",
    "https://api.github.com",
    "https://blockchain.info",
    "https://api.etherscan.io",
    "https://api.macvendors.com",
  ],
  "frame-src": ["https://www.youtube.com", "https://www.openstreetmap.org"],
  "frame-ancestors": ["'none'"],
  "form-action": ["'self'"],
};

export interface AppOptions {
  /** Environment override (tests). Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /** Extra allowed browser origins for the CSRF origin check. */
  allowedOrigins?: ReadonlySet<string>;
  /** Global /api rate limit per minute. Defaults to 300. */
  apiRateLimit?: number;
  /** Session options (tests inject a store/secret). */
  session?: SessionOptions;
}

/**
 * Builds the single-service app. API CORS is deliberately absent: the built web application is served by this
 * process, and Vite development requests are same-origin after its `/api` proxy. Sensitive API routes must not be
 * callable by an arbitrary browser origin.
 *
 * P2-020 hardening (D-037): helmet security headers (CSP above), a local session with a random key at boot plus
 * CSRF protection (sessionMiddleware), a global API rate limit, and the 8kb body limit below.
 */
export function createApp(router: IRouter = apiRouter, opts: AppOptions = {}): Express {
  const env = opts.env ?? process.env;
  const app: Express = express();

  // Behind Render/Railway (one proxy hop) set TRUST_PROXY=1 so rate limits key on the real client address.
  if (env["TRUST_PROXY"]) app.set("trust proxy", Number(env["TRUST_PROXY"]));

  // Security headers (P2-020). CSP is scoped to the built web app's real resource needs.
  app.use(
    helmet({
      contentSecurityPolicy: { directives: CSP_DIRECTIVES },
      crossOriginEmbedderPolicy: false, // the app embeds YouTube/OSM iframes
    }),
  );

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

  // Local session + CSRF (P2-020): every /api request gets a session cookie; state-changing
  // browser requests are origin-checked and token-checked. IR_ALLOWED_ORIGINS (comma-separated)
  // extends the same-origin check for deployments where the web app is served from another origin.
  const allowedOrigins =
    opts.allowedOrigins ??
    new Set(
      (env["IR_ALLOWED_ORIGINS"] ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
  app.use(sessionMiddleware({ ...opts.session, allowedOrigins, secure: opts.session?.secure ?? env["NODE_ENV"] === "production" }));

  // Global API rate limit (P2-020): a coarse per-client ceiling across all /api routes,
  // on top of the per-route limits (vault 60/min, engine 60/min, web 600/min).
  const apiLimit = opts.apiRateLimit ?? Number(env["IR_API_RATE_LIMIT"] ?? 300);
  const apiLimiter = rateLimit({ windowMs: 60_000, limit: apiLimit, standardHeaders: "draft-8", legacyHeaders: false });
  app.use("/api", apiLimiter);

  app.use(express.json({ limit: "8kb" }));

  app.use("/api", router);

  /**
   * Single-service deployment (P1-024): when the web build exists, the API also serves it, so one process runs the
   * whole platform on Render, Railway, Docker or a local machine. WEB_DIST overrides the location.
   */
  const webDist = env["WEB_DIST"] ?? path.resolve(import.meta.dirname, "..", "..", "web", "dist", "public");
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
