import { Download, Image } from "lucide-react";
import { EvidenceBadge, InvalidNode, NodeAction, NodeFrame, NodeHeader } from "./shared";
import { parseNodeData, type ImageNodeData } from "./contract";

/**
 * P3-016: the image result node on the new view model — typed data, the token
 * palette, and the evidence rule of P3-008.
 */
interface Props {
  data: ImageNodeData;
  selected: boolean;
}

export function ImageNode({ data, selected }: Props) {
  const node = parseNodeData("image", data);
  if (!node) return <InvalidNode />;
  return (
    <NodeFrame
      selected={selected}
      header={
        <NodeHeader icon={<Image size={14} />} label="صورة">
          {node.evidenceIds && <EvidenceBadge evidenceIds={node.evidenceIds} />}
        </NodeHeader>
      }
      footer={
        <NodeAction href={node.src}>
          <Download size={11} />
          <span className="text-xs">تحميل</span>
        </NodeAction>
      }
    >
      <img
        src={node.src}
        alt={node.label}
        loading="lazy"
        className="w-full rounded object-cover max-h-40"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = "none";
        }}
      />
      <p className="text-xs text-muted-foreground mt-1 truncate" dir="ltr">
        {node.label}
      </p>
    </NodeFrame>
  );
}
