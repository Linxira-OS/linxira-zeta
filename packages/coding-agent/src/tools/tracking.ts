/**
 * `tracking_update` tool — 项目追踪文档系统
 *
 * Agent 调用此工具维护项目级追踪文档，记录进展、决策、状态。
 * 文件存放在 `<project>/.zeta/tracking/` 目录下。
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AgentTool, AgentToolResult } from "@linxiraos/pi-agent-core";
import { type } from "@linxiraos/pi-omptype";
import type { Component } from "@linxiraos/pi-tui";
import { Text } from "@linxiraos/pi-tui";
import { getProjectTrackingDir, getTrackingIndexPath, logger } from "@linxiraos/pi-utils";
import type { Settings } from "../config/settings";
import type { RenderResultOptions } from "../extensibility/custom-tools/types";
import { M } from "../i18n";
import trackingDescription from "../prompts/tools/tracking.md" with { type: "text" };
import type { ToolSession } from "../sdk";
import type { CompactionEntry } from "../session/session-entries";

// =============================================================================
// Types
// =============================================================================

export type TrackingOperation = "update_status" | "update_index" | "log_action" | "sync_plan";

export interface TrackingStatus {
	phase: string;
	progress: string;
	blockers: string[];
	decisions: string[];
	lastUpdated: string;
}

export interface TrackingAction {
	timestamp: string;
	action: string;
	detail?: string;
}

export interface TrackingToolDetails {
	op: TrackingOperation;
	path: string;
	message: string;
}

// =============================================================================
// Schema
// =============================================================================

const trackingSchema = type({
	op: type('"update_status" | "update_index" | "log_action" | "sync_plan"').describe("tracking operation to perform"),
	"content?": type("string").describe("content to write (markdown for update_index)"),
	"phase?": type("string").describe("project phase name (for update_status)"),
	"progress?": type("string").describe("progress description (for update_status)"),
	"blockers?": type("string").array().describe("blocker items (for update_status)"),
	"decisions?": type("string").array().describe("decision items (for update_status)"),
	"action?": type("string").describe("action description (for log_action)"),
	"detail?": type("string").describe("action detail (for log_action)"),
	"plan_path?": type("string").describe("path to plan file to sync (for sync_plan)"),
}).describe("update project tracking documents");

type TrackingSchema = typeof trackingSchema.infer;

// =============================================================================
// File helpers
// =============================================================================

const STATUS_FILE = "status.json";
const INDEX_FILE = "INDEX.md";
const ACTIONS_FILE = "actions.jsonl";
const SESSIONS_DIR = "sessions";
const SUMMARIES_DIR = "summaries";

/**
 * Persists committed compaction summaries without changing the live session
 * or the existing tracking document semantics.
 */
export class TrackingRecorder {
	#settings: Settings;

	constructor(settings: Settings) {
		this.#settings = settings;
	}

