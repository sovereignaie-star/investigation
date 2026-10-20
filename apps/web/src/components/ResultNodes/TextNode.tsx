import { Copy, FileText } from "lucide-react";
import { EvidenceBadge, InvalidNode, NodeAction, NodeFrame, NodeHeader, copyText } from "./shared";
import { t } from "@ir/i18n";
import { parseNodeData, type TextNodeData } from "./contract";

/**
 * P3-016: the text result node on the new view model — typed data, the token
 * palette, and the evidence rule of P3-008 (a node backed by evidence shows it).
 */
interface Props {
  data: TextNodeData;
  selected: boolean;
}

export function TextNode({ data, selected }: Props) {
  const node = parseNodeData("text", data);
  if (!node) return <InvalidNode />;
  return (
    <NodeFrame
      selected={selected}
      header={
        <NodeHeader icon={<FileText size={14} />} label={t("resultNodes.kind.text")}>
          {node.evidenceIds && <EvidenceBadge evidenceIds={node.evidenceIds} />}
        </NodeHeader>
      }
      footer={
        <NodeAction onClick={() => copyText(node.value)}>
          <Copy size={11} />
          <span className="text-xs">{t("resultNodes.copyText")}</span>
        </NodeAction>
      }
    >
      <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">{node.value}</p>
    </NodeFrame>
  );
}
