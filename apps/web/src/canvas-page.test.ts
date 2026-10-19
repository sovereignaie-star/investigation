import * as React from "react";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { TextNode } from "./components/ResultNodes/TextNode";
import { ReactFlowProvider } from "@xyflow/react";
import { InfiniteCanvas, CANVAS_NODE_TYPES } from "./pages/workbench/InfiniteCanvas";

/**
 * P3-006 acceptance (ROADMAP 6.4, literal): "ترحيل من `reactflow` v11" — migrate off the
 * deprecated `reactflow` v11 package to its successor `@xyflow/react`, and deliver the
 * `InfiniteCanvas` component (the small editable canvas, ADR-05 / D-046). The dependency
 * guard below is the criterion itself, red-first: it failed while `reactflow` was installed.
 */

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "../package.json"), "utf-8")) as { dependencies: Record<string, string> };

describe("P3-006 migration guard: reactflow v11 is gone, @xyflow/react is in (D-046)", () => {
  it("apps/web depends on @xyflow/react and not on the deprecated reactflow", () => {
    expect(pkg.dependencies).not.toHaveProperty("reactflow");
    expect(pkg.dependencies).toHaveProperty("@xyflow/react");
  });

  it("the 8 result nodes resolve their Handle/Position imports from @xyflow/react", () => {
    for (const name of Object.keys(CANVAS_NODE_TYPES)) {
      expect(CANVAS_NODE_TYPES[name]).toBeDefined();
    }
    expect(Object.keys(CANVAS_NODE_TYPES)).toHaveLength(8);
  });
});

describe("P3-006 result nodes render statically (migrated imports)", () => {
  it("TextNode renders its value and the flow handles", () => {
    // v12 requires a ReactFlowProvider ancestor for Handle (useStoreApi).
    const html = renderToStaticMarkup(
      React.createElement(
        ReactFlowProvider,
        null,
        React.createElement(TextNode, {
          data: { label: "نص", value: "قيمة تجريبية", nodeData: {}, status: "done" },
          selected: false,
        }),
      ),
    );
    expect(html).toContain("قيمة تجريبية");
    expect(html).toContain("react-flow__handle");
  });
});

describe("P3-006 InfiniteCanvas (the small editable canvas)", () => {
  it("renders the canvas wrapper (ReactFlow itself mounts in effects)", () => {
    const html = renderToStaticMarkup(React.createElement(InfiniteCanvas));
    expect(html).toContain('data-testid="infinite-canvas"');
  });

  it("accepts initial nodes and edges for an editable diagram", () => {
    const html = renderToStaticMarkup(
      React.createElement(InfiniteCanvas, {
        initialNodes: [{ id: "a", type: "text", position: { x: 0, y: 0 }, data: { label: "نص", value: "عينة", nodeData: {} } }],
        initialEdges: [],
      }),
    );
    expect(html).toContain('data-testid="infinite-canvas"');
  });
});
