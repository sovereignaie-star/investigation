// P3-018: the REAL-BROWSER axe run — «axe بلا حرج» where it can actually be
// measured. The jsdom suite (apps/web/src/a11y.test.ts) covers the structural
// rules (semantics, ARIA, keyboard); the color-contrast rule needs a real
// rendering engine, so this script serves the built app, drives Playwright's
// default Chromium through the main routes, injects axe-core and reports every
// violation of impact critical/serious (exit 1 if any).
//
// Prerequisites: `pnpm -r --if-present run build` and
// `npx playwright install --with-deps chromium`.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const AXE_SOURCE = (() => {
  // axe-core is @ir/web's devDependency — resolve from there, falling back to
  // the root's own copy if it gains one.
  try {
    return path.join(
      path.dirname(require.resolve("axe-core", { paths: [path.resolve(process.cwd(), "apps/web/node_modules")] })),
      "axe.min.js",
    );
  } catch {
    return path.join(path.dirname(require.resolve("axe-core")), "axe.min.js");
  }
})();

const DIST = path.resolve(process.cwd(), "apps/web/dist/public");
const PORT = Number(process.env.A11Y_PORT ?? 18_710);
const ORIGIN = `http://127.0.0.1:${PORT}`;

const ROUTES = [
  { name: "overview", hash: "#/" },
  { name: "cases", hash: "#/cases" },
  { name: "evidence", hash: "#/evidence" },
  { name: "settings", hash: "#/settings" },
  { name: "workbench", hash: "#/workbench" },
];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", ORIGIN);
    const file = path.join(DIST, url.pathname === "/" ? "index.html" : url.pathname);
    if (!path.resolve(file).startsWith(path.resolve(DIST))) {
      res.writeHead(403).end("forbidden");
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
  const browser = await chromium.launch(); // Playwright's default headless Chromium
  let failures = 0;
  try {
    const page = await browser.newPage();
    for (const route of ROUTES) {
      // P3-018: both themes — contrast is a per-theme property; a route is
      // clean only if it is clean in light AND dark.
      for (const theme of ["light", "dark"]) {
        if (theme === "dark") {
          await page.click("[data-theme-toggle]");
        }
        await page.goto(`${ORIGIN}/${route.hash}`, { waitUntil: "domcontentloaded" });
        // P3-019: routes are lazy — wait for the route chunk before measuring.
        await page.waitForLoadState("networkidle");
        if (theme === "dark") {
          await page.click("[data-theme-toggle]");
        }
        await page.addScriptTag({ path: AXE_SOURCE });
        const results = await page.evaluate(async () => {
          const axe = globalThis.axe;
          const run = await axe.run(document, { resultTypes: ["violations", "incomplete"] });
          // Report every rule result so the run is auditable (a rule that never
          // ran is a silent hole — this surfaces it).
          return {
            violations: run.violations,
            incomplete: run.incomplete.map((r) => `${r.id} (${r.nodes.length})`),
          };
        });
        const serious = results.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
        if (serious.length > 0) {
          failures += serious.length;
          for (const v of serious) {
            const targets = v.nodes
              .slice(0, 3)
              .map((n) => n.target.join(","))
              .join(" | ");
            console.log(`${route.name}/${theme}: ${v.id} (${v.impact}) — ${v.help} — ${targets}`);
          }
        } else {
          console.log(
            `${route.name}/${theme}: axe clean (critical/serious)${results.incomplete.length > 0 ? ` — incomplete: ${results.incomplete.join(", ")}` : ""}`,
          );
        }
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  await wait(100);
  if (failures > 0) {
    console.error(`${failures} critical/serious axe violations — exit 1`);
    process.exit(1);
  }
  console.log("axe بلا حرج — all routes clean (critical/serious)");
}

main().catch((x) => {
  console.error(x instanceof Error ? x.message : String(x));
  process.exit(1);
});
