import { useEffect, useState } from "react";
import type { StudioClient } from "@linxiraos/studio-contract"
import type { EvaluationKind, EvaluationRecord } from "@linxiraos/studio-protocol"
import { usePreviewMode } from "../preview/PreviewContext";
import { useI18n } from "../i18n";
import { Icon } from "../icons";
import { startEvaluationPolling } from "./evaluationPolling";
import { useConversationView } from "../conversationWorkspace/Context";
import "./evaluation.css";

/** Only the status entry is global. Evaluation jobs remain owned by the Host. */
export function EvaluationActivity({
  client,
  visible,
  workspaceId,
  sessionId,
  onOpen,
}: {
  client: StudioClient;
  visible: boolean;
  workspaceId?: string | undefined;
  sessionId?: string | undefined;
  onOpen(id: string, kind: EvaluationKind): void;
}) {
  const { preview } = usePreviewMode(),
    { resolvedLanguage } = useI18n();
  const conversation = useConversationView();
  // This entry is global chrome, not one background poller per open/minimized chat.
  const shown = visible && (conversation?.active ?? true);
  const [runs, setRuns] = useState<EvaluationRecord[]>([]);
  useEffect(() => {
    setRuns([]);
    if (preview || !shown) return;
    let active = true;
    const read = async () => {
      try {
        const result = await client.query("evaluations.list", { ...(workspaceId ? { workspaceId } : {}), limit: 200 });
        if (active)
          setRuns(
            result.records.filter(
              (r) => r.interaction || ["preparing", "running", "cancelling"].includes(r.state),
            ),
          );
      } catch {
        if (active) setRuns([]);
      }
    };
    const stop = startEvaluationPolling({ client, load: read, intervalMs: 5000 });
    return () => {
      active = false;
      stop();
    };
  }, [client, workspaceId, sessionId, preview, shown]);
  if (!shown || !runs.length || preview) return null;
  const waiting = runs.find((r) => r.interaction),
    target = waiting ?? runs[0]!;
  return (
    <button
      className={`eval-background-entry${waiting ? " waiting" : ""}`}
      onClick={() => onOpen(target.id, target.spec.kind)}
    >
      <Icon name={waiting ? "alert" : "pulse"} />
      {resolvedLanguage === "zh"
        ? waiting
          ? "评测等待你的审查"
          : `${runs.length} 个评测正在运行`
        : waiting
          ? "Evaluation needs your review"
          : `${runs.length} evaluations running`}
    </button>
  );
}
