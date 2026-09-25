/**
 * `tracking_update` tool — 项目追踪文档系统
 *
 * Agent 调用此工具维护项目级追踪文档，记录进展、决策、状态。
 * 文件存放在 `<project>/.zeta/tracking/` 目录下。
 */

import { cfgTrackingEnabled } from "./settings";
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
import indexTemplate from "../prompts/tracking/index-template.md" with { type: "text" };
import type { ToolSession } from "../sdk";
import type { CompactionEntry } from "../session/session-entries";

// =============================================================================
// Types
// =============================================================================

export type TrackingOperation = "update_status" | "update_index" | "log_action" | "sync_plan" | "sync_todo";

/** Mirrored todo-phase state (Tracking v2). */
export interface TrackingPhase {
	name: string;
	status: "pending" | "in_progress" | "completed";
}

export interface TrackingStatus {
	phase: string;
	progress: string;
	blockers: string[];
	decisions: string[];
	lastUpdated: string;
	/** Current todo phase name (set via sync_todo). */
	stage?: string;
	/** Ordered todo-phase mirror (set via sync_todo). */
	phases?: TrackingPhase[];
	/** Session that last wrote tracking state. */
	lastSessionId?: string | null;
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
	op: type('"update_status" | "update_index" | "log_action" | "sync_plan" | "sync_todo"').describe(
		"tracking operation to perform",
	),
	"content?": type("string").describe("content to write (markdown for update_index)"),
	"phase?": type("string").describe("project phase name (for update_status)"),
	"progress?": type("string").describe("progress description (for update_status)"),
	"blockers?": type("string").array().describe("blocker items (for update_status)"),
	"decisions?": type("string").array().describe("decision items (for update_status)"),
	"action?": type("string").describe("action description (for log_action)"),
	"detail?": type("string").describe("action detail (for log_action)"),
	"plan_path?": type("string").describe("path to plan file to sync (for sync_plan)"),
	"current_phase?": type("string").describe("current todo phase name (for sync_todo)"),
	"phases?": type("string").array().describe("ordered todo phase names (for sync_todo)"),
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
const PLANS_DIR = "plans";

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
		if (cfgTrackingEnabled.get(this.#settings) !== true) return;

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

/** One row of the global tracking index (`~/.zeta/agent/tracking-index.json`).
 *  v2 object shape; v1 stored a bare string[] of project paths. */
export interface TrackingIndexEntry {
	path: string;
	name: string;
	phase: string;
	progress: string;
	lastActiveSessionId: string | null;
	lastUpdated: string;
}

function trackingProjectName(cwd: string): string {
	const trimmed = cwd.replace(/[\\/]+$/, "");
	const base = path.basename(trimmed);
	return base === "" ? trimmed : base;
}

/** Migrate a v1 string entry (bare path) into a v2 object row. */
function trackingIndexEntryFromPath(cwd: string, lastUpdated: string): TrackingIndexEntry {
	return {
		path: cwd,
		name: trackingProjectName(cwd),
		phase: "",
		progress: "",
		lastActiveSessionId: null,
		lastUpdated,
	};
}

/** Seed INDEX.md from the fixed template on first use. */
async function ensureIndexTemplate(dir: string): Promise<void> {
	const indexPath = path.join(dir, INDEX_FILE);
	try {
		await fs.access(indexPath);
		return;
	} catch {
		// Not present yet — fall through and write the template.
	}
	const content = indexTemplate.replace("{{PROJECT}}", "Project Tracking");
	await Bun.write(indexPath, `${content}\n`);
}

async function ensureTrackingDir(cwd: string): Promise<string> {
	const dir = getProjectTrackingDir(cwd);
	await fs.mkdir(dir, { recursive: true });
	const sessionsDir = path.join(dir, SESSIONS_DIR);
	await fs.mkdir(sessionsDir, { recursive: true });
	await ensureIndexTemplate(dir);
	return dir;
}

async function updateTrackingIndex(cwd: string): Promise<void> {
	const indexPath = getTrackingIndexPath();
	const lastUpdated = new Date().toISOString();
	const byPath = new Map<string, TrackingIndexEntry>();

	try {
		const existing: unknown = await Bun.file(indexPath).json();
		if (Array.isArray(existing)) {
			for (const row of existing) {
				// v1 rows are bare path strings; v2 rows are objects keyed by path.
				if (typeof row === "string") {
					byPath.set(row, trackingIndexEntryFromPath(row, lastUpdated));
				} else if (row && typeof row === "object" && typeof (row as TrackingIndexEntry).path === "string") {
					const entry = row as TrackingIndexEntry;
					byPath.set(entry.path, entry);
				}
			}
		}
	} catch {
		// Missing or corrupt index — rebuild from scratch.
	}

	const existingEntry = byPath.get(cwd);
	const refreshed: TrackingIndexEntry = existingEntry
		? { ...existingEntry, lastUpdated }
		: trackingIndexEntryFromPath(cwd, lastUpdated);

	// Merge live status fields when status.json already exists.
	try {
		const statusPath = path.join(getProjectTrackingDir(cwd), STATUS_FILE);
		const status: TrackingStatus = await Bun.file(statusPath).json();
		refreshed.phase = status.phase ?? refreshed.phase;
		refreshed.progress = status.progress ?? refreshed.progress;
		refreshed.lastActiveSessionId = status.lastSessionId ?? refreshed.lastActiveSessionId;
	} catch {
		// No status yet — keep defaults.
	}

	byPath.set(cwd, refreshed);
	await fs.mkdir(path.dirname(indexPath), { recursive: true });
	await Bun.write(indexPath, `${JSON.stringify([...byPath.values()], null, 2)}\n`);
}

async function handleUpdateStatus(cwd: string, params: TrackingSchema, sessionId: string | null): Promise<string> {
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
	status.lastSessionId = sessionId;

	await Bun.write(statusPath, `${JSON.stringify(status, null, 2)}\n`);
	await updateTrackingIndex(cwd);

	return `Status updated: phase="${status.phase}", progress="${status.progress}", blockers=[${status.blockers.join(", ")}]`;
}

/** Mirrors todo phases into status.json and logs a phase_complete action when
 *  the stage advanced. Keeps the tracking docs aligned with the live todo list
 *  without the agent re-describing phases by hand. */
async function handleSyncTodo(cwd: string, params: TrackingSchema, sessionId: string | null): Promise<string> {
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

	const previousStage = status.stage ?? null;
	const currentPhase = params.current_phase ?? "";
	const phaseNames = params.phases ?? [];

	if (currentPhase) {
		status.stage = currentPhase;
		if (!status.phase) status.phase = currentPhase;
	}
	if (phaseNames.length > 0) {
		const currentIndex = currentPhase ? phaseNames.indexOf(currentPhase) : -1;
		status.phases = phaseNames.map((name, index) => ({
			name,
			status:
				index < currentIndex
					? ("completed" as const)
					: index === currentIndex
						? ("in_progress" as const)
						: ("pending" as const),
		}));
		// A current phase outside the declared list still shows as in_progress.
		if (currentIndex === -1 && currentPhase) {
			status.phases.push({ name: currentPhase, status: "in_progress" });
		}
	}
	status.lastUpdated = new Date().toISOString();
	status.lastSessionId = sessionId;

	await Bun.write(statusPath, `${JSON.stringify(status, null, 2)}\n`);

	if (previousStage && currentPhase && previousStage !== currentPhase) {
		const entry: TrackingAction = {
			timestamp: new Date().toISOString(),
			action: "phase_complete",
			detail: previousStage,
		};
		await fs.appendFile(path.join(dir, ACTIONS_FILE), `${JSON.stringify(entry)}\n`);
	}
	await updateTrackingIndex(cwd);

	return `Todo synced: stage="${status.stage ?? ""}", phases=[${(status.phases ?? []).map(p => p.name).join(" → ")}]`;
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

/** Best-effort mirror of an approved plan into `<project>/.zeta/tracking/plans/`.
 *  Read-only copy of the plan text; no-ops when tracking is disabled. Returns
 *  the mirror path, or null when disabled/empty/failed. */
export async function mirrorPlanToTracking(input: {
	settings: Settings;
	cwd: string;
	slug: string;
	planContent: string;
}): Promise<string | null> {
	if (cfgTrackingEnabled.get(input.settings) !== true) return null;
	if (input.planContent.trim() === "") return null;
	try {
		const trackingDir = getProjectTrackingDir(input.cwd);
		const plansDir = path.join(trackingDir, PLANS_DIR);
		await fs.mkdir(plansDir, { recursive: true });
		const stem = input.slug
			.normalize("NFC")
			.replace(/[^\p{L}\p{N}]+/gu, "-")
			.replace(/^-+|-+$/g, "")
			.toLowerCase();
		const safeStem = stem || "plan";
		const mirrorPath = path.join(plansDir, `${safeStem}-plan.md`);
		await Bun.write(mirrorPath, `${input.planContent.trim()}\n`);
		await updateTrackingIndex(input.cwd);
		return mirrorPath;
	} catch (error) {
		logger.warn("Failed to mirror plan into tracking", {
			cwd: input.cwd,
			error: error instanceof Error ? error.message : String(error),
		});
		return null;
	}
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
		const sessionId = this.session.getSessionId?.() ?? null;

		try {
			let message: string;
			let op: TrackingOperation = params.op;
			switch (params.op) {
				case "update_status":
					message = await handleUpdateStatus(cwd, params, sessionId);
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
				case "sync_todo":
					message = await handleSyncTodo(cwd, params, sessionId);
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
