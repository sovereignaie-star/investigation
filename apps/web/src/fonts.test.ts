import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const webRoot = path.resolve(__dirname, "..");

// P3-025 acceptance (ROADMAP 6.3): «خطوط عربية ولاتينية مستضافة محلياً …
// صفر طلبات خطوط خارجية (E-06، NFR-11)، ووضوح النص العربي عند 12px».
// The Arabic+Latin font must ship inside the app bundle (a self-hosted package),
// never be fetched from a third-party CDN at runtime.
describe("P3-025: self-hosted Arabic/Latin fonts", () => {
  const indexCss = readFileSync(path.join(webRoot, "src/index.css"), "utf-8");
  const pkgJson = JSON.parse(readFileSync(path.join(webRoot, "package.json"), "utf-8"));
  const deps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };
  const fontDep = Object.keys(deps).find((d) => /noto-sans-arabic/.test(d));

  it("T-FONT-001: the app's root font stack names the bundled Arabic font first", () => {
    // The stack must put the bundled family before generic/system fallbacks so
    // Arabic text renders with the shipped font, not whatever the OS has.
    const stack = /font-family:\s*([^;]+);/.exec(indexCss)?.[1] ?? "";
    expect(stack).toContain("Noto Sans Arabic");
    const bundledIndex = stack.indexOf("Noto Sans Arabic");
    const systemIndex = stack.indexOf("system-ui");
    expect(systemIndex).toBeGreaterThan(bundledIndex);
  });

  it("T-FONT-002: the app imports the font package's CSS (self-hosted, not CDN)", () => {
    const mainTsx = readFileSync(path.join(webRoot, "src/main.tsx"), "utf-8");
    const imported =
      /@fontsource(-variable)?\/noto-sans-arabic/.test(mainTsx) || /@fontsource(-variable)?\/noto-sans-arabic/.test(indexCss);
    expect(imported).toBe(true);
  });

  it("T-FONT-003: the font package is an installed dependency with woff2 files", () => {
    expect(fontDep).toBeDefined();
    // The CSS entry resolves and points at woff2 files inside the package.
    const cssPath = require.resolve(`${fontDep}/index.css`);
    expect(existsSync(cssPath)).toBe(true);
    const css = readFileSync(cssPath, "utf-8");
    expect(css).toMatch(/font-family:\s*["']?Noto Sans Arabic/);
    expect(css).toMatch(/\.woff2/);
  });

  it("T-FONT-004: font-display swap keeps text readable while the font loads", () => {
    expect(fontDep).toBeDefined();
    const css = readFileSync(require.resolve(`${fontDep}/index.css`), "utf-8");
    expect(css).toMatch(/font-display:\s*swap/);
  });

  it("T-FONT-005 (E-06/NFR-11): zero external font requests anywhere in the app sources", () => {
    const html = readFileSync(path.join(webRoot, "index.html"), "utf-8");
    const sources = [html, indexCss];
    for (const src of sources) {
      expect(src).not.toMatch(/fonts\.googleapis\.com/);
      expect(src).not.toMatch(/fonts\.gstatic\.com/);
      expect(src).not.toMatch(/https?:\/\/[^"']*\.woff2?/);
    }
  });
});
