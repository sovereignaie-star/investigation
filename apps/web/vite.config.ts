import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { visualizer } from "rollup-plugin-visualizer";

// Standalone dev/preview settings (no hosting-vendor plugins). PORT and BASE_PATH are optional.
const port = Number(process.env.PORT ?? 5173);
if (!Number.isInteger(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${process.env.PORT}"`);
}
const basePath = process.env.BASE_PATH ?? "/";

export default defineConfig({
  base: basePath,
  plugins: [react(), tailwindcss(), process.env.ANALYZE ? visualizer({ filename: "dist/stats.html", gzipSize: true }) : null].filter(
    Boolean,
  ),
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    // P3-019: the bundle budget (≤ 300KB gzipped for the initial load). The
    // routes are lazy (App.tsx); vendor code is chunked so the initial
    // download is the shell + overview + react/query, while the heavy screens
    // (workbench, canvas, sigma, xyflow) load on demand.
    rollupOptions: {
      output: {
        // Rolldown's chunking (vite 7): named vendor groups.
        advancedChunks: {
          groups: [
            { name: "react-vendor", test: /node_modules\/react(-dom)?\// },
            { name: "query-vendor", test: /node_modules\/@tanstack\// },
          ],
        },
      },
    },
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
    // The API runs as its own process in development (apps/server, default :8080).
    proxy: {
      "/api": process.env.API_URL ?? "http://localhost:8080",
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
