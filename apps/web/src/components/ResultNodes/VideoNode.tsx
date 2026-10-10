import { Handle, Position } from "reactflow";
import { Video, ExternalLink } from "lucide-react";
import { youtubeId } from "../../utils/youtube";

interface Props {
  data: { label: string; value: string; nodeData: Record<string, unknown> };
  selected: boolean;
}

export function VideoNode({ data, selected }: Props) {
  const src = (data.nodeData as { src?: string }).src || data.value;
  const ytId = youtubeId(src);
  const embedUrl = ytId ? `https://www.youtube.com/embed/${ytId}` : null;

  return (
    <div
      className={`bg-zinc-900 border ${selected ? "border-red-500" : "border-zinc-700"} rounded-lg shadow-xl min-w-[240px] max-w-[320px]`}
    >
      <Handle type="target" position={Position.Top} className="!bg-red-500 !w-2 !h-2" />
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 bg-zinc-800 rounded-t-lg">
        <Video size={14} className="text-red-400" />
        <span className="text-xs font-medium text-zinc-300">فيديو</span>
      </div>
      <div className="p-2">
        {embedUrl ? (
          <iframe src={embedUrl} className="w-full h-32 rounded" allow="encrypted-media" title={data.label} />
        ) : (
          <div className="w-full h-24 bg-zinc-800 rounded flex items-center justify-center">
            <Video size={32} className="text-zinc-600" />
          </div>
        )}
        <p className="text-xs text-zinc-500 mt-1 truncate">{data.label}</p>
      </div>
      <div className="border-t border-zinc-800">
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1 py-1.5 hover:bg-zinc-800 text-zinc-500 hover:text-red-400 transition-colors"
        >
          <ExternalLink size={11} />
          <span className="text-xs">فتح</span>
        </a>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-red-500 !w-2 !h-2" />
    </div>
  );
}
