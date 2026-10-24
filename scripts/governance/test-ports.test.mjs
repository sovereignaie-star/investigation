/**
 * P6-027: test-server port guard (T-PORT-001).
 *
 * The 2026-10-24 CI run for PR #406 failed with EADDRINUSE on 127.0.0.1:41534
 * in packages/ai/src/qa.test.ts: the fake-Ollama servers in qa.test.ts and
 * next-action.test.ts listen on fixed ports inside the Linux ephemeral source
 * port range (32768..60999). An unrelated outgoing connection (undici
 * keep-alive, fetch, anything) can hold one of those ports for a moment and
 * the next listen() fails the whole suite. P6-022 moved injection.test.ts
 * below 32768 — this guard extends the same rule to every test file so the
 * class cannot come back.
 *
 * T-PORT-001: no test file may pass a fixed port inside 32768..60999 to a
 * server listen (directly or via a fake-server helper such as
 * startFakeOllama). Use a fixed port below 32768 (unique across files) or
 * listen(0).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

const EPHEMERAL = { min: 32768, max: 60999 };
/** A listen( or fake-server-helper call with a literal port argument. */
const PORT_CALL = /(?:listen|startFake[A-Za-z]+|FakeServer\w*)\(\s*(\d{4,5})\b/g;

/** Recursively collect *.test.ts / *.test.tsx files under dir. */
function testFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules" || name === "dist" || name === ".git") continue;
      out.push(...testFiles(p));
    } else if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

function offenders() {
  const hits = [];
  for (const file of testFiles(join(root, "packages", "ai", "src"))) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(PORT_CALL)) {
      const port = Number(m[1]);
      if (port >= EPHEMERAL.min && port <= EPHEMERAL.max) {
        hits.push(`${file}: listen/${m[0].split("(")[0]} on ${port}`);
      }
    }
  }
  return hits;
}

test("T-PORT-001: no test file listens on a fixed port inside the ephemeral range (32768..60999)", () => {
  const hits = offenders();
  assert.deepEqual(
    hits,
    [],
    `test servers use fixed ports inside the ephemeral source-port range — an unrelated outgoing connection can hold the port and the next listen() fails (EADDRINUSE). Renumber below 32768 or listen(0):\n${hits.join("\n")}`,
  );
});
