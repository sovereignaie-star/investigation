import { ExternalLink, Link } from "lucide-react";
import { EvidenceBadge, InvalidNode, NodeAction, NodeFrame, NodeHeader } from "./shared";
import { parseNodeData, type LinkNodeData } from "./contract";

/**
 * P3-016: the link result node on the new view model — typed data, the token
 * palette, and the evidence rule of P3-008. The URL renders dir="ltr".
 */
interface Props {
  data: LinkNodeData;
  selected: boolean;
}

export function LinkNode({ data, selected }: Props) {
  const node = parseNodeData("link", data);
  if (!node) return <InvalidNode />;
  return (
    <NodeFrame
      selected={selected}
      header={
        <NodeHeader icon={<Link size={14} />} label="رابط">
          {node.evidenceIds && <EvidenceBadge evidenceIds={node.evidenceIds} />}
        </NodeHeader>
      }
      footer={
        <NodeAction href={node.url}>
          <ExternalLink size={11} />
          <span className="text-xs">فتح</span>
        </NodeAction>
      }
    >
      <p className="text-xs font-mono break-all text-primary" dir="ltr">
        {node.url}
      </p>
      {node.domain && (
        <p className="text-xs text-muted-foreground mt-1" dir="ltr">
          {node.domain}
        </p>
      )}
    </NodeFrame>
  );
}
