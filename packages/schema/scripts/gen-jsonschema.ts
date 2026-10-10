// Writes packages/schema/json/<Model>.schema.json. The test suite fails if these files are stale.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toJsonSchemas } from "../src/registry.ts";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "json");
mkdirSync(dir, { recursive: true });
for (const [name, schema] of Object.entries(toJsonSchemas())) {
  writeFileSync(join(dir, `${name}.schema.json`), JSON.stringify(schema, null, 2) + "\n");
}
console.log(`wrote ${Object.keys(toJsonSchemas()).length} schemas to ${dir}`);
