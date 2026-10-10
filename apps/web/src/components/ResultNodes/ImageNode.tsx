import { Handle, Position } from 'reactflow';
import { Image, Download } from 'lucide-react';

interface Props {
  data: { label: string; value: string; nodeData: Record<string, unknown> };
  selected: boolean;
}

export function ImageNode({ data, selected }: Props) {
  const src = (data.nodeData as { src?: string }).src || data.value;
  return (
    <div className={`bg-zinc-900 border ${selected ? 'border-pink-500' : 'border-zinc-700'} rounded-lg shadow-xl min-w-[200px] max-w-[280px]`}>
      <Handle type="target" position={Position.Top} className="!bg-pink-500 !w-2 !h-2" />
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 bg-zinc-800 rounded-t-lg">
        <Image size={14} className="text-pink-400" />
        <span className="text-xs font-medium text-zinc-300">صورة</span>
      </div>
      <div className="p-2">
        <img src={src} alt={data.label} loading="lazy" className="w-full rounded object-cover max-h-40" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        <p className="text-xs text-zinc-500 mt-1 truncate">{data.label}</p>
      </div>
      <div className="border-t border-zinc-800">
        <a href={src} download className="flex items-center justify-center gap-1 py-1.5 hover:bg-zinc-800 text-zinc-500 hover:text-pink-400 transition-colors">
          <Download size={11} /><span className="text-xs">تحميل</span>
        </a>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-pink-500 !w-2 !h-2" />
    </div>
  );
}
