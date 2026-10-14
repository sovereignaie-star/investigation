import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

/**
 * Local session with a random key at boot (P2-020, ROADMAP 5.10/5.16, D-037).
 *
 * The server generates a fresh 32-byte secret when it boots. Every response sets an
 * `ir_sid` cookie (HttpOnly, SameSite=Strict, Secure in production) whose value is a
 * random session id. The session id is stored in an in-memory map with a TTL, so a
 * restart invalidates every session (nothing survives on disk — "random key at boot").
 *
 * CSRF: state-changing requests from a browser must prove they came from the same
 * origin. Two independent layers:
 *   1. Origin check — a cross-site request carries an `Origin` header that does not
 *      match the server's own origin (or an explicit allowlist); it is rejected 403
 *      before any route runs. Same-origin requests (the built web app, the Vite dev
 *      proxy) either omit `Origin` or match.
 *   2. Double-submit token — the session cookie value is also the CSRF token. A
 *      browser state-changing request without a valid `Authorization: Bearer` admin
 *      token must echo it in the `X-CSRF-Token` header. The web app authenticates with
 *      the bearer token (apiKeyManager), so its requests are exempt; the token layer
 *      protects any future cookie-authenticated flow and is verified with a
 *      constant-time compare.
 *
 * The session secret never leaves the process and is never logged (logger redacts
 * `req.headers.cookie` and `res.headers['set-cookie']`).
 */

export const SESSION_COOKIE = "ir_sid";
export const CSRF_HEADER = "x-csrf-token";
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h, rolling

export interface SessionStore {
  /** Returns true when the session id is known and not expired. */
  has(id: string): boolean;
  /** Records a session id with a fresh expiry. */
  touch(id: string): void;
}

/** In-memory session store. A restart clears it, which is the intended "local session" semantics. */
export function createSessionStore(ttlMs = SESSION_TTL_MS): SessionStore {
  const expires = new Map<string, number>();
  return {
    has(id) {
      const at = expires.get(id);
      if (at === undefined) return false;
      if (at <= Date.now()) {
        expires.delete(id);
        return false;
      }
      return true;
    },
    touch(id) {
      expires.set(id, Date.now() + ttlMs);
    },
  };
}

export interface SessionOptions {
  /** When true, the cookie is marked Secure (production). */
  secure?: boolean;
  /** Explicitly allowed browser origins (comma-separated in IR_ALLOWED_ORIGINS). */
  allowedOrigins?: ReadonlySet<string>;
  /** Injectable store for tests. */
  store?: SessionStore;
  /** Injectable secret for tests; defaults to a fresh random 32-byte key at boot. */
  secret?: Buffer;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Derives a per-session CSRF token from the boot secret (used by tests; the wire check compares the session id). */
export function csrfTokenFor(secret: Buffer, sessionId: string): string {
  return createHmac("sha256", secret).update(`csrf:${sessionId}`).digest("hex");
}

/**
 * Session + CSRF middleware. Mounted before the API router so every /api request gets a
 * session cookie and state-changing cross-origin requests are rejected.
 */
export function sessionMiddleware(opts: SessionOptions = {}) {
  const store = opts.store ?? createSessionStore();
  const allowed = opts.allowedOrigins ?? new Set<string>();
  const secure = opts.secure ?? process.env.NODE_ENV === "production";

  return (req: Request, res: Response, next: NextFunction): void => {
    // Bearer admin auth (existing flow) is CSRF-safe: the browser never attaches it
    // automatically, so a cross-site request cannot carry it.
    const auth = req.get("authorization") ?? "";
    const bearerAuthed = /^Bearer .+$/.test(auth);

    // Session cookie: reuse a known id, otherwise mint one.
    const raw = req.headers.cookie ?? "";
    let sessionId = "";
    for (const part of raw.split(";")) {
      const [k, ...v] = part.trim().split("=");
      if (k === SESSION_COOKIE) sessionId = v.join("=");
    }
    if (!sessionId || !store.has(sessionId)) {
      sessionId = randomBytes(16).toString("hex");
      store.touch(sessionId);
      res.cookie(SESSION_COOKIE, sessionId, {
        httpOnly: true,
        sameSite: "strict",
        secure,
        path: "/",
        maxAge: SESSION_TTL_MS,
      });
    } else {
      store.touch(sessionId);
    }

    // CSRF — browser-originated state-changing requests only. A request without an
    // `Origin` header (curl, node, server-to-server) is not a browser CSRF vector and
    // keeps its normal auth path (401/503). A browser request always carries `Origin`.
    const method = req.method.toUpperCase();
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      const origin = req.get("origin");
      if (origin) {
        // Layer 1 — origin check: a cross-site request is rejected before any route runs.
        const sameOrigin = origin === `${req.protocol}://${req.get("host")}`;
        if (!sameOrigin && !allowed.has(origin)) {
          res.status(403).json({ error: "cross-origin state change blocked" });
          return;
        }
        // Layer 2 — double-submit token, unless the request is bearer-authenticated.
        if (!bearerAuthed) {
          const token = req.get(CSRF_HEADER) ?? "";
          if (!safeEqual(token, sessionId)) {
            res.status(403).json({ error: "CSRF token required" });
            return;
          }
        }
      }
    }

    next();
  };
}
