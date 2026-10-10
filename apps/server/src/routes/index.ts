import path from "node:path";
import { Router, type IRouter } from "express";
import { vaultFromEnv, type Vault } from "@ir/store";
import healthRouter from "./health";
import { vaultRouter } from "./vault";

const router: IRouter = Router();

// Opened on first use so the server starts (and /api/healthz answers) even before any key is stored.
let vault: Vault | undefined;
const getVault = (): Vault => (vault ??= vaultFromEnv(process.env, process.env["IR_DATA_DIR"] ?? path.resolve("data")));

router.use(healthRouter);
router.use(vaultRouter(getVault));

export default router;
