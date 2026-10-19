import * as React from "react";
import { Button } from "@ir/ui";

import { generateBenchGraph } from "./graphModel";
import { InvestigationGraph, type SigmaHandle } from "./InvestigationGraph";

/**
 * P3-005 measurement harness (NFR-02): renders the reference workload — 10,000 nodes /
 * 20,000 edges — and measures rendered frames per second while the camera pans continuously.
 *
 * The roadmap criterion is a REFERENCE-DEVICE measurement: this page is the reproducible
 * procedure for it. Headless CI cannot measure WebGL FPS; until the owner defines the
 * reference device and measures it here, the P3-005 performance condition stays open in
 * docs/STATUS.md (declared environment limit).
 *
 * Method: a 10-second requestAnimationFrame loop moves the camera every frame, so Sigma
 * re-renders the 10k-node graph each frame under the same workload; frames are counted over
 * the window. Heavy rendering congests the main thread and slows the loop, so the counted
 * rate reflects the achieved frame rate, not just the display's refresh rate.
 */

const NODES = 10_000;
const EDGES = 20_000;
const SEED = 42;
const WORKLOAD_MS = 10_000;

interface BenchResult {
  fps: number;
  frames: number;
  seconds: number;
}

function webglRendererInfo(): string {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (gl === null) return "غير متوفر";
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    if (dbg === null) return "مجهول";
    return String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL));
  } catch {
    return "تعذر القراءة";
  }
}

export function GraphBenchPage() {
  const graph = React.useMemo(() => generateBenchGraph(NODES, EDGES, SEED), []);
  const instanceRef = React.useRef<SigmaHandle | null>(null);
  const [result, setResult] = React.useState<BenchResult | null>(null);
  const [running, setRunning] = React.useState(false);
  const startedAtRef = React.useRef<number>(0);

  const captureInstance = React.useCallback((instance: SigmaHandle | null) => {
    instanceRef.current = instance;
  }, []);

  const startMeasurement = React.useCallback(() => {
    const instance = instanceRef.current;
    if (instance === null || running) return;
    setRunning(true);
    setResult(null);
    const camera = instance.getCamera();
    const direction = { dx: 8, dy: 5 };
    let frames = 0;
    startedAtRef.current = performance.now();
    const tick = () => {
      const elapsed = performance.now() - startedAtRef.current;
      if (elapsed >= WORKLOAD_MS) {
        const seconds = elapsed / 1000;
        setResult({ fps: frames / seconds, frames, seconds });
        setRunning(false);
        return;
      }
      // Continuous pan: every counted frame moves the camera, forcing a re-render.
      camera.setState({ x: camera.x + direction.dx, y: camera.y + direction.dy });
      direction.dx *= -1;
      direction.dy *= -1;
      frames += 1;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [running]);

  return (
    <div data-testid="graph-bench" className="flex flex-col gap-4 p-4 md:p-6">
      <h1 className="text-xl font-semibold">قياس أداء لوحة الرسم (NFR-02)</h1>
      <p className="max-w-2xl text-sm text-muted-foreground">
        حمل مرجعي ثابت: {NODES.toLocaleString("en-US")} عقدة و{EDGES.toLocaleString("en-US")} حافة (بذرة {SEED} — نفس المدخل لكل قياس).
        المعيار: ≥ 30 إطاراً/ث على الجهاز المرجعي أثناء تحريك مستمر للكاميرا لمدة {WORKLOAD_MS / 1000} ثوانٍ.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={startMeasurement} disabled={running}>
          {running ? "القياس جارٍ…" : "ابدأ القياس"}
        </Button>
        {result !== null && (
          <p className="text-sm">
            <strong>{result.fps.toFixed(1)} إطاراً/ث</strong> — {result.frames} إطاراً في {result.seconds.toFixed(1)} ثانية
          </p>
        )}
      </div>
      <div className="h-[520px] rounded-md border border-border">
        <InvestigationGraph graph={graph} onInstance={captureInstance} />
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer">بيئة القياس</summary>
        <ul className="mt-2 space-y-1 text-muted-foreground">
          <li>المعقّم (renderer): {result !== null ? webglRendererInfo() : "يُقرأ عند القياس"}</li>
          <li>كثافة البكسل (DPR): {typeof devicePixelRatio === "number" ? devicePixelRatio : "—"}</li>
          <li>وكيل المستخدم: {typeof navigator !== "undefined" ? navigator.userAgent : "—"}</li>
        </ul>
      </details>
    </div>
  );
}
