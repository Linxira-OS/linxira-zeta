import type { ConversationItem, ConversationRuntimeEvent, SessionId } from "@linxiraos/studio-contract";
import { isZh } from "../i18n";

const T0 = "2026-08-17T04:00:00.000Z";
const T1 = "2026-08-17T04:00:08.000Z";
const T2 = "2026-08-17T04:00:22.000Z";

const DEPS_ITEMS: ConversationItem[] = [
  {
    kind: "message",
    itemId: "preview-deps-user",
    parentId: null,
    createdAt: T0,
    role: "user",
    content: [{ type: "text", text: "审计 @earendil-works/pi-* 0.82.1 变更" }],
  },
  {
    kind: "message",
    itemId: "preview-deps-assistant",
    parentId: "preview-deps-user",
    createdAt: T1,
    role: "assistant",
    content: [
      { type: "thinking", text: "先对照 lockfile 和上游 changelog，确认是否只有 patch。" },
      { type: "text", text: "已扫过 lockfile：`pi-core` 与 `pi-agent` 升到 0.82.1，没有破坏性导出。" },
      { type: "toolCall", toolCallId: "preview-deps-grep", toolName: "grep", arguments: { pattern: "pi-core" } },
      {
        type: "toolResult",
        toolCallId: "preview-deps-grep",
        toolName: "grep",
        isError: false,
        output: "4 matches in 2 files",
      },
    ],
  },
];

const DOCS_ITEMS: ConversationItem[] = [
  {
    kind: "message",
    itemId: "preview-docs-user",
    parentId: null,
    createdAt: T0,
    role: "user",
    content: [{ type: "text", text: "提取 v0.8.1 Release Notes 要点" }],
  },
  {
    kind: "message",
    itemId: "preview-docs-assistant",
    parentId: "preview-docs-user",
    createdAt: T2,
    role: "assistant",
    content: [{ type: "text", text: "Release Notes 里和 Z Work Studio 相关的是 conversation live projector 与 session telemetry。" }],
  },
];

function buildDocsItems(zh: boolean): ConversationItem[] {
  return [
    {
      kind: "message",
      itemId: "preview-docs-user",
      parentId: null,
      createdAt: T0,
      role: "user",
      content: [{ type: "text", text: zh ? "提取 v0.8.1 Release Notes 要点" : "Extract key takeaways from v0.8.1 Release Notes" }],
    },
    {
      kind: "message",
      itemId: "preview-docs-assistant",
      parentId: "preview-docs-user",
      createdAt: T2,
      role: "assistant",
      content: [{ type: "text", text: zh ? "Release Notes 里和 Z Work Studio 相关的是 conversation live projector 与 session telemetry。" : "Relevant items in the Release Notes for Z Work Studio are conversation live projector and session telemetry." }],
    },
  ];
}

function buildPreviewItems(zh: boolean): ConversationItem[] {
  return [
    {
      kind: "message",
      itemId: "preview-preview-user",
      parentId: null,
      createdAt: T0,
      role: "user",
      content: [{ type: "text", text: zh ? "核对 Mermaid 全屏缩放" : "Verify Mermaid fullscreen zoom" }],
    },
    {
      kind: "message",
      itemId: "preview-preview-assistant",
      parentId: "preview-preview-user",
      createdAt: T1,
      role: "assistant",
      content: [
        { type: "text", text: zh ? "全屏缩放按钮在窄窗口下仍然可点，没有挡住关闭。" : "Fullscreen zoom buttons stay clickable in narrow windows without blocking the close button." },
        { type: "toolCall", toolCallId: "preview-browser", toolName: "browser", arguments: { action: "waitForSelector" } },
        {
          type: "toolResult",
          toolCallId: "preview-browser",
          toolName: "browser",
          isError: false,
          output: "selector visible",
        },
      ],
    },
  ];
}

