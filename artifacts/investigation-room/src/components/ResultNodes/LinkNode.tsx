import { Handle, Position } from 'reactflow';
import { Link, ExternalLink } from 'lucide-react';

interface Props {
  data: { label: string; value: string; nodeData: Record<string, unknown> };
  selected: boolean;
}

export function LinkNode({ data, selected }: Props) {
  const url = data.value;
  return (
    <div className={`bg-zinc-900 border ${selected ? 'border-cyan-500' : 'border-zinc-700'} rounded-lg shadow-xl min-w-[220px] max-w-[300px]`}>
      <Handle type="target" position={Position.Top} className="!bg-cyan-500 !w-2 !h-2" />
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 bg-zinc-800 rounded-t-lg">
        <Link size={14} className="text-cyan-400" />
        <span className="text-xs font-medium text-zinc-300">رابط</span>
      </div>
      <div className="p-3">
        <p className="text-xs text-cyan-400 font-mono break-all">{url}</p>
        {(data.nodeData as { domain?: string }).domain && (
          <p className="text-xs text-zinc-500 mt-1">النطاق: {(data.nodeData as { domain?: string }).domain}</p>
        )}
      </div>
      <div className="border-t border-zinc-800">
        <a href={url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-1 py-1.5 hover:bg-zinc-800 text-zinc-500 hover:text-cyan-400 transition-colors">
          <ExternalLink size={11} /><span className="text-xs">فتح</span>
        </a>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-cyan-500 !w-2 !h-2" />
    </div>
  );
}
