import * as React from "react";
import { Background, Controls, ReactFlow, type Edge, type Node, type NodeTypes } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { DefaultNode } from "../../components/ResultNodes/DefaultNode";
import { FileNode } from "../../components/ResultNodes/FileNode";
import { ImageNode } from "../../components/ResultNodes/ImageNode";
import { LinkNode } from "../../components/ResultNodes/LinkNode";
import { LocationNode } from "../../components/ResultNodes/LocationNode";
import { MapNode } from "../../components/ResultNodes/MapNode";
import { TextNode } from "../../components/ResultNodes/TextNode";
import { VideoNode } from "../../components/ResultNodes/VideoNode";

/**
 * P3-006: the small editable canvas (`@xyflow/react`, ADR-05 — the successor of the deprecated
 * `reactflow` v11, D-046). The eight result-node renderers from the mockup are registered as
 * node types; nodes are draggable and connectable (تحريرية). The big-graph WebGL canvas is
 * P3-005 — this surface is for small hand-built diagrams.
 */

export const CANVAS_NODE_TYPES: NodeTypes = {
  default: DefaultNode,
  file: FileNode,
  image: ImageNode,
  link: LinkNode,
  location: LocationNode,
  map: MapNode,
  text: TextNode,
  video: VideoNode,
};

/** A small editable sample diagram: one node of each result type, lightly connected. */
const SAMPLE_NODES: Node[] = [
  {
    id: "sample-text",
    type: "text",
    position: { x: 40, y: 40 },
    data: { label: "نص", value: "عينة نص مستخرج من نص حر" },
  },
  {
    id: "sample-link",
    type: "link",
    position: { x: 380, y: 60 },
    data: { label: "رابط", url: "https://example.com", domain: "example.com" },
  },
  {
    id: "sample-file",
    type: "file",
    position: { x: 60, y: 300 },
    data: { label: "ملف", name: "report.pdf", size: 1024, mime: "application/pdf" },
  },
  {
    id: "sample-image",
    type: "image",
    position: { x: 400, y: 320 },
    data: { label: "صورة", src: "https://example.com/photo.jpg" },
  },
];

const SAMPLE_EDGES: Edge[] = [
  { id: "sample-edge-1", source: "sample-text", target: "sample-link" },
  { id: "sample-edge-2", source: "sample-text", target: "sample-file" },
];

export function InfiniteCanvas({
  initialNodes = SAMPLE_NODES,
  initialEdges = SAMPLE_EDGES,
}: {
  initialNodes?: Node[];
  initialEdges?: Edge[];
}) {
  return (
    <div data-testid="infinite-canvas" className="h-full min-h-[400px] w-full">
      <ReactFlow
        nodes={initialNodes}
        edges={initialEdges}
        nodeTypes={CANVAS_NODE_TYPES}
        fitView
        minZoom={0.2}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
