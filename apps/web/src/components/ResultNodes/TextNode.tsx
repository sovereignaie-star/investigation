import { Handle, Position } from "@xyflow/react";
import { FileText, Copy } from "lucide-react";

interface Props {
  data: { label: string; value: string; nodeData: Record<string, unknown>; status: string };
  selected: boolean;
}

export function TextNode({ data, selected }: Props) {
  return (
    <div
      className={`bg-zinc-900 border ${selected ? "border-emerald-500" : "border-zinc-700"} rounded-lg shadow-xl min-w-[220px] max-w-[320px]`}
    >
      <Handle type="target" position={Position.Top} className="!bg-emerald-500 !w-2 !h-2" />
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 bg-zinc-800 rounded-t-lg">
        <FileText size={14} className="text-emerald-400" />
        <span className="text-xs font-medium text-zinc-300">نص</span>
      </div>
      <div className="p-3 max-h-48 overflow-y-auto">
        <p className="text-sm text-zinc-300 whitespace-pre-wrap break-words leading-relaxed">{data.value}</p>
      </div>
      <div className="border-t border-zinc-800">
        <button
          onClick={() => navigator.clipboard.writeText(data.value)}
          className="w-full flex items-center justify-center gap-1 py-1.5 hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <Copy size={11} />
          <span className="text-xs">نسخ النص</span>
        </button>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-emerald-500 !w-2 !h-2" />
    </div>
  );
}
