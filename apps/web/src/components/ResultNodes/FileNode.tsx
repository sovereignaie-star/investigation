import { Handle, Position } from 'reactflow';
import { File, Download } from 'lucide-react';

interface Props {
  data: { label: string; value: string; nodeData: Record<string, unknown> };
  selected: boolean;
}

export function FileNode({ data, selected }: Props) {
  const nd = data.nodeData as { name?: string; size?: number; type?: string; url?: string };
  const sizeStr = nd.size ? `${(nd.size / 1024).toFixed(1)} KB` : '';

  return (
    <div className={`bg-zinc-900 border ${selected ? 'border-amber-500' : 'border-zinc-700'} rounded-lg shadow-xl min-w-[200px] max-w-[280px]`}>
      <Handle type="target" position={Position.Top} className="!bg-amber-500 !w-2 !h-2" />
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 bg-zinc-800 rounded-t-lg">
        <File size={14} className="text-amber-400" />
        <span className="text-xs font-medium text-zinc-300">ملف</span>
      </div>
      <div className="p-3">
        <div className="flex items-start gap-2">
          <div className="w-10 h-12 bg-zinc-800 rounded flex items-center justify-center shrink-0">
            <File size={20} className="text-amber-400" />
          </div>
          <div>
            <p className="text-sm text-white font-medium truncate">{nd.name || data.label}</p>
            {nd.type && <p className="text-xs text-zinc-500">{nd.type}</p>}
            {sizeStr && <p className="text-xs text-zinc-500">{sizeStr}</p>}
          </div>
        </div>
      </div>
      {nd.url && (
        <div className="border-t border-zinc-800">
          <a href={nd.url} download className="flex items-center justify-center gap-1 py-1.5 hover:bg-zinc-800 text-zinc-500 hover:text-amber-400 transition-colors">
            <Download size={11} /><span className="text-xs">تحميل</span>
          </a>
        </div>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-amber-500 !w-2 !h-2" />
    </div>
  );
}
