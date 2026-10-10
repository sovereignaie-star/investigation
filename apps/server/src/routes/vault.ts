import express, { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import { validate } from "@ir/core/validate";
import { assertVaultName, type Vault } from "@ir/store";
import { requireAdmin } from "../lib/admin";
import { KNOWN_PROVIDERS, lookupBreaches, lookupIp, testProviderKey, type FetchLike } from "../lib/providers";

/** Express 5 types route params as string | string[]; routes here take one segment each. */
const param = (v: string | string[] | undefined): string => (typeof v === "string" ? v : "");
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,253}$/;

/** Key vault and keyed lookups (P1-015). No route ever responds with a secret. */
export function vaultRouter(getVault: () => Vault, opts: { fetch?: FetchLike; env?: NodeJS.ProcessEnv } = {}): IRouter {
  const f: FetchLike = opts.fetch ?? ((url, init) => fetch(url, init));
  const router: IRouter = Router();
  const admin = requireAdmin(opts.env);
  const limiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: "draft-8", legacyHeaders: false });
  router.use(["/vault", "/lookup"], limiter);

  router.get("/vault", admin, (_req, res) => {
    const configured = new Map(
      getVault()
        .list()
        .map((e) => [e.name, e.updatedAt]),
    );
    const names = [...new Set([...KNOWN_PROVIDERS, ...configured.keys()])];
    res.json({ entries: names.map((name) => ({ name, configured: configured.has(name), updatedAt: configured.get(name) ?? null })) });
  });

  router.put("/vault/:name", admin, express.json({ limit: "8kb" }), (req, res) => {
    const name = param(req.params["name"]);
    const secret: unknown = (req.body as { secret?: unknown } | undefined)?.secret;
    try {
      assertVaultName(name);
      if (typeof secret !== "string") throw new Error('body must be {"secret": string}');
      const info = getVault().set(name, secret);
      res.json({ name: info.name, configured: true, updatedAt: info.updatedAt });
    } catch (x) {
      res.status(400).json({ error: (x as Error).message });
    }
  });

  router.delete("/vault/:name", admin, (req, res) => {
    res.status(getVault().delete(param(req.params["name"])) ? 204 : 404).end();
  });

  router.post("/vault/:name/test", admin, async (req, res) => {
    try {
      res.json(await testProviderKey(param(req.params["name"]), getVault(), f));
    } catch {
      res.status(502).json({ ok: false, tested: true, error: "provider unreachable" });
    }
  });

  router.get("/lookup/ip/:ip", async (req, res) => {
    const ip = param(req.params["ip"]);
    if (!(validate("ipv4", ip)?.valid || validate("ipv6", ip)?.valid)) {
      res.status(400).json({ error: "invalid IP address" });
      return;
    }
    try {
      const r = await lookupIp(ip, getVault(), f);
      res.status(r.status).json(r.body);
    } catch {
      res.status(502).json({ error: "provider unreachable" });
    }
  });

  router.get("/lookup/breaches/:email", async (req, res) => {
    const email = param(req.params["email"]);
    if (!EMAIL.test(email)) {
      res.status(400).json({ error: "invalid email" });
      return;
    }
    try {
      const r = await lookupBreaches(email, getVault(), f);
      res.status(r.status).json(r.body);
    } catch {
      res.status(502).json({ error: "provider unreachable" });
    }
  });

  return router;
}
