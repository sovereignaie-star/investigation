// P2-033: post-processing after orval 8.22 so `pnpm -C lib/api-spec run codegen` is idempotent and type-checks.
//  1. orval appends `export * from './generated/...'` (single quotes) to each workspace index.ts on every run when the
//     existing lines use the repo's double quotes; duplicates are dropped (quote style ignored).
//  2. orval 8.22 emits zod 4 API (`z.looseObject`, ...). The workspace stays on zod 3.25 — its `zod/v4` subpath is the
//     zod 4 API, and @ir/schema already uses it — so the generated import is pointed there. Moving the whole
//     workspace to zod 4.x changes the published JSON Schemas (stricter date-time pattern) and is tracked separately.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

for (const rel of ["api-client-react/src/index.ts", "api-zod/src/index.ts"]) {
  const file = path.join(root, rel);
  const seen = new Set();
  const out = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const normalized = line.replace(/'/g, '"').trimEnd();
    if (/^export \* from "/.test(normalized)) {
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
      continue;
    }
    out.push(line);
  }
  writeFileSync(file, out.join("\n").replace(/\n+$/, "\n"));
}

const zodApi = path.join(root, "api-zod/src/generated/api.ts");
const generated = readFileSync(zodApi, "utf8");
writeFileSync(zodApi, generated.replace(/from (['"])zod\1;/g, "from $1zod/v4$1;"));
