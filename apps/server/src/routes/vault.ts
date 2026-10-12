import express, { Router, type IRouter, type Request } from "express";
import rateLimit from "express-rate-limit";
import { validate } from "@ir/core/validate";
import { assertVaultName, type Vault } from "@ir/store";
import { requireAdmin } from "../lib/admin";
import {
  KNOWN_PROVIDERS,
  LOOKUPS_GATEWAY_PENDING,
  testProviderKey,
  type VaultDnsResolver,
  type VaultEgressTransport,
} from "../lib/providers";

/** Express 5 types route params as string | string[]; routes here take one segment each. */
const param = (v: string | string[] | undefined): string => (typeof v === "string" ? v : "");
const bodyString = (req: Request, key: "email" | "ip"): string => {
  const value: unknown = (req.body as Record<string, unknown> | undefined)?.[key];
  return typeof value === "string" ? value : "";
};
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,253}$/;

/**
 * P1-030 (owner decision D-2, D-049, D-016): the lookup routes send an investigation identifier (an IP address, an
 * email) to a third party, with no case, purpose, consent or network log yet. Until the egress gateway (P2-003),
 * the natural-person gate (P2-013) and the per-case network log (P2-014) exist, they are off unless the operator
 * sets IR_ENABLE_LOOKUPS=1 exactly; IR_OFFLINE=1 turns them off whatever else is set. Fail closed: any other value,
 * including "true", leaves them off.
 */
export function lookupsEnabled(env: NodeJS.ProcessEnv): boolean {
  return env["IR_OFFLINE"] !== "1" && env["IR_ENABLE_LOOKUPS"] === "1";
}
export const LOOKUPS_DISABLED = {
  error: "external lookups are disabled on this server (set IR_ENABLE_LOOKUPS=1 to allow them; see .env.example)",
} as const;

/** Key vault and keyed lookups (P1-015). No route ever responds with a secret. */
export function vaultRouter(
  getVault: () => Vault,
  opts: {
    env?: NodeJS.ProcessEnv;
    /** The egress transport + resolver for /vault/:name/test. Injected in tests; never a real socket. */
    vaultTestTransport?: VaultEgressTransport;
    vaultTestResolver?: VaultDnsResolver;
  } = {},
): IRouter {
  const lookupsOn = lookupsEnabled(opts.env ?? process.env);
  const router: IRouter = Router();
  const admin = requireAdmin(opts.env);
  const limiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: "draft-8", legacyHeaders: false });

  // Vault writes and provider-funded lookups are not browser-public APIs. Parsing, throttling and authentication are
  // applied as one boundary so an unauthenticated request cannot reach a provider.
  router.use(["/vault", "/lookup"], express.json({ limit: "8kb" }), limiter, admin);
  // checked on every request, after authentication and before the vault or any input is read
  router.use("/lookup", (_req, res, next) => {
    if (lookupsOn) next();
    else res.status(403).json(LOOKUPS_DISABLED);
  });

  router.get("/vault", (_req, res) => {
    const configured = new Map(
      getVault()
        .list()
        .map((e) => [e.name, e.updatedAt]),
    );
    const names = [...new Set([...KNOWN_PROVIDERS, ...configured.keys()])];
    res.json({ entries: names.map((name) => ({ name, configured: configured.has(name), updatedAt: configured.get(name) ?? null })) });
  });

  router.put("/vault/:name", (req, res) => {
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

  router.delete("/vault/:name", (req, res) => {
    res.status(getVault().delete(param(req.params["name"])) ? 204 : 404).end();
  });

  router.post("/vault/:name/test", async (req, res) => {
    try {
      const transport = opts.vaultTestTransport;
      const resolver = opts.vaultTestResolver;
      if (!transport || !resolver) {
        // No transport injected: this is a simulation-only cycle with no real
        // network path. The route degrades to "not tested" (200, tested: false)
        // rather than failing, because the e2e gate calls it on the built
        // server. Production wiring of a real transport is an owner decision.
        res.json({ ok: false, tested: false, reason: "transport_not_configured" });
        return;
      }
      res.json(await testProviderKey(param(req.params["name"]), getVault(), transport, resolver));
    } catch {
      res.status(502).json({ ok: false, tested: true, error: "provider unreachable" });
    }
  });

  router.post("/lookup/ip", async (req, res) => {
    const ip = bodyString(req, "ip");
    if (!(validate("ipv4", ip)?.valid || validate("ipv6", ip)?.valid)) {
      res.status(400).json({ error: "invalid IP address" });
      return;
    }
    res.status(503).json(LOOKUPS_GATEWAY_PENDING);
  });

  router.post("/lookup/breaches", async (req, res) => {
    const email = bodyString(req, "email");
    if (!EMAIL.test(email)) {
      res.status(400).json({ error: "invalid email" });
      return;
    }
    res.status(503).json(LOOKUPS_GATEWAY_PENDING);
  });

  return router;
}
