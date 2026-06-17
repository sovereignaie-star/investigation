import { Handle, Position } from 'reactflow';
import { Navigation } from 'lucide-react';

interface Props {
  data: { label: string; value: string; nodeData: Record<string, unknown> };
  selected: boolean;
}

export function LocationNode({ data, selected }: Props) {
  const nd = data.nodeData as { loc?: string; city?: string; region?: string; country?: string; org?: string };
  return (
    <div className={`bg-zinc-900 border ${selected ? 'border-teal-500' : 'border-zinc-700'} rounded-lg shadow-xl min-w-[200px] max-w-[280px]`}>
      <Handle type="target" position={Position.Top} className="!bg-teal-500 !w-2 !h-2" />
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 bg-zinc-800 rounded-t-lg">
        <Navigation size={14} className="text-teal-400" />
        <span className="text-xs font-medium text-zinc-300">موقع</span>
      </div>
      <div className="p-3 space-y-1">
        {nd.city && <div className="flex gap-2"><span className="text-xs text-zinc-500">المدينة:</span><span className="text-xs text-white">{nd.city}</span></div>}
        {nd.region && <div className="flex gap-2"><span className="text-xs text-zinc-500">المنطقة:</span><span className="text-xs text-white">{nd.region}</span></div>}
        {nd.country && <div className="flex gap-2"><span className="text-xs text-zinc-500">الدولة:</span><span className="text-xs text-white">{nd.country}</span></div>}
        {nd.org && <div className="flex gap-2"><span className="text-xs text-zinc-500">المنظمة:</span><span className="text-xs text-white truncate">{nd.org}</span></div>}
        {nd.loc && <p className="text-xs text-teal-400 font-mono mt-1">{nd.loc}</p>}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-teal-500 !w-2 !h-2" />
    </div>
  );
}
