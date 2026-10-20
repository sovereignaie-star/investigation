import { ExternalLink, MapPin } from "lucide-react";
import { EvidenceBadge, InvalidNode, NodeAction, NodeFrame, NodeHeader } from "./shared";
import { t } from "@ir/i18n";
import { parseNodeData, type MapNodeData } from "./contract";

/**
 * P3-016: the map result node on the new view model — typed data, the token
 * palette, and the evidence rule of P3-008. The geo coordinate follows the
 * catalog's geo_point shape ("lat,lng"); the embed is built only from a valid
 * pair (numbers, not a string guess) — no embed otherwise, honestly.
 */
interface Props {
  data: MapNodeData;
  selected: boolean;
}

export function MapNode({ data, selected }: Props) {
  const node = parseNodeData("map", data);
  if (!node) return <InvalidNode />;
  const [lat, lng] = node.geo ? node.geo.split(",") : ["", ""];
  const latNum = Number(lat);
  const lngNum = Number(lng);
  const valid = node.geo && lat !== "" && lng !== "" && Number.isFinite(latNum) && Number.isFinite(lngNum);
  const mapsUrl = valid ? `https://www.openstreetmap.org/?mlat=${latNum}&mlon=${lngNum}&zoom=10` : null;
  const embedUrl = valid
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${lngNum - 0.1},${latNum - 0.1},${lngNum + 0.1},${latNum + 0.1}&layer=mapnik&marker=${latNum},${lngNum}`
    : null;
  return (
    <NodeFrame
      selected={selected}
      header={
        <NodeHeader icon={<MapPin size={14} />} label={t("resultNodes.kind.map")}>
          {node.city && (
            <span className="text-xs text-muted-foreground" dir="ltr">
              {node.city}
              {node.country ? `, ${node.country}` : ""}
            </span>
          )}
          {node.evidenceIds && <EvidenceBadge evidenceIds={node.evidenceIds} />}
        </NodeHeader>
      }
      footer={
        mapsUrl ? (
          <NodeAction href={mapsUrl}>
            <ExternalLink size={11} />
            <span className="text-xs">{t("resultNodes.openMap")}</span>
          </NodeAction>
        ) : undefined
      }
    >
      {embedUrl ? (
        <iframe src={embedUrl} className="w-full h-32 rounded border-0" title={t("resultNodes.mapTitle")} />
      ) : (
        <div className="w-full h-24 bg-muted rounded flex items-center justify-center">
          <MapPin size={32} className="text-muted-foreground" />
        </div>
      )}
      {node.geo && (
        <p className="text-xs text-muted-foreground mt-1 font-mono" dir="ltr">
          {node.geo}
        </p>
      )}
    </NodeFrame>
  );
}
