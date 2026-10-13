import path from "node:path";
import { Router, type IRouter } from "express";
import { RunEngine, type BudgetCaps } from "@ir/engine";
import { vaultFromEnv, type Vault } from "@ir/store";
import healthRouter from "./health";
import { vaultRouter } from "./vault";
import { engineRouter } from "./engine";
import { FAIL_CLOSED_TRANSPORT } from "../lib/engine-transport";

const router: IRouter = Router();

// Opened on first use so the server starts (and /api/healthz answers) even before any key is stored.
let vault: Vault | undefined;
const getVault = (): Vault => (vault ??= vaultFromEnv(process.env, process.env["IR_DATA_DIR"] ?? path.resolve("data")));

// Engine (P2-019): a single shared engine with fail-closed transport. The caps are the
// documented defaults; the transport is injected in tests.
const ENGINE_CAPS: BudgetCaps = {
  maxNodes: 100,
  maxDepth: 5,
  maxRequests: 50,
  maxCostEstimate: 1_000,
  maxElapsedMs: 30_000,
};
let engine: RunEngine | undefined;
const getEngine = (): RunEngine => (engine ??= new RunEngine({ transport: FAIL_CLOSED_TRANSPORT, caps: ENGINE_CAPS }));

router.use(healthRouter);
router.use(vaultRouter(getVault));
router.use(engineRouter(getEngine));

export default router;
