import { Copy } from "lucide-react";
import { IDENTIFIER_LIST } from "../../utils/identifierList";
import { EvidenceBadge, InvalidNode, NodeAction, NodeFrame, NodeHeader, copyText } from "./shared";
import { t } from "@ir/i18n";
import { parseNodeData, type DefaultNodeData } from "./contract";

/**
 * P3-016: the default (identifier) result node on the new view model — typed
 * data, the token palette, and the evidence rule of P3-008. The identifier
 * type's icon and Arabic name come from the live catalog (P1-003 adapter).
 */
interface Props {
  data: DefaultNodeData;
  selected: boolean;
}

export function DefaultNode({ data, selected }: Props) {
  const node = parseNodeData("default", data);
  if (!node) return <InvalidNode />;
  const typeDef = IDENTIFIER_LIST.find((i) => i.id === node.identifierType);
  return (
    <NodeFrame
      selected={selected}
      header={
        <NodeHeader icon={<span className="text-base">{typeDef?.icon || "🔍"}</span>} label={typeDef?.nameAr || node.identifierType}>
          {node.evidenceIds && <EvidenceBadge evidenceIds={node.evidenceIds} />}
        </NodeHeader>
      }
      footer={
        <NodeAction onClick={() => copyText(node.value)}>
          <Copy size={11} />
          <span className="text-xs">{t("resultNodes.copyValue")}</span>
        </NodeAction>
      }
    >
      <p className="text-sm font-mono break-all leading-tight" dir="ltr">
        {node.label || node.value}
      </p>
    </NodeFrame>
  );
}
