# تعليمات للوكلاء الآليين (AI agents) — Instructions for AI coding agents

This file applies to every automated agent working in this repository (Claude, Copilot, Cursor, Codex, Devin, etc.). The rules are binding; see `GOVERNANCE.md`.

## Mandatory rules

1. **Never commit or push without updating the project docs in the same commit.** Every commit MUST:
   - modify `docs/STATUS.md` (task state + evidence, "آخر تحديث", phase progress), and
   - append a new entry at the end of `docs/WORKLOG.md` (never edit or delete old entries), and
   - cite at least one existing task id in the commit message, e.g. `fix(web): add entry point [P0-006]`, and
   - mention the same task id(s) inside the new WORKLOG entry.
   Documentation updates are part of the work itself, not a separate follow-up commit.
2. Work only on tasks defined in `docs/ROADMAP.md` (section 6). If you need new work, add the task to the roadmap and a `todo`/`in_progress` row to `docs/STATUS.md` **in the same commit**.
3. Do not push to `main`. Use a branch `type/Pn-nnn-slug` and open a pull request. `main` is protected.
4. Do not use `--no-verify`. CI re-checks every commit and will block the PR.
5. Do not mark a task `done` without reproducible evidence (command + result, or CI link) in the WORKLOG entry.
6. Label claims about the project or the outside world with the epistemic tags used in the roadmap: [مُقاس] measured, [مُلاحظ] observed by reading, [مُتحقَّق] externally verified, [مقترح] proposed, [للتحقق] to verify.
7. Never add secrets, `.env` files, offensive tooling (exploitation, phishing, stalkerware, DDoS), or data from breaches. Respect ethics rules E-01..E-10 (roadmap 3.5).
8. New data sources/tools enter code only through the integration pipeline in roadmap section 7.2.
9. `docs/MASTER_PLAN.md` is the vision/strategy layer, not a tracker (GR-16): never add checkboxes to it, only reference task ids that exist in the roadmap, and map any new requirement to a roadmap task in the same commit. On conflict, follow the precedence rule in roadmap section 14.1 (governance and ethics > ADRs > ROADMAP > MASTER_PLAN).

## Before you finish any change

```bash
pnpm run lint                  # ESLint (P0-022); staged files are also formatted by Prettier in pre-commit
pnpm run typecheck
pnpm run build
pnpm test
pnpm run governance            # checks HEAD + ROADMAP/STATUS consistency
node scripts/governance/check.mjs --range origin/main..HEAD
```

## Where things are

| Path | What |
|---|---|
| `docs/MASTER_PLAN.md` | Master plan: vision, strategy, long-term horizons, mapped to roadmap tasks |
| `docs/ROADMAP.md` | Scope, design, all tasks (Arabic) |
| `docs/STATUS.md` | Live status — the only place for task state |
| `docs/WORKLOG.md` | Append-only log of what was done, with evidence |
| `docs/tools/` | Tool catalog (10,881 real tools from 19 curated lists + owner-curated additions) |
| `docs/adr/` | Architecture decision records |
| `scripts/governance/` | The governance guard |
| `apps/web` | Web app (Vite + React 19) |
| `apps/server` | API server (Express 5) |
| `apps/sandbox` | Component preview (shadcn), moves to `packages/ui` in P3-001 |
| `packages/*` | New domain packages (`@ir/schema`, `@ir/core`, `@ir/ledger`, `@ir/store`, …), see ROADMAP 5.3 |
| `lib/*` | OpenAPI spec, generated Zod and React Query client, DB |
