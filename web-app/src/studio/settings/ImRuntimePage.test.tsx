/**
 * Binding editor presentation: the conversation is selected by its human name,
 * and a shared conversation locks the facts one entrance may not hijack.
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BindingEditor } from "./ImRuntimePage";
import type { AgentsEnvelope, ChannelInstance, ImAgentProfile, ImBinding, ImConversation } from "./imRuntimeApi";

const profile: ImAgentProfile = {
	id: "companion",
	label: "Companion",
	persona: { mode: "workspace" },
	location: { kind: "workspace", workspace: "main" },
	tools: { builtin: [], extensions: [], customTools: [], mcpServers: [], skills: [], commands: [] },
	memory: {},
};

const instance: ChannelInstance = {
	id: "wechat",
	platform: "wechat",
	label: "WeChat",
	enabled: true,
	agentProfile: profile.id,
	allow: { peers: ["peer-a"] },
	credentials: {},
};

const conversation: ImConversation = {
	id: "native-1",
	name: "Release review",
	kind: "bot",
	attached: true,
	shared: true,
	entrances: 2,
	nativeSessionId: "native-1",
	workspaceAlias: "main",
	workspaceDisplay: "主工作区",
	targetKey: "workspace:main",
	targetDisplay: "主工作区",
	targetAvailable: true,
	agentProfileId: profile.id,
	agentProfileLabel: profile.label,
	model: { provider: "acme", model: "fast" },
	available: true,
};

const binding: ImBinding = {
	id: "b_0123456789abcdef",
	instanceId: "wechat",
	platform: "wechat",
	chatId: "peer-a",
	agentProfileId: profile.id,
	sessionId: conversation.id,
	targetKey: "workspace:main",
	target: { kind: "workspace", key: "workspace:main", display: "主工作区", available: true },
	role: "answer",
	model: { provider: "acme", model: "fast" },
	createdAt: "2026-01-01T00:00:00.000Z",
	conversationName: conversation.name,
	conversationEntrances: 2,
	conversationShared: true,
	nativeSessionId: "native-1",
};

const targets: AgentsEnvelope["targets"] = [
	{ kind: "workspace", key: "workspace:main", display: "主工作区", available: true },
];

describe("BindingEditor conversation chooser", () => {
	test("shows names, never raw conversation ids, and locks shared facts", () => {
		const html = renderToStaticMarkup(
			<BindingEditor
				initial={binding}
				instances={[instance]}
				profiles={[profile]}
				targets={targets}
				bindings={[binding]}
				conversations={[conversation]}
				busy={false}
				zh={false}
				onCancel={() => {}}
				onSave={() => {}}
			/>,
		);
		const optionText = [...html.matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map(match => match[1] ?? "");
		expect(optionText.some(text => text.includes("Release review"))).toBe(true);
		expect(optionText.some(text => text.includes("native-1"))).toBe(false);
		// Profile select, target select and both model inputs are owned by the
		// shared conversation and must not be editable from this entrance.
		expect(html.match(/disabled/g)?.length ?? 0).toBeGreaterThan(3);
		expect(html).toContain("Locked by the shared conversation.");
		expect(html).toContain("Shared conversation:");
	});
});
