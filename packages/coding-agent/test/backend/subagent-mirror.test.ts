import { describe, expect, test } from "bun:test";
import {
	applySubagentFrame,
	lifecycleFromRow,
	lifecycleStatus,
	progressFromRow,
	type BackendSubagentRow,
} from "../../src/backend/subagent-mirror";
import {
	TASK_SUBAGENT_LIFECYCLE_CHANNEL,
	TASK_SUBAGENT_PROGRESS_CHANNEL,
} from "@linxiraos/pi-tui/overlays/session-observer-registry";
import { EventBus } from "../../src/utils/event-bus";

function row(overrides: Partial<BackendSubagentRow> = {}): BackendSubagentRow {
	return {
		id: "sub-1",
		displayName: "Reviewer",
		status: "running",
		taskStatus: "running",
		index: 2,
		agent: "reviewer",
		agentSource: "builtin",
		description: "review the patch",
		task: "review the patch",
		assignment: "patch review",
		sessionFile: "/tmp/sub.jsonl",
		detached: true,
		parentToolCallId: "call-1",
		progress: {
			lastIntent: "reading",
			currentTool: "read",
			toolCount: 3,
			requests: 1,
			tokens: 120,
			cost: 0.01,
			durationMs: 2000,
			recentOutput: ["line"],
		},
		...overrides,
	};
}

function statusOf(data: unknown): unknown {
	return data && typeof data === "object" && "status" in data ? data.status : undefined;
}

function busPair(): { bus: EventBus; frames: Array<{ channel: string; data: unknown }> } {
	const bus = new EventBus();
	const frames: Array<{ channel: string; data: unknown }> = [];
	for (const channel of [TASK_SUBAGENT_LIFECYCLE_CHANNEL, TASK_SUBAGENT_PROGRESS_CHANNEL]) {
		bus.on(channel, data => frames.push({ channel, data }));
	}
	return { bus, frames };
}

describe("backend subagent mirror", () => {
	test("maps the roster lifecycle and progress vocabulary", () => {
		const running = lifecycleFromRow(row());
		expect(running.status).toBe("started");
		expect(running).toMatchObject({
			id: "sub-1",
			agent: "reviewer",
			agentSource: "builtin",
			description: "review the patch",
			sessionFile: "/tmp/sub.jsonl",
			parentToolCallId: "call-1",
			index: 2,
			detached: true,
		});

		expect(lifecycleStatus({ status: "idle", taskStatus: "completed" })).toBe("completed");
		expect(lifecycleStatus({ status: "idle" })).toBe("completed");
		expect(lifecycleStatus({ status: "parked" })).toBe("completed");
		expect(lifecycleStatus({ status: "aborted" })).toBe("aborted");
		expect(lifecycleStatus({ status: "running", taskStatus: "failed" })).toBe("failed");
		expect(lifecycleStatus({ status: "running" })).toBe("started");

		const progress = progressFromRow(row());
		expect(progress?.progress).toMatchObject({
			id: "sub-1",
			status: "running",
			toolCount: 3,
			requests: 1,
			tokens: 120,
			cost: 0.01,
			recentOutput: ["line"],
		});
		expect(progressFromRow(row({ progress: undefined }))).toBeUndefined();
	});

	test("a snapshot starts live rows, carries progress, and aborts vanished rows", () => {
		const { bus, frames } = busPair();
		const known = new Map<string, BackendSubagentRow>();

		applySubagentFrame(
			{
				type: "subagent_snapshot",
				subagents: [row(), row({ id: "sub-done", status: "idle", taskStatus: "completed" })],
			},
			bus,
			undefined,
			known,
		);
		expect(frames.filter(frame => frame.channel === TASK_SUBAGENT_LIFECYCLE_CHANNEL)).toHaveLength(1);
		expect(frames.filter(frame => frame.channel === TASK_SUBAGENT_PROGRESS_CHANNEL)).toHaveLength(2);
		expect(known.size).toBe(2);

		// The live row disappears from the next authoritative snapshot.
		frames.length = 0;
		applySubagentFrame({ type: "subagent_snapshot", subagents: [] }, bus, undefined, known);
		expect(statusOf(frames.find(frame => frame.channel === TASK_SUBAGENT_LIFECYCLE_CHANNEL)?.data)).toBe("aborted");
	});

	test("a status transition is emitted once and removal closes a live row", () => {
		const { bus, frames } = busPair();
		const known = new Map<string, BackendSubagentRow>();

		applySubagentFrame({ type: "subagent_status", subagent: row() }, bus, undefined, known);
		applySubagentFrame({ type: "subagent_status", subagent: row() }, bus, undefined, known);
		expect(frames.filter(frame => frame.channel === TASK_SUBAGENT_LIFECYCLE_CHANNEL)).toHaveLength(1);

		frames.length = 0;
		applySubagentFrame(
			{ type: "subagent_status", subagent: row({ id: "sub-1", status: "idle", taskStatus: "completed" }) },
			bus,
			undefined,
			known,
		);
		expect(frames.map(frame => statusOf(frame.data))).toEqual(["completed"]);

		frames.length = 0;
		applySubagentFrame(
			{ type: "subagent_status", subagent: row({ id: "sub-2", status: "running" }) },
			bus,
			undefined,
			known,
		);
		frames.length = 0;
		applySubagentFrame({ type: "subagent_removed", id: "sub-2" }, bus, undefined, known);
		expect(statusOf(frames[0]?.data)).toBe("aborted");
	});
});
