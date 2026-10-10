import { Handle, Position } from 'reactflow';
import { Shield, Copy } from 'lucide-react';
import { IDENTIFIER_LIST } from '../../utils/identifierList';

interface Props {
  data: {
    label: string;
    value: string;
    identifierType: string;
    nodeData: Record<string, unknown>;
    status: string;
  };
  selected: boolean;
}

export function DefaultNode({ data, selected }: Props) {
  const typeDef = IDENTIFIER_LIST.find(i => i.id === data.identifierType);
  const color = selected ? 'border-blue-500' : 'border-zinc-700';

  return (
    <div className={`bg-zinc-900 border ${color} rounded-lg shadow-xl min-w-[200px] max-w-[280px] transition-all`}>
      <Handle type="target" position={Position.Top} className="!bg-blue-500 !w-2 !h-2" />
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 bg-zinc-800 rounded-t-lg">
        <span className="text-base">{typeDef?.icon || '🔍'}</span>
        <span className="text-xs font-medium text-zinc-300 truncate">{typeDef?.nameAr || typeDef?.name || data.identifierType}</span>
        {data.status === 'fetching' && <div className="ml-auto w-3 h-3 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />}
      </div>
      <div className="p-3">
        <p className="text-sm text-white font-mono break-all leading-tight">{data.label || data.value}</p>
        {Object.entries(data.nodeData || {}).slice(0, 4).map(([k, v]) => (
          <div key={k} className="flex gap-1 mt-1">
            <span className="text-xs text-zinc-500 shrink-0">{k}:</span>
            <span className="text-xs text-zinc-300 truncate">{String(v)}</span>
          </div>
        ))}
      </div>
      <div className="flex border-t border-zinc-800 divide-x divide-zinc-800">
        <button onClick={() => navigator.clipboard.writeText(data.value)} className="flex-1 flex items-center justify-center gap-1 py-1.5 hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors">
          <Copy size={11} /><span className="text-xs">نسخ</span>
        </button>
        <button className="flex-1 flex items-center justify-center gap-1 py-1.5 hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors">
          <Shield size={11} /><span className="text-xs">تحقيق</span>
        </button>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-blue-500 !w-2 !h-2" />
    </div>
  );
}