export function previewSubagentConversationItems(agentId: string, zh = isZh()): readonly ConversationItem[] {
  const depsItems = buildDepsItems(zh);
  const byAgentId: { readonly [agentId: string]: readonly ConversationItem[] } = {
    "agent-019fcb01": depsItems,
    "agent-019fc9d2": buildDocsItems(zh),
    "agent-019fcb17": buildPreviewItems(zh),
  };
  return byAgentId[agentId] ?? depsItems;
}

/** A finite local demonstration, played only by the mounted hover reader. */
export function previewSubagentConversationStream(agentId: string, sessionId: SessionId, zh = isZh()): readonly { afterMs: number; event: ConversationRuntimeEvent }[] {
  if (agentId !== "agent-019fcb01") return [];
  const messageId = `preview-hover-${agentId}`;
  const turnId = "preview-hover-turn";
  const toolCallId = "preview-hover-check";
  const thinking = zh ? "依赖版本已经对齐，接着检查 TypeScript 导出和工作台调用是否仍然兼容。" : "Dependency versions are aligned; checking whether TypeScript exports and workbench calls remain compatible.";
  const textStart = zh
    ? "**兼容性检查**\n\n- `pi-core`：导出保持兼容\n- `pi-agent`：会话接口保持兼容\n\n```ts\nconst compatible = packages.every(pkg =>\n"
    : "**Compatibility check**\n\n- `pi-core`: exports remain compatible\n- `pi-agent`: session APIs remain compatible\n\n```ts\nconst compatible = packages.every(pkg =>\n";
  const textEnd = "  pkg.version === \"0.82.1\"\n);\n```\n";
  const summary = "\n\n检查已完成，Z Work Studio Bridge 与会话目录保持一致。";
  const output = "Checking pi-core exports…\nChecking pi-agent session API…\nTypeScript check passed.\n";
  const events: ConversationRuntimeEvent[] = [
    { kind: "conversation.message.started", sessionId, turnId, messageId, role: "assistant", createdAt: T2 },
    { kind: "conversation.message.delta", sessionId, turnId, messageId, blockId: "thinking", blockType: "thinking", delta: thinking },
    { kind: "conversation.message.delta", sessionId, turnId, messageId, blockId: "text", blockType: "text", delta: textStart },
    { kind: "conversation.message.delta", sessionId, turnId, messageId, blockId: "text", blockType: "text", delta: textEnd },
    { kind: "conversation.tool.started", sessionId, turnId, messageId, toolCallId, toolName: "bash", arguments: { command: "npm run typecheck" }, startedAt: T2 },
    { kind: "conversation.tool.updated", sessionId, turnId, toolCallId, updateMode: "append", output: "Checking pi-core exports…\n" },
    { kind: "conversation.tool.updated", sessionId, turnId, toolCallId, updateMode: "append", output: "Checking pi-agent session API…\n" },
    { kind: "conversation.tool.completed", sessionId, turnId, toolCallId, completedAt: T2,
      result: { type: "toolResult", toolCallId, toolName: "bash", isError: false, output, data: { output, exitCode: 0 } } },
    { kind: "conversation.message.delta", sessionId, turnId, messageId, blockId: "summary", blockType: "text", delta: summary },
    { kind: "conversation.message.completed", sessionId, turnId, messageId, item: {
      kind: "message", itemId: messageId, parentId: previewSubagentConversationItems(agentId, zh).at(-1)?.itemId ?? null, createdAt: T2, role: "assistant", content: [
        { type: "thinking", text: thinking }, { type: "text", text: textStart + textEnd },
        { type: "toolCall", toolCallId, toolName: "bash", arguments: { command: "npm run typecheck" } },
        { type: "toolResult", toolCallId, toolName: "bash", isError: false, output, data: { output, exitCode: 0 } }, { type: "text", text: summary },
      ],
    } },
    { kind: "conversation.turn.completed", sessionId, turnId },
  ];
  return events.map((event, index) => ({ afterMs: 450 * (index + 1), event }));
}