	async recordCompaction(cwd: string, entry: CompactionEntry): Promise<void> {
		if (this.#settings.get("tracking.enabled") !== true) return;

		try {
			const trackingDir = getProjectTrackingDir(cwd);
			const summariesDir = path.join(trackingDir, SUMMARIES_DIR);
			await fs.mkdir(summariesDir, { recursive: true });

			const timestamp = entry.timestamp.replace(/[:.]/g, "-");
			const summaryPath = path.join(summariesDir, `compaction-${timestamp}.md`);
			try {
				await fs.writeFile(summaryPath, `${entry.summary}\n`, { flag: "wx" });
			} catch (error) {
				if (!isFileExistsError(error)) throw error;
				await Bun.write(
					path.join(summariesDir, `compaction-${timestamp}-${entry.id}.md`),
					`${entry.summary.trim()}\n`,
				);
			}
		} catch (error) {
			logger.warn("Failed to persist tracking compaction summary", {
				cwd,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
}

function isFileExistsError(error: unknown): boolean {
	return error instanceof Error && "code" in error && error.code === "EEXIST";
}

async function ensureTrackingDir(cwd: string): Promise<string> {
	const dir = getProjectTrackingDir(cwd);
	await fs.mkdir(dir, { recursive: true });
	const sessionsDir = path.join(dir, SESSIONS_DIR);
	await fs.mkdir(sessionsDir, { recursive: true });
	return dir;
}

async function updateTrackingIndex(cwd: string): Promise<void> {
	const indexPath = getTrackingIndexPath();
	const projects = new Set<string>();

	try {
		const existing = await Bun.file(indexPath).json();
		if (Array.isArray(existing)) {
			for (const p of existing) projects.add(p);
		}
	} catch {}

	projects.add(cwd);
	await fs.mkdir(path.dirname(indexPath), { recursive: true });
	await Bun.write(indexPath, `${JSON.stringify([...projects], null, 2)}\n`);
}

async function handleUpdateStatus(cwd: string, params: TrackingSchema): Promise<string> {
	const dir = await ensureTrackingDir(cwd);
	const statusPath = path.join(dir, STATUS_FILE);

	let status: TrackingStatus;
	try {
		status = await Bun.file(statusPath).json();
	} catch {
		status = {
			phase: "",
			progress: "",
			blockers: [],
			decisions: [],
			lastUpdated: new Date().toISOString(),
		};
	}

	if (params.phase) status.phase = params.phase;
	if (params.progress) status.progress = params.progress;
	if (params.blockers) status.blockers = params.blockers;
	if (params.decisions) {
		status.decisions = [...new Set([...status.decisions, ...params.decisions])];
	}
	status.lastUpdated = new Date().toISOString();

	await Bun.write(statusPath, `${JSON.stringify(status, null, 2)}\n`);
	await updateTrackingIndex(cwd);

	return `Status updated: phase="${status.phase}", progress="${status.progress}", blockers=[${status.blockers.join(", ")}]`;
}

async function handleUpdateIndex(cwd: string, params: TrackingSchema): Promise<string> {
	const dir = await ensureTrackingDir(cwd);
	const indexPath = path.join(dir, INDEX_FILE);

	if (!params.content) {
		throw new Error("content is required for update_index operation");
	}

	await Bun.write(indexPath, `${params.content}\n`);
	await updateTrackingIndex(cwd);

	return `INDEX.md updated at ${indexPath}`;
}

async function handleLogAction(cwd: string, params: TrackingSchema): Promise<string> {
	const dir = await ensureTrackingDir(cwd);
	const actionsPath = path.join(dir, ACTIONS_FILE);

	const entry: TrackingAction = {
		timestamp: new Date().toISOString(),
		action: params.action ?? "unknown",
		detail: params.detail,
	};

	const line = `${JSON.stringify(entry)}\n`;
	await fs.appendFile(actionsPath, line);
	await updateTrackingIndex(cwd);

	return `Action logged: ${entry.action}`;
}

async function handleSyncPlan(cwd: string, params: TrackingSchema): Promise<string> {
	const dir = await ensureTrackingDir(cwd);
	const sessionsDir = path.join(dir, SESSIONS_DIR);

	if (!params.plan_path) {
		throw new Error("plan_path is required for sync_plan operation");
	}

	const planPath = params.plan_path;
	let content: string;
	try {
		content = await Bun.file(planPath).text();
	} catch (err) {
		throw new Error(`Failed to read plan file: ${err instanceof Error ? err.message : String(err)}`);
	}

	const basename = path.basename(planPath, ".md");
	const destPath = path.join(sessionsDir, `${basename}.md`);
	await Bun.write(destPath, content);
	await updateTrackingIndex(cwd);

	return `Plan synced: ${basename} → ${destPath}`;
}

// =============================================================================
// Tool
// =============================================================================

export class TrackingTool implements AgentTool<typeof trackingSchema, TrackingToolDetails> {
	readonly name = "tracking_update";
	readonly label = M.toolTrackingLabel;
	readonly description = trackingDescription;
	readonly parameters = trackingSchema;
	readonly approval = "read" as const;
	readonly loadMode = "discoverable" as const;
	readonly summary = M.toolTrackingSummary;

	constructor(private readonly session: ToolSession) {}

	async execute(_id: string, params: TrackingSchema): Promise<AgentToolResult<TrackingToolDetails>> {
		const cwd = this.session.cwd;

		try {
			let message: string;
			let op: TrackingOperation = params.op;
			switch (params.op) {
				case "update_status":
					message = await handleUpdateStatus(cwd, params);
					break;
				case "update_index":
					message = await handleUpdateIndex(cwd, params);
					break;
				case "log_action":
					message = await handleLogAction(cwd, params);
					break;
				case "sync_plan":
					message = await handleSyncPlan(cwd, params);
					break;
				default:
					op = params.op;
					throw new Error(`Unknown operation: ${params.op}`);
			}

			return {
				content: [{ type: "text", text: message }],
				details: {
					op,
					path: getProjectTrackingDir(cwd),
					message,
				},
			};
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err);
			logger.error("tracking_update failed", { error: errorMsg, op: params.op });
			return {
				content: [{ type: "text", text: `tracking_update error: ${errorMsg}` }],
				isError: true,
				details: {
					op: params.op,
					path: getProjectTrackingDir(cwd),
					message: errorMsg,
				},
			};
		}
	}

	render(_result: AgentToolResult<TrackingToolDetails>, _opts: RenderResultOptions): Component | null {
		const details = _result.details;
		if (!details) return null;
		return new Text(details.message);
	}
}
