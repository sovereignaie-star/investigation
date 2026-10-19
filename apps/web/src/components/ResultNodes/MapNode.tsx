import { Handle, Position } from "@xyflow/react";
import { MapPin, ExternalLink } from "lucide-react";

interface Props {
  data: { label: string; value: string; nodeData: Record<string, unknown> };
  selected: boolean;
}

export function MapNode({ data, selected }: Props) {
  const nd = data.nodeData as { loc?: string; city?: string; country?: string };
  const loc = nd.loc || "";
  const [lat, lng] = loc ? loc.split(",") : ["", ""];
  const mapsUrl = lat && lng ? `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}&zoom=10` : null;
  const embedUrl =
    lat && lng
      ? `https://www.openstreetmap.org/export/embed.html?bbox=${Number(lng) - 0.1},${Number(lat) - 0.1},${Number(lng) + 0.1},${Number(lat) + 0.1}&layer=mapnik&marker=${lat},${lng}`
      : null;

  return (
    <div
      className={`bg-zinc-900 border ${selected ? "border-green-500" : "border-zinc-700"} rounded-lg shadow-xl min-w-[240px] max-w-[300px]`}
    >
      <Handle type="target" position={Position.Top} className="!bg-green-500 !w-2 !h-2" />
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 bg-zinc-800 rounded-t-lg">
        <MapPin size={14} className="text-green-400" />
        <span className="text-xs font-medium text-zinc-300">خريطة</span>
        {nd.city && (
          <span className="text-xs text-zinc-500">
            {nd.city}, {nd.country}
          </span>
        )}
      </div>
      <div className="p-2">
        {embedUrl ? (
          <iframe src={embedUrl} className="w-full h-32 rounded border-0" title="map" />
        ) : (
          <div className="w-full h-24 bg-zinc-800 rounded flex items-center justify-center">
            <MapPin size={32} className="text-zinc-600" />
          </div>
        )}
        {loc && <p className="text-xs text-zinc-500 mt-1 font-mono">{loc}</p>}
      </div>
      {mapsUrl && (
        <div className="border-t border-zinc-800">
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1 py-1.5 hover:bg-zinc-800 text-zinc-500 hover:text-green-400 transition-colors"
          >
            <ExternalLink size={11} />
            <span className="text-xs">فتح الخريطة</span>
          </a>
        </div>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-green-500 !w-2 !h-2" />
    </div>
  );
}
