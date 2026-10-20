import { t } from "@ir/i18n";
import * as React from "react";
import type { Graph as ProjectionGraph } from "@ir/ledger/projections";

import { toGraphologyGraph } from "./graphModel";
import { positionsKey, type LayoutPositions } from "./layout";
import type { LayoutRequest, LayoutResult } from "./layoutProtocol";
import { useViewState } from "../../store/viewStateStore";
import { useSelection } from "../../store/selectionStore";

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
 *
 * P3-007: ForceAtlas2 runs in a Web Worker off the main thread. Saved positions (ViewState,
 * keyed by the graph identity) are applied immediately; otherwise the deterministic seeded
 * layout is computed in the worker and applied live, then saved. Where Worker construction
 * fails (sandboxed iframe, strict CSP) the same deterministic layout is computed on the main
 * thread — the feature degrades to a brief block, never to a broken canvas.
 */

/** Deterministic iteration budget from the graph order — a pure function of size. */
function iterationsOf(order: number): number {
  if (order <= 100) return 100;
  if (order <= 1_000) return 60;
  return 30;
}

export function InvestigationGraph({
  graph,
  onInstance,
  ariaLabel = t("workbench.graph.ariaLabel"),
  layoutSeed = 42,
}: {
  graph: ProjectionGraph;
  onInstance?: (instance: SigmaHandle | null) => void;
  ariaLabel?: string;
  /** The deterministic layout seed (acceptance: «تخطيط حتمي بالبذرة»). */
  layoutSeed?: number;
}) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let disposed = false;
    let instance: SigmaHandle | null = null;
    let cleanupWorker: (() => void) | null = null;
    onInstance?.(null);
    (async () => {
      try {
        const [{ default: Sigma }] = await Promise.all([import("sigma")]);
        if (disposed || containerRef.current === null) return;
        const g = toGraphologyGraph(graph);

        // P3-007: saved positions (ViewState) are applied before the first render.
        const graphKey = positionsKey(graph);
        const saved = useViewState.getState().getLayout(graphKey);
        if (saved !== null) {
          g.forEachNode((id) => {
            const p = saved.get(id);
            if (p) {
              g.setNodeAttribute(id, "x", p.x);
              g.setNodeAttribute(id, "y", p.y);
            }
          });
        }

        // Sigma needs a container with non-zero dimensions; the wrapper enforces min height.
        // v3.0.3: flat settings — v4 was measured 80–100× slower on the 10k workload (WORKLOG).
        const sigma = new Sigma(g, containerRef.current, {
          renderEdgeLabels: false,
          labelDensity: 0.5,
          labelGridCellSize: 60,
          minCameraRatio: 0.02,
          maxCameraRatio: 10,
        });
        // P3-008: clicking a node opens its detail panel; clicking the empty stage clears it.
        const selectNode = useSelection.getState().selectNode;
        const clearSelection = useSelection.getState().clear;
        sigma.on("clickNode", ({ node }) => selectNode(String(node)));
        sigma.on("clickStage", () => clearSelection());
        instance = sigma as unknown as SigmaHandle;
        onInstance?.(instance);

        // P3-007: no saved layout yet — compute the deterministic ForceAtlas2 layout off the
        // main thread in a Web Worker, apply it live, then save it (D-026). Worker construction
        // can fail in sandboxed iframes (origin 'null' — the deployed preview) or under strict
        // CSP; the layout is then computed on the main thread instead — the feature degrades
        // to a brief block, never to a broken canvas (verified in-browser, WORKLOG).
        if (saved === null && graph.nodes.length > 0) {
          let worker: Worker | null = null;
          try {
            worker = new Worker(new URL("./layout.worker.ts", import.meta.url), {
              type: "module",
            });
          } catch {
            worker = null;
          }
          const applyPositions = (positions: LayoutPositions) => {
            g.forEachNode((id) => {
              const p = positions.get(id);
              if (p) {
                g.setNodeAttribute(id, "x", p.x);
                g.setNodeAttribute(id, "y", p.y);
              }
            });
            sigma.refresh();
            useViewState.getState().saveLayout(graphKey, positions);
          };
          if (worker !== null) {
            const request: LayoutRequest = {
              type: "layout",
              graph,
              seed: layoutSeed,
              iterations: iterationsOf(g.order),
            };
            worker.onmessage = (event: MessageEvent<LayoutResult>) => {
              if (event.data?.type !== "layout-result") return;
              if (disposed) {
                worker?.terminate();
                return;
              }
              applyPositions(event.data.positions);
              worker?.terminate();
            };
            worker.postMessage(request);
            cleanupWorker = () => worker?.terminate();
          } else {
            // Fallback (no Worker available): deterministic layout on the main thread,
            // deferred so the canvas paints its circular positions first.
            const seed = layoutSeed;
            const iterations = iterationsOf(g.order);
            const timer = setTimeout(() => {
              if (disposed) return;
              import("./layout").then(({ computeForceAtlas2Layout }) => {
                if (disposed) return;
                applyPositions(computeForceAtlas2Layout(graph, { seed, iterations }));
              });
            }, 0);
            cleanupWorker = () => clearTimeout(timer);
          }
        }
      } catch (e) {
        if (!disposed) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    return () => {
      disposed = true;
      cleanupWorker?.();
      try {
        instance?.kill();
      } catch {
        // kill() after a failed constructor is harmless to ignore
      }
      onInstance?.(null);
    };
  }, [graph, onInstance, layoutSeed]);

  return (
    <div data-testid="investigation-graph" className="relative h-full min-h-[300px] w-full">
      <div ref={containerRef} className="absolute inset-0" aria-label={ariaLabel} role="img" />
      {graph.nodes.length === 0 && (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">{t("workbench.graph.empty")}</p>
      )}
      {error !== null && (
        <p role="alert" className="absolute inset-x-0 bottom-0 bg-destructive/10 p-2 text-sm text-destructive">
          {t("workbench.graph.noWebgl", { error })}
        </p>
      )}
    </div>
  );
}
