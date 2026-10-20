import { Download, File } from "lucide-react";
import { EvidenceBadge, InvalidNode, NodeAction, NodeFrame, NodeHeader } from "./shared";
import { parseNodeData, type FileNodeData } from "./contract";

/**
 * P3-016: the file result node on the new view model — typed data, the token
 * palette, and the evidence rule of P3-008. The size renders only when known.
 */
interface Props {
  data: FileNodeData;
  selected: boolean;
}

const humanSize = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`;

export function FileNode({ data, selected }: Props) {
  const node = parseNodeData("file", data);
  if (!node) return <InvalidNode />;
  return (
    <NodeFrame
      selected={selected}
      header={
        <NodeHeader icon={<File size={14} />} label="ملف">
          {node.evidenceIds && <EvidenceBadge evidenceIds={node.evidenceIds} />}
        </NodeHeader>
      }
      footer={
        node.url ? (
          <NodeAction href={node.url}>
            <Download size={11} />
            <span className="text-xs">تحميل</span>
          </NodeAction>
        ) : undefined
      }
    >
      <div className="flex items-start gap-2">
        <div className="w-10 h-12 bg-muted rounded flex items-center justify-center shrink-0">
          <File size={20} className="text-primary" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate" dir="ltr">
            {node.name || node.label}
          </p>
          {node.mime && (
            <p className="text-xs text-muted-foreground" dir="ltr">
              {node.mime}
            </p>
          )}
          {node.size !== undefined && (
            <p className="text-xs text-muted-foreground" dir="ltr">
              {humanSize(node.size)}
            </p>
          )}
        </div>
      </div>
    </NodeFrame>
  );
}
