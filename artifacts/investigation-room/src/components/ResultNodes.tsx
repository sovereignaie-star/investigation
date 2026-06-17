import { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import type { InvestigationNodeData } from '../types';

const CONFIDENCE_COLOR: Record<number, string> = {};

function getEdgeColor(confidence: number): string {
  if (confidence >= 0.8) return '#10b981'; // emerald
  if (confidence >= 0.5) return '#3b82f6'; // blue
  return '#f59e0b'; // amber
}

interface BaseNodeProps extends NodeProps {
  data: InvestigationNodeData;
}

function BaseNode({ data, selected }: BaseNodeProps) {
  const statusClass =
    data.rawResult === null ? 'status-pending' :
    data.rawResult.success ? 'status-fetched' :
    'status-error';

  return (
    <div className={`investigation-node ${statusClass} ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Left} className="!border-zinc-600 !bg-zinc-700" />

      <div className="flex items-start gap-2 p-2.5">
        <span className="text-base leading-none shrink-0 mt-0.5">{data.detectedTypeIcon}</span>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] text-zinc-500 truncate mb-0.5">{data.detectedTypeName}</div>
          <div className="text-xs font-mono text-zinc-100 break-all leading-tight" style={{ wordBreak: 'break-all' }}>
            {data.searchTerm.length > 40 ? data.searchTerm.slice(0, 37) + '…' : data.searchTerm}
          </div>
        </div>
      </div>

      {data.rawResult === null && (
        <div className="px-2.5 pb-2 flex items-center gap-1.5">
          <div className="h-1 w-1 rounded-full bg-amber-400 animate-pulse" />
          <span className="text-[10px] text-zinc-500">Fetching...</span>
        </div>
      )}

      {data.rawResult?.source && (
        <div className="px-2.5 pb-2">
          <span className="text-[10px] text-zinc-600">via {data.rawResult.source}</span>
        </div>
      )}

      <Handle type="source" position={Position.Right} className="!border-zinc-600 !bg-zinc-700" />
    </div>
  );
}

export const TextNode = memo(BaseNode);
export const LinkNode = memo(BaseNode);
export const LocationNode = memo(BaseNode);
export const VideoNode = memo(BaseNode);
export const ImageNode = memo(BaseNode);
export const FileNode = memo(BaseNode);
export const MapNode = memo(BaseNode);
export const AudioNode = memo(BaseNode);
export const DefaultNode = memo(BaseNode);

export const NODE_TYPES = {
  text: TextNode,
  link: LinkNode,
  location: LocationNode,
  video: VideoNode,
  image: ImageNode,
  file: FileNode,
  map: MapNode,
  audio: AudioNode,
  default: DefaultNode,
};
