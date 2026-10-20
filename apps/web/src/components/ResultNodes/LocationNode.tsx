import { Navigation } from "lucide-react";
import { EvidenceBadge, InvalidNode, NodeFrame, NodeHeader } from "./shared";
import { t } from "@ir/i18n";
import { parseNodeData, type LocationNodeData } from "./contract";

/**
 * P3-016: the location result node on the new view model — typed data, the
 * token palette, and the evidence rule of P3-008. Network locations are
 * technical values (AS numbers, orgs): they render dir="ltr".
 */
interface Props {
  data: LocationNodeData;
  selected: boolean;
}

export function LocationNode({ data, selected }: Props) {
  const node = parseNodeData("location", data);
  if (!node) return <InvalidNode />;
  return (
    <NodeFrame
      selected={selected}
      header={
        <NodeHeader icon={<Navigation size={14} />} label={t("resultNodes.kind.location")}>
          {node.evidenceIds && <EvidenceBadge evidenceIds={node.evidenceIds} />}
        </NodeHeader>
      }
    >
      <p className="text-sm font-medium truncate" dir="ltr">
        {node.city || node.loc || node.label}
      </p>
      {node.loc && (
        <p className="text-xs text-muted-foreground font-mono" dir="ltr">
          {node.loc}
        </p>
      )}
      {(node.region || node.country) && (
        <p className="text-xs text-muted-foreground" dir="ltr">
          {[node.region, node.country].filter(Boolean).join(", ")}
        </p>
      )}
      {node.org && (
        <p className="text-xs text-muted-foreground truncate" dir="ltr">
          {node.org}
        </p>
      )}
    </NodeFrame>
  );
}
