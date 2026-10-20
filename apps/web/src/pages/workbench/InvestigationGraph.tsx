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
  /**
   * P3-021 («التركيز»): centers the camera on a node using its own coordinates. The
   * sigma camera's x/y ARE graph coordinates — the node's stored position is the
   * center, and ratio 1 is a comfortable zoom. Returns false when the node is not in
   * the graph (honesty: no camera move, the caller reports it).
   */
  focusNode: (nodeId: string) => boolean;
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
  onRightClickNode,
  onRightClickStage,
  ariaLabel = t("workbench.graph.ariaLabel"),
  layoutSeed = 42,
}: {
  graph: ProjectionGraph;
  onInstance?: (instance: SigmaHandle | null) => void;
  /** P3-021: right-clicking a node reports it — the context menu targets it explicitly. */
  onRightClickNode?: (nodeId: string) => void;
  /** P3-021: right-clicking the empty stage clears the pending target (no stale node). */
  onRightClickStage?: () => void;
  ariaLabel?: string;
  /** The deterministic layout seed (acceptance: «تخطيط حتمي بالبذرة»). */
  layoutSeed?: number;
}) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  // P3-021: the camera state mirrors onto the DOM so the focus behavior is observable
  // (E2E asserts the camera centers on the focused node) without exposing internals.
  const [camera, setCamera] = React.useState<{ x: number; y: number; ratio: number } | null>(null);

  React.useEffect(() => {
    let disposed = false;
    let instance: SigmaHandle | null = null;
    let cleanupWorker: (() => void) | null = null;
    // P3-022: the drag listener's removal is hoisted to the effect's scope (the
    // listener itself is registered inside the async mount block).
    let removeDragListener: (() => void) | null = null;
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
        instance = {
          ...(sigma as unknown as SigmaHandle),
          // P3-021: the node's own coordinates center the camera (the camera's x/y are
          // graph coordinates); ratio 1 keeps the node's neighborhood visible around it.
          focusNode: (nodeId: string) => {
            const pos = g.getNodeAttributes(nodeId) as { x?: number; y?: number } | undefined;
            if (!pos || typeof pos.x !== "number" || typeof pos.y !== "number") return false;
            // P3-022 fix: the camera lives in the graph's NORMALIZED space, not raw
            // coordinates — centering on a node is a PAN DELTA in framed-graph space,
            // computed exactly the way sigma's own panning does it (the raw-coords
            // shortcut landed the camera off-graph: the node never reached the center).
            const camera = sigma.getCamera();
            const container = containerRef.current;
            if (container === null) return false;
            const center = sigma.viewportToFramedGraph({ x: container.clientWidth / 2, y: container.clientHeight / 2 });
            const nodeAt = sigma.graphToViewport({ x: pos.x, y: pos.y });
            const nodeFramed = sigma.viewportToFramedGraph(nodeAt);
            // The camera position IS the framed point rendered at the viewport's
            // center — so centering the node means setting the camera TO the node's
            // framed position (a pan delta of nodeFramed - center, the mirror of
            // sigma's own drag-pan formula).
            camera.setState({
              x: camera.x + (nodeFramed.x - center.x),
              y: camera.y + (nodeFramed.y - center.y),
              ratio: 1,
            });
            return true;
          },
        };
        onInstance?.(instance);

        // P3-021: the camera state is mirrored for observability (see the state above).
        // The camera itself emits "updated" — the focus command's effect is assertable.
        const syncCamera = () => {
          const cam = sigma.getCamera();
          setCamera({ x: cam.x, y: cam.y, ratio: cam.ratio });
        };
        sigma.getCamera().on("updated", syncCamera);
        syncCamera();

        // P3-021: right-clicking a node opens the context menu FOR THAT NODE — the
        // event carries the node id, so the menu never targets a stale selection.
        if (onRightClickNode) {
          sigma.on("rightClickNode", ({ node }) => onRightClickNode(String(node)));
        }
        if (onRightClickStage) {
          sigma.on("rightClickStage", () => onRightClickStage());
        }

        // P3-022: node dragging (تحريك) — the move operation the view's undo history
        // records. A drag is a MOVE only after the pointer actually travels (a plain
        // click is a selection, not an edit); on release the whole graph's positions
        // are saved as the new layout — a prior layout existed, so saveLayout records
        // the change for undo (the FIRST layout of a fresh graph is the baseline).
        let dragNodeId: string | null = null;
        let dragMoved = false;

        sigma.on("downNode", ({ node }) => {
          dragNodeId = String(node);
          dragMoved = false;
        });
        sigma.on("moveBody", (coords) => {
          if (dragNodeId === null) return;
          const pos = sigma.viewportToGraph({ x: coords.event.x, y: coords.event.y });
          g.setNodeAttribute(dragNodeId, "x", pos.x);
          g.setNodeAttribute(dragNodeId, "y", pos.y);
          dragMoved = true;
          sigma.refresh();
        });
        const endDrag = () => {
          if (dragNodeId === null) return;
          const moved = dragMoved;
          dragNodeId = null;
          dragMoved = false;
          if (!moved) return;
          const positions = new Map<string, { x: number; y: number }>();
          g.forEachNode((id, attrs) => {
            positions.set(id, { x: attrs.x, y: attrs.y });
          });
          useViewState.getState().saveLayout(graphKey, positions);
        };
        window.addEventListener("mouseup", endDrag);
        removeDragListener = () => window.removeEventListener("mouseup", endDrag);

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
      removeDragListener?.();
      onInstance?.(null);
    };
  }, [graph, onInstance, onRightClickNode, onRightClickStage, layoutSeed]);

  return (
    <div data-testid="investigation-graph" className="relative h-full min-h-[300px] w-full">
      <div ref={containerRef} className="absolute inset-0" aria-label={ariaLabel} role="img" />
      {camera !== null && (
        <div
          data-testid="graph-camera"
          data-x={camera.x}
          data-y={camera.y}
          data-ratio={camera.ratio}
          aria-hidden="true"
          className="hidden"
        />
      )}
      {graph.nodes.length === 0 && (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">{t("workbench.graph.empty")}</p>
      )}
      {error !== null && (
        <p role="alert" className="absolute inset-x-0 bottom-0 bg-destructive/10 p-2 text-sm text-destructive-text">
          {t("workbench.graph.noWebgl", { error })}
        </p>
      )}
    </div>
  );
}
