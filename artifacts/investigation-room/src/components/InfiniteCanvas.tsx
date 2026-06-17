import { useCallback, useEffect, useMemo } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  BackgroundVariant,
  type Node,
  type Edge,
} from 'reactflow';
import { motion, AnimatePresence } from 'framer-motion';
import { NODE_TYPES } from './ResultNodes';
import type { InvestigationNode, InvestigationLink } from '../types';

interface InfiniteCanvasProps {
  nodes: InvestigationNode[];
  links: InvestigationLink[];
  onNodeClick: (nodeId: string) => void;
  selectedNodeId: string | null;
}

function investigationNodeToRFNode(n: InvestigationNode, selectedId: string | null): Node {
  return {
    id: n.id,
    type: n.type || 'default',
    position: n.position,
    selected: n.id === selectedId,
    data: {
      ...n.data,
      detectedTypeIcon: n.identifierTypeIcon,
      detectedTypeName: n.identifierTypeName,
    },
    className: `${n.id === selectedId ? 'selected' : ''}`,
  };
}

function investigationLinkToRFEdge(l: InvestigationLink): Edge {
  const conf = l.confidence;
  const color = conf >= 0.8 ? '#10b981' : conf >= 0.5 ? '#3b82f6' : '#f59e0b';
  return {
    id: l.id,
    source: l.sourceId,
    target: l.targetId,
    animated: conf >= 0.6,
    label: l.relationType,
    labelStyle: { fontSize: 8, fill: '#71717a' },
    labelBgStyle: { fill: 'hsl(240 6% 8%)', fillOpacity: 0.8 },
    style: { stroke: color, strokeWidth: 1.5 },
    type: 'smoothstep',
  };
}

export function InfiniteCanvas({ nodes: invNodes, links: invLinks, onNodeClick, selectedNodeId }: InfiniteCanvasProps) {
  const rfNodes = useMemo(
    () => invNodes.map(n => investigationNodeToRFNode(n, selectedNodeId)),
    [invNodes, selectedNodeId]
  );
  const rfEdges = useMemo(
    () => invLinks.map(l => investigationLinkToRFEdge(l)),
    [invLinks]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(rfNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(rfEdges);

  useEffect(() => { setNodes(rfNodes); }, [rfNodes, setNodes]);
  useEffect(() => { setEdges(rfEdges); }, [rfEdges, setEdges]);

  const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    onNodeClick(node.id);
  }, [onNodeClick]);

  const isEmpty = invNodes.length === 0;

  return (
    <div className="relative w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        nodeTypes={NODE_TYPES}
        fitView={invNodes.length > 0}
        fitViewOptions={{ padding: 0.3, maxZoom: 1.2 }}
        defaultViewport={{ x: 0, y: 0, zoom: 0.8 }}
        minZoom={0.1}
        maxZoom={3}
        attributionPosition="bottom-right"
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="hsl(240 4% 20%)"
        />
        <Controls
          className="!bg-zinc-900 !border-zinc-700"
          showInteractive={false}
        />
        <MiniMap
          nodeColor={n => {
            const status = (n.data as { status?: string }).status;
            return status === 'fetched' ? '#10b981' : status === 'error' ? '#ef4444' : '#3b82f6';
          }}
          maskColor="hsla(240, 6%, 8%, 0.85)"
          className="!bg-zinc-900 !border-zinc-700"
        />
      </ReactFlow>

      <AnimatePresence>
        {isEmpty && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none"
          >
            <div className="flex flex-col items-center gap-4 text-center max-w-xs">
              <div className="text-5xl">🔍</div>
              <div>
                <div className="text-zinc-300 font-medium mb-1">Investigation Canvas</div>
                <div className="text-sm text-zinc-600">
                  Enter any identifier above to start investigating.
                  Nodes will appear here and expand as new identifiers are discovered.
                </div>
              </div>
              <div className="flex flex-wrap gap-2 justify-center text-xs text-zinc-600">
                {['✉️ Email', '🌐 IP Address', '📱 IMEI', '₿ Bitcoin', '🔑 API Key', '🌐 Domain'].map(tag => (
                  <span key={tag} className="px-2 py-1 rounded-full border border-zinc-800 bg-zinc-900">{tag}</span>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
