// P3-005 / NFR-02 measurement on the OFFICIAL REFERENCE DEVICE (owner decision
// 2026-10-20): a GitHub Actions runner (ubuntu-latest) driving Playwright's
// default headless Chromium. The procedure is the reproducible harness the
// workbench ships (#/graph-bench — fixed seed 42, 10,000 nodes / 20,000 edges,
// 10 seconds of continuous camera pans); this script only automates it on the
// reference device and reports the measured numbers — it never judges them.
//
// Prerequisites: `pnpm -r --if-present run build` (the web build in
// apps/web/dist/public) and `npx playwright install --with-deps chromium`.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const DIST = path.resolve(process.cwd(), "apps/web/dist/public");
const PORT = Number(process.env.BENCH_PORT ?? 18700);
const ORIGIN = `http://127.0.0.1:${PORT}`;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
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
    // Path traversal guard: the resolved file must stay inside DIST.
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
  try {
    const page = await browser.newPage();
    await page.goto(`${ORIGIN}/#/graph-bench`, { waitUntil: "domcontentloaded" });
    // P3-019: routes are lazy — wait for the route chunk before measuring.
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "ابدأ القياس" }).click();
    // The workload runs 10 seconds; the result paragraph appears after it ends.
    const strong = page.locator("strong", { hasText: "إطاراً/ث" });
    await strong.waitFor({ state: "visible", timeout: 60000 });
    const fps = Number((await strong.textContent())?.replace("إطاراً/ث", "").trim());
    const renderer = (await page.locator("li").allTextContents()).find((t) => t.includes("المعقّم")) ?? "";
    const dpr = await page.evaluate(() => (typeof devicePixelRatio === "number" ? devicePixelRatio : null));
    const userAgent = await page.evaluate(() => navigator.userAgent);
    const report = {
      criterion: "NFR-02: 10,000 nodes / 20,000 edges >= 30fps on the reference device",
      referenceDevice: "GitHub Actions ubuntu-latest runner + Playwright default headless Chromium",
      measuredFps: fps,
      renderer: renderer.replace("المعقّم (renderer):", "").trim(),
      devicePixelRatio: dpr,
      userAgent,
      passed: Number.isFinite(fps) && fps >= 30,
    };
    console.log(JSON.stringify(report, null, 2));
    if (process.env.GITHUB_STEP_SUMMARY) {
      const { appendFile } = await import("node:fs/promises");
      await appendFile(
        process.env.GITHUB_STEP_SUMMARY,
        `\n### NFR-02 على الجهاز المرجعي (CI + كروميوم Playwright)\n\n\`\`\`\n${JSON.stringify(report, null, 2)}\n\`\`\`\n`,
      );
    }
    // The script's job is the measurement, not the verdict: exit 0 when a real
    // number was read (the docs record the criterion's evaluation).
    if (!Number.isFinite(fps)) throw new Error("no measurable fps was produced");
  } finally {
    await browser.close();
    server.close();
  }
  await wait(100);
}

main().catch((x) => {
  console.error(x instanceof Error ? x.message : String(x));
  process.exit(1);
});
