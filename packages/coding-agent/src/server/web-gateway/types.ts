/**
 * Web Gateway DTO types.
 *
 * These mirror the web-ui client contract (`web-ui/lib/types.ts`) so the
 * gateway can serialize session data byte-compatibly with the legacy in-process
 * server. Session file entries are cast from the runtime's `SessionEntry`
 * (structurally compatible for the fields the web UI consumes).
 */

import type { SessionClient } from "../../session/session-client";
import type { ImMessageMetadata, ImSwitchControlMetadata } from "../../session/session-im";
import type { SessionOrigin } from "../../session/session-origin";
import type { SessionTaskSummary } from "../../session/session-task-summary";

export interface SessionHeader {
	type: "session";
	version?: number;
	id: string;
	timestamp: string;
	cwd: string;
	parentSession?: string;
	name?: string;
	title?: string;
	/** Client that created the session; absent on legacy transcripts (unknown). */
	client?: SessionClient;
	/** IM/bot/relay provenance; absent on personal sessions and legacy transcripts. */
	origin?: SessionOrigin;
}

export interface SessionEntryBase {
	type: string;
	id: string;
	parentId: string | null;
	timestamp: string;
}

export interface TextContent {
	type: "text";
	text: string;
}

export interface ImageContent {
	type: "image";
	source: {
		type: "base64" | "url";
		media_type?: string;
		data?: string;
		url?: string;
	};
}

export interface ThinkingContent {
	type: "thinking";
	thinking: string;
	deferred?: boolean;
}

export interface ToolCallContent {
	type: "toolCall";
	toolCallId: string;
	toolName: string;
	input: Record<string, unknown>;
}

export type AssistantContentBlock = TextContent | ImageContent | ThinkingContent | ToolCallContent;

export interface UserMessage {
	role: "user";
	content: string | (TextContent | ImageContent)[];
	timestamp?: number;
}

export interface AssistantMessage {
	role: "assistant";
	content: AssistantContentBlock[];
	model: string;
	provider: string;
	stopReason?: string;
	errorMessage?: string;
	timestamp?: number;
	usage?: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		cost: {
			input: number;
			output: number;
			cacheRead: number;
			cacheWrite: number;
			total: number;
		};
	};
}

export interface ToolResultMessage {
	role: "toolResult";
	toolCallId: string;
	toolName?: string;
	content: (TextContent | ImageContent)[];
	isError?: boolean;
	details?: unknown;
	timestamp?: number;
}

export interface CustomMessage {
	role: "custom";
	customType: string;
	content: string | (TextContent | ImageContent)[];
	display: boolean;
	details?: unknown;
	timestamp?: number;
}

export interface BashExecutionMessage {
	role: "bashExecution";
	command: string;
	output: string;
	exitCode?: number;
	cancelled?: boolean;
	truncated?: boolean;
	fullOutputPath?: string;
	excludeFromContext?: boolean;
	timestamp?: number;
}

export type AgentMessage = UserMessage | AssistantMessage | ToolResultMessage | CustomMessage | BashExecutionMessage;

export interface SessionMessageEntry extends SessionEntryBase {
	type: "message";
	message: AgentMessage;
}

export interface ThinkingLevelChangeEntry extends SessionEntryBase {
	type: "thinking_level_change";
	thinkingLevel: string;
}

export interface ModelChangeEntry extends SessionEntryBase {
	type: "model_change";
	provider: string;
	modelId: string;
}

export interface CompactionEntry extends SessionEntryBase {
	type: "compaction";
	summary: string;
	firstKeptEntryId: string;
	tokensBefore: number;
	details?: unknown;
	fromHook?: boolean;
}

export interface BranchSummaryEntry extends SessionEntryBase {
	type: "branch_summary";
	fromId: string;
	summary: string;
	details?: unknown;
	fromHook?: boolean;
}

export interface CustomEntry extends SessionEntryBase {
	type: "custom";
	customType: string;
	data?: unknown;
}

export interface CustomMessageEntry extends SessionEntryBase {
	type: "custom_message";
	customType: string;
	content: string | (TextContent | ImageContent)[];
	details?: unknown;
	display: boolean;
}

export interface LabelEntry extends SessionEntryBase {
	type: "label";
	targetId: string;
	label: string | undefined;
}

export interface SessionInfoEntry extends SessionEntryBase {
	type: "session_info";
	name?: string;
}

export type SessionEntry =
	| SessionMessageEntry
	| ThinkingLevelChangeEntry
	| ModelChangeEntry
	| CompactionEntry
	| BranchSummaryEntry
	| CustomEntry
	| CustomMessageEntry
	| LabelEntry
	| SessionInfoEntry;

export interface SessionTreeNode {
	entry: SessionEntry;
	children: SessionTreeNode[];
	label?: string;
	compressedEntryIds?: string[];
}

export interface SessionInfo {
	path: string;
	id: string;
	cwd: string;
	name?: string;
	created: string;
	modified: string;
	messageCount: number;
	firstMessage: string;
	parentSessionId?: string;
	projectRoot?: string;
	/** Branch the session's cwd sits on at listing time (null/absent outside git). */
	branch?: string;
	/** Branch of a linked worktree; kept for the web UI's worktree grouping. */
	worktreeBranch?: string;
	/** Set only for archived listings: the original project cwd. */
	archivedFrom?: string;
	/** Default-space bot session tag ("relay" | "bot" | "draft"); absent for ordinary sessions. */
	tag?: string;
	/**
	 * IM/bot/relay provenance. Set from the transcript header, or recovered from
	 * the web.yml `tag` for transcripts written before the header field existed,
	 * so the UI can keep these out of personal lists. Absent on personal sessions.
	 */
	origin?: SessionOrigin;
	/** Client that created the session; absent on legacy transcripts (unknown). */
	client?: SessionClient;
	/** Client that initiated the latest durable run; absent when none was recorded. */
	runClient?: SessionClient;
	/** Deterministic latest-task projection from the bounded session window. */
	taskSummary?: SessionTaskSummary;
	/** True when the session's cwd resolves inside the OS temp dir (scratch sessions). */
	temp?: boolean;
}

export interface SessionContext {
	messages: AgentMessage[];
	entryIds: string[];
	thinkingLevel: string;
	model: { provider: string; modelId: string } | null;
	/**
	 * IM provenance parallel to {@link messages}; present when at least one row
	 * carries it. `null` marks a message without IM metadata.
	 */
	messageMetadata?: (ImMessageMetadata | null)[];
	/**
	 * Durable IM switch handshakes in transcript order. These are not LLM
	 * messages; a viewer renders them from the same transcript, no second store.
	 */
	controlEvents?: Array<{ entryId: string; metadata: ImSwitchControlMetadata }>;
}
