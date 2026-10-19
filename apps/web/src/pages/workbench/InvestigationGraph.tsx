import * as React from "react";
import type { Graph as ProjectionGraph } from "@ir/ledger/projections";

import { toGraphologyGraph } from "./graphModel";

/** Minimal structural type for the Sigma instance the effect owns. */
export interface SigmaHandle {
  kill: () => void;
  /** Camera access for the bench workload (P3-005 measurement harness). */
  getCamera: () => {
    setState: (state: Partial<{ x: number; y: number; angle: number; ratio: number }>) => void;
    x: number;
    y: number;
    ratio: number;
  };
  refresh: () => void;
}

/**
 * P3-005: the large-graph canvas (Sigma.js v3 + graphology over WebGL). Sigma is imported lazily
 * inside the effect (browser-only): static/server rendering produces the labelled container
 * without any canvas, and a failed WebGL context surfaces an explicit error instead of an
 * empty box. The instance is exposed to the parent through `onInstance` for the bench harness.
 */
export function InvestigationGraph({
  graph,
  onInstance,
  ariaLabel = "لوحة رسم التحقيق",
}: {
  graph: ProjectionGraph;
  onInstance?: (instance: SigmaHandle | null) => void;
  ariaLabel?: string;
}) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let disposed = false;
    let instance: SigmaHandle | null = null;
    onInstance?.(null);
    (async () => {
      try {
        const [{ default: Sigma }] = await Promise.all([import("sigma")]);
        if (disposed || containerRef.current === null) return;
        const g = toGraphologyGraph(graph);
        // Sigma needs a container with non-zero dimensions; the wrapper enforces min height.
        // v3.0.3: flat settings — v4 was measured 80–100× slower on the 10k workload (WORKLOG).
        const sigma = new Sigma(g, containerRef.current, {
          renderEdgeLabels: false,
          labelDensity: 0.5,
          labelGridCellSize: 60,
          minCameraRatio: 0.02,
          maxCameraRatio: 10,
        });
        instance = sigma as unknown as SigmaHandle;
        onInstance?.(instance);
      } catch (e) {
        if (!disposed) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    return () => {
      disposed = true;
      try {
        instance?.kill();
      } catch {
        // kill() after a failed constructor is harmless to ignore
      }
      onInstance?.(null);
    };
  }, [graph, onInstance]);

  return (
    <div data-testid="investigation-graph" className="relative h-full min-h-[300px] w-full">
      <div ref={containerRef} className="absolute inset-0" aria-label={ariaLabel} role="img" />
      {graph.nodes.length === 0 && (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          لا عقد بعد — استخرج معرّفات لرسم اللوحة.
        </p>
      )}
      {error !== null && (
        <p role="alert" className="absolute inset-x-0 bottom-0 bg-destructive/10 p-2 text-sm text-destructive">
          تعذر تشغيل لوحة الرسم (WebGL غير متوفر): {error}
        </p>
      )}
    </div>
  );
}
