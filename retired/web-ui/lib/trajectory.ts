/**
 * Trajectory derivation — pure function that groups session messages into
 * turns (user prompt → assistant process) and expands each assistant message
 * into cells (text / thinking / tool-call folded with its result).
 *
 * Pure and dependency-free so it can be unit-tested in isolation.
 */

import type { AgentMessage, AssistantMessage, ToolCallContent, ToolResultMessage } from "./types";

export interface TrajectoryCell {
  kind: "text" | "thinking" | "tool";
  /** Text payload for text/thinking cells. */
  text?: string;
  /** Tool identity for tool cells. */
  toolName?: string;
  toolCallId?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: string;
  isError?: boolean;
  /** Turn-level token accounting (attached to the assistant message's usage). */
  tokenInput?: number;
  tokenOutput?: number;
  tokenCacheRead?: number;
  /** Wall-clock duration in ms; null when timestamps are missing. */
  durationMs?: number | null;
  /** Index of the source assistant message in the input array (for inspection). */
  sourceMessageIndex: number;
}

export interface TrajectoryTurn {
  userText: string;
  userTimestamp?: number;
  cells: TrajectoryCell[];
  totalTokens: { input: number; output: number; cacheRead: number };
  durationMs?: number | null;
}

function assistantText(message: AssistantMessage): string {
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => (block as { text: string }).text)
    .join("");
}

function timestampOf(message: AgentMessage): number | undefined {
  return (message as AgentMessage & { timestamp?: number }).timestamp;
}

/**
 * Group `messages` into turns. A turn starts at a user message and spans the
 * following assistant/tool messages until the next user message. Assistant
 * content blocks expand into cells; each toolCall cell folds in its matching
 * toolResult (by toolCallId) with the tool's duration.
 */
export function deriveTrajectory(messages: AgentMessage[]): TrajectoryTurn[] {
  const turns: TrajectoryTurn[] = [];
  let current: TrajectoryTurn | null = null;
  const toolResults = new Map<string, ToolResultMessage>();

  // First pass: index tool results for folding.
  for (const message of messages) {
    if (message.role === "toolResult") {
      toolResults.set(message.toolCallId, message as ToolResultMessage);
    }
  }

  for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
    const message = messages[messageIndex];

    if (message.role === "user") {
      const text = Array.isArray(message.content)
        ? message.content
            .filter((block) => block.type === "text")
            .map((block) => (block as { text: string }).text)
            .join("")
        : (message.content as string) ?? "";
      current = {
        userText: text,
        userTimestamp: timestampOf(message),
        cells: [],
        totalTokens: { input: 0, output: 0, cacheRead: 0 },
      };
      turns.push(current);
      continue;
    }

    if (!current) continue; // assistant/tool messages before any user message

    if (message.role === "assistant") {
      const assistant = message as AssistantMessage;
      const usage = assistant.usage;
      if (usage) {
        current.totalTokens.input += usage.input ?? 0;
        current.totalTokens.output += usage.output ?? 0;
        current.totalTokens.cacheRead += usage.cacheRead ?? 0;
      }
      const turnStart = current.userTimestamp;

      for (const block of assistant.content) {
        if (block.type === "text") {
          current.cells.push({
            kind: "text",
            text: (block as { text: string }).text,
            tokenInput: usage?.input,
            tokenOutput: usage?.output,
            tokenCacheRead: usage?.cacheRead,
            durationMs: turnStart !== undefined ? (timestampOf(assistant) ?? Date.now()) - turnStart : null,
            sourceMessageIndex: messageIndex,
          });
        } else if (block.type === "thinking") {
          current.cells.push({
            kind: "thinking",
            text: (block as { thinking: string }).thinking,
            sourceMessageIndex: messageIndex,
          });
        } else if (block.type === "toolCall") {
          const call = block as ToolCallContent;
          const result = toolResults.get(call.toolCallId);
          const resultText = result
            ? result.content
                .filter((r) => r.type === "text")
                .map((r) => (r as { text: string }).text)
                .join("")
            : undefined;
          const callTs = timestampOf(assistant);
          const resultTs = result ? timestampOf(result) : undefined;
          current.cells.push({
            kind: "tool",
            toolName: call.toolName,
            toolCallId: call.toolCallId,
            toolInput: call.input,
            toolOutput: resultText,
            isError: result?.isError,
            durationMs: callTs !== undefined && resultTs !== undefined ? resultTs - callTs : null,
            sourceMessageIndex: messageIndex,
          });
        }
      }
    }
  }

  return turns;
}
