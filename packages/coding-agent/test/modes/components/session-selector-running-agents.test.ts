import { beforeAll, describe, expect, it, vi } from "bun:test";
import type { DescribeContext, NativeNode } from "@linxiraos/pi-tui/native/node";
import {
	type SessionSelectorOptions,
	type SessionSelectorRunningAgent,
	SessionSelectorComponent,
} from "@linxiraos/pi-tui/overlays/session-selector";
import { initTheme } from "@linxiraos/pi-tui/theme";
import type { TspPickerItem, TspPickerProps } from "@linxiraos/pi-wire";
import type { SessionInfo } from "@linxiraos/zeta/session/session-listing";

const withPicker: DescribeContext = {
	cols: 140,
	reduceMotion: false,
	dark: true,
	supports: () => true,
	feature: () => true,
};

function session(id: string, title: string, modified: string): SessionInfo {
	return {
		path: `/sessions/${id}.jsonl`,
		id,
		cwd: "/repo",
		title,
		created: new Date(modified),
		modified: new Date(modified),
		messageCount: 1,
		size: 0,
		firstMessage: `${title} prompt`,
		allMessagesText: `${title} prompt`,
	};
}

function agent(
	id: string,
	displayName: string,
	activity: string,
	createdAt = new Date("2026-01-01T00:00:00Z"),
): SessionSelectorRunningAgent {
	return {
		id,
		displayName,
		activity,
		createdAt,
		sessionFile: `/agents/${id}.jsonl`,
	};
}

const sessions = [session("alpha", "Alpha", "2026-01-02T00:00:00Z"), session("beta", "Beta", "2026-01-01T00:00:00Z")];

function make(
	options: SessionSelectorOptions<SessionInfo> = {},
	onSelect = vi.fn(),
	onSelectAgent = vi.fn(),
): SessionSelectorComponent<SessionInfo> {
	return new SessionSelectorComponent(
		sessions,
		onSelect,
		() => {},
		() => {},
		{
			onSelectRunningAgent: onSelectAgent,
			getTerminalRows: () => 40,
			...options,
		},
	);
}

function props(root: NativeNode): TspPickerProps {
	if (root.k !== "picker") throw new Error(`expected a picker, got ${root.k}`);
	return root.p ?? {};
}

function itemByLabel(root: NativeNode, label: string): TspPickerItem {
	const found = props(root).items?.find(candidate => candidate.label === label);
	expect(found).toBeDefined();
	return found!;
}

beforeAll(async () => {
	await initTheme(false);
});

describe("SessionSelectorComponent running agents", () => {
	it("keeps a separate Running Agents section, and search selects the agent row instead of a session", () => {
		const onSelect = vi.fn();
		const onSelectAgent = vi.fn();
		const selector = make(
			{ runningAgents: [agent("worker", "Worker", "reviewing the diff")], currentSessionPath: sessions[0]!.path },
			onSelect,
			onSelectAgent,
		);

		const text = selector.render(120).join("\n");
		expect(text).toContain("Running Agents (1)");
		expect(text).toContain("Worker");
		expect(text).toContain("reviewing the diff");
		expect(text).toContain("created");
		// The live session stays the default Enter target; an agent never steals it.
		expect(selector.getSessionList().selectedSession?.id).toBe("alpha");

		selector.handleInput("reviewing");
		expect(selector.getSessionList().selectedRunningAgent?.id).toBe("worker");
		expect(selector.getSessionList().selectedSession).toBeUndefined();

		selector.handleInput("\r");
		expect(onSelectAgent).toHaveBeenCalledTimes(1);
		expect(onSelectAgent.mock.calls[0]![0]).toMatchObject({ id: "worker" });
		// The worker transcript is never resumed as the main conversation.
		expect(onSelect).not.toHaveBeenCalled();

		// Clearing search returns the cursor to the live session, not the agent.
		selector.getSessionList().clearSearch();
		expect(selector.getSessionList().selectedSession?.id).toBe("alpha");
		selector.handleInput("\r");
		expect(onSelect).toHaveBeenCalledWith(sessions[0]!);
		expect(onSelectAgent).toHaveBeenCalledTimes(1);
	});

	it("live refresh updates activity without dropping the query or the selected agent", () => {
		let agents: readonly SessionSelectorRunningAgent[] = [agent("worker", "Worker", "reviewing the diff")];
		const selector = make({
			runningAgents: () => agents,
			currentSessionPath: sessions[0]!.path,
		});

		selector.handleInput("worker");
		expect(selector.getSessionList().selectedRunningAgent?.id).toBe("worker");

		agents = [agent("worker", "Worker", "writing the fix")];
		selector.refreshRunningAgents();

		expect(selector.getSessionList().searchInput.getValue()).toBe("worker");
		expect(selector.getSessionList().selectedRunningAgent?.id).toBe("worker");
		expect(selector.render(120).join("\n")).toContain("writing the fix");

		agents = [];
		selector.refreshRunningAgents();
		expect(selector.render(120).join("\n")).not.toContain("Running Agents");
		expect(selector.getSessionList().searchInput.getValue()).toBe("worker");
		expect(selector.getSessionList().selectedRunningAgent).toBeUndefined();
		expect(selector.getSessionList().selectedSession).toBeUndefined();
		selector.getSessionList().clearSearch();
		expect(selector.getSessionList().selectedSession?.id).toBe("alpha");
	});

	it("describes the live agents as their own picker group and activates only the observer callback", () => {
		const onSelect = vi.fn();
		const onSelectAgent = vi.fn();
		const selector = make(
			{ runningAgents: [agent("worker", "Worker", "reviewing the diff")], currentSessionPath: sessions[0]!.path },
			onSelect,
			onSelectAgent,
		);
		const root = selector.describe(withPicker);
		const p = props(root);
		const group = (p.order ?? []).find(
			row => typeof row === "object" && "group" in row && row.group === "running-agents",
		);
		expect(group).toEqual(expect.objectContaining({ group: "running-agents", label: "Running Agents", count: 1 }));

		const agentItem = itemByLabel(root, "Worker");
		selector.handleNativeEvent({ type: "select", key: "", item: agentItem.id });
		expect(selector.getSessionList().selectedRunningAgent?.id).toBe("worker");
		selector.handleNativeEvent({ type: "activate", key: "", item: agentItem.id });

		expect(onSelectAgent).toHaveBeenCalledWith(expect.objectContaining({ id: "worker" }));
		expect(onSelect).not.toHaveBeenCalled();
	});
});
