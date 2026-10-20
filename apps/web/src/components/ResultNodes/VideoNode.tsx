import { ExternalLink, Play } from "lucide-react";
import { youtubeId } from "../../utils/youtube";
import { EvidenceBadge, InvalidNode, NodeAction, NodeFrame, NodeHeader } from "./shared";
import { t } from "@ir/i18n";
import { parseNodeData, type VideoNodeData } from "./contract";

/**
 * P3-016: the video result node on the new view model — typed data, the token
 * palette, and the evidence rule of P3-008. P1-023 preserved: the embed gate is
 * the parsed-hostname YouTube check (youtubeId) — a non-YouTube URL renders the
 * link and NO iframe, never a substring-match guess.
 */
interface Props {
  data: VideoNodeData;
  selected: boolean;
}

export function VideoNode({ data, selected }: Props) {
  const node = parseNodeData("video", data);
  if (!node) return <InvalidNode />;
  const id = youtubeId(node.url);
  return (
    <NodeFrame
      selected={selected}
      header={
        <NodeHeader icon={<Play size={14} />} label={t("resultNodes.kind.video")}>
          {node.evidenceIds && <EvidenceBadge evidenceIds={node.evidenceIds} />}
        </NodeHeader>
      }
      footer={
        <NodeAction href={node.url}>
          <ExternalLink size={11} />
          <span className="text-xs">{t("common.open")}</span>
        </NodeAction>
      }
    >
      {id ? (
        <iframe
          src={`https://www.youtube.com/embed/${id}`}
          title={node.label}
          className="w-full aspect-video rounded border-0"
          allowFullScreen
        />
      ) : (
        <p className="text-xs font-mono break-all text-muted-foreground" dir="ltr">
          {node.url}
        </p>
      )}
    </NodeFrame>
  );
}
