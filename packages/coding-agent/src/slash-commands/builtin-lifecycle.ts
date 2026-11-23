import { handleOmfgSlashCommand } from "./omfg";
import { handleTanSlashCommand } from "./tan";
import { clearSubmittedText, refuseImages, restoreDetachedDraft, runWithDetachedDraft } from "./helpers/draft";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { CompactionCancelledError } from "@linxiraos/pi-agent-core/compaction";
import { logger, setProjectDir } from "@linxiraos/pi-utils";
import { M } from "../i18n";
import { rescopeSessionToCwd } from "../session/cwd-rescope";
import { memoryStatsUnavailableMessage, resolveMemoryBackend } from "../memory-backend";
import { continuesConversation } from "../modes/utils/conversation-position";
import type { FreshSessionResult } from "../session/agent-session";
import { COMPACT_MODES, findCompactMode, type ParsedCompactArgs, parseCompactArgs } from "../session/compact-modes";
import { isInterruptReason } from "@linxiraos/pi-tui/chat/messages";
import { resolveResumableSession, resolveResumeTarget } from "../session/session-listing";
import { toggleSessionPin, unpinSession } from "../session/session-pins";
import {
	cleanSourceCheckoutIfConfigured,
	createSessionWorktree,
	defaultSessionWorktreeBranch,
	formatSessionWorktreeSummary,
} from "../session/session-worktree";
import type { SessionWorktree } from "../worktree/backend";
import { formatShakeSummary, type ShakeMode } from "../session/shake-types";
import { resolveShellDirectory, resolveToCwd } from "../tools/path-utils";
import { commandConsumed, errorMessage, usage } from "./helpers/parse";
import { shutdownHandlerTui } from "./helpers/shutdown";
import { handleSshAcp } from "./helpers/ssh";
import type {
	ParsedSlashCommand,
	SlashCommandResult,
	SlashCommandRuntime,
	SlashCommandSpec,
	TuiSlashCommandRuntime,
} from "./types";

function parseCompactionCommand(command: ParsedSlashCommand): ParsedCompactArgs | { error: string } {
	return command.name === "handoff"
		? { mode: "handoff", instructions: command.args || undefined }
		: parseCompactArgs(command.args);
}

async function handleCompact(command: ParsedSlashCommand, runtime: SlashCommandRuntime): Promise<SlashCommandResult> {
	const parsed = parseCompactionCommand(command);
	if ("error" in parsed) return usage(parsed.error, runtime);
	let failed = false;
	const run = async (): Promise<void> => {
		const before = runtime.session.getContextUsage?.()?.tokens;
		try {
			const { mode, instructions } = parsed;
			await runtime.session.compact(
				instructions,
				runtime.signal ? { mode, signal: runtime.signal } : mode ? { mode } : undefined,
			);
		} catch (err) {
			// Don't append an out-of-turn notice after the host already reported its interrupt.
			if (err instanceof CompactionCancelledError && (isInterruptReason(err.cause) || runtime.signal?.aborted)) {
				return;
			}
			const message = errorMessage(err);
			logger.error("Compaction failed", { error: message });
			failed = true;
			await runtime.output(`Compaction failed: ${message}`);
			return;
		}
		const after = runtime.session.getContextUsage?.()?.tokens;
		await runtime.output(
			before == null || after == null
				? "Compaction complete."
				: `Compaction complete. Tokens: ${before} -> ${after} (saved ${before - after}).`,
		);
	};
	if (runtime.runCommandInBackground) {
		runtime.runCommandInBackground(run);
		return commandConsumed();
	}
	await run();
	return commandConsumed({ failed });
}

async function handleCompactTui(command: ParsedSlashCommand, runtime: TuiSlashCommandRuntime): Promise<void> {
	const parsed = parseCompactionCommand(command);
	if (!("error" in parsed) && parsed.mode === "handoff" && refuseImages(command, runtime)) return;
	clearSubmittedText(runtime);
	if ("error" in parsed) {
		runtime.ctx.showWarning(parsed.error);
		return;
	}
	const { ctx } = runtime;
	const origin = runtime.followUp;
	// A switch still applying (or rolling back) decides which conversation is live.
	if (origin && ctx.session.isSessionTransitioning) await ctx.session.waitForSessionTransition();
	if (origin && !continuesConversation(ctx.sessionManager, origin)) {
		restoreDetachedDraft(ctx.editor, command.text, runtime.input?.images, runtime.input?.imageLinks);
		ctx.showWarning(`Conversation changed before /${command.name} ran; returned it to the editor`);
		return;
	}
	const background = parsed.mode && findCompactMode(parsed.mode)?.background;
	if (background) {
		// Background compaction doesn't hold the submission slot or its follow-ups.
		void ctx.handleCompactCommand(parsed.instructions, parsed.mode);
	} else if (origin && ctx.session.isStreaming) {
		ctx.yieldCompaction = { ...origin, text: command.text, instructions: parsed.instructions, mode: parsed.mode };
		ctx.updatePendingMessagesDisplay();
		ctx.showStatus("Queued compaction for when the agent yields");
		ctx.runYieldCompaction();
	} else {
		await ctx.handleCompactCommand(parsed.instructions, parsed.mode);
	}
}

function formatFreshSessionResult(result: FreshSessionResult): string {
	const stateLabel = result.closedProviderSessions === 1 ? "provider state" : "provider states";
	return `Fresh provider session started (${result.closedProviderSessions} ${stateLabel} pruned).`;
}

/** Parse the `/shake` subcommand into a {@link ShakeMode}; empty defaults to elide. */
function parseShakeMode(args: string): ShakeMode | { error: string } {
	const verb = args.trim().toLowerCase();
	if (verb === "" || verb === "elide") return "elide";
	if (verb === "images") return "images";
	if (verb === "thinking") return "thinking";
	return { error: `Unknown /shake mode "${verb}". Use elide, images, or thinking.` };
}

/** Format the session's workspace directories (cwd + additional) for display. */
function formatWorkspaceDirectories(runtime: SlashCommandRuntime, note?: string): string {
	const cwd = runtime.sessionManager.getCwd();
	const additional = runtime.sessionManager.getAdditionalDirectories();
	const lines = ["Workspace directories:", `  ${cwd} (working directory)`, ...additional.map(d => `  ${d}`)];
	return note ? `${note}\n${lines.join("\n")}` : lines.join("\n");
}
async function fatalMoveFailure(text: string, runtime: SlashCommandRuntime): Promise<SlashCommandResult> {
	await runtime.output(text);
	await runtime.session.dispose();
	return commandConsumed();
}

/** A move rollback failed: re-align the workspace to wherever the session ended up and report it. */
async function reportFailedRollback(runtime: SlashCommandRuntime, rollbackError: unknown): Promise<SlashCommandResult> {
	const actual = runtime.sessionManager.getCwd();
	try {
		await rescopeHeadlessToCwd(runtime, actual);
	} catch {
		return fatalMoveFailure(
			`Move failed and rollback failed: ${errorMessage(rollbackError)} (failed to re-align workspace to ${actual}; process remains at source while session is at ${actual})`,
			runtime,
		);
	}
	return usage(
		`Move failed and rollback failed: ${errorMessage(rollbackError)} (workspace remains at ${actual})`,
		runtime,
	);
}

/**
 * Relocate the headless session to `resolvedPath` (an existing directory):
 * flush settings, move the session file, re-scope the process, rolling back
 * on failure. Returns a result when the move did not complete; `undefined`
 * on success so the caller can report its own confirmation.
 */
async function relocateHeadlessSession(
	runtime: SlashCommandRuntime,
	resolvedPath: string,
): Promise<SlashCommandResult | undefined> {
	try {
		await runtime.settings.flush();
	} catch (err) {
		return usage(`Failed to save pending settings: ${errorMessage(err)}`, runtime);
	}
	const previousState = runtime.sessionManager.captureState();
	try {
		await runtime.session.moveSession(resolvedPath);
	} catch (err) {
		return usage(`Move failed: ${errorMessage(err)}`, runtime);
	}
	try {
		setProjectDir(resolvedPath);
	} catch (err) {
		try {
			await runtime.sessionManager.rollbackMove(previousState);
		} catch (rollbackError) {
			return reportFailedRollback(runtime, rollbackError);
		}
		return usage(`Move failed: ${errorMessage(err)}`, runtime);
	}
	try {
		await rescopeHeadlessToCwd(runtime, resolvedPath);
	} catch (err) {
		try {
			await runtime.sessionManager.rollbackMove(previousState);
			await rescopeHeadlessToCwd(runtime, previousState.cwd);
		} catch (rollbackError) {
			return reportFailedRollback(runtime, rollbackError);
		}
		return usage(`Move failed: ${errorMessage(err)}`, runtime);
	}
	await runtime.notifyConfigChanged?.();
	await runtime.notifyTitleChanged?.();
	return undefined;
}

/** Session id `/pin` and `/unpin` act on (the argument's match, else the active session), or the usage result. */
async function resolvePinTarget(
	command: ParsedSlashCommand,
	runtime: SlashCommandRuntime,
	verb: "pin" | "unpin",
): Promise<string | SlashCommandResult> {
	const sessionArg = command.args.trim();
	if (sessionArg) {
		const match = await resolveResumableSession(sessionArg, runtime.cwd, runtime.sessionManager.getSessionDir(), {
			allowGlobalFallback: true,
		});
		return match ? match.session.id : usage(`Session "${sessionArg}" not found.`, runtime);
	}
	return runtime.sessionManager.getSessionId() || usage(`No active session to ${verb}.`, runtime);
}

export const BUILTIN_LIFECYCLE_SLASH_COMMANDS: ReadonlyArray<SlashCommandSpec> = [
	{
		name: "ssh",
		icon: "host",
		description: () => M.cmdSsh,
		acpDescription: () => M.cmdSshAcp,
		inlineHint: "<subcommand>",
		subcommands: [
			{
				name: "add",
				description: () => M.cmdSshAdd,
				usage: "<name> --host <host> [--user <user>] [--port <port>] [--key <keyPath>] [--scope project|user]",
			},
			{ name: "list", description: () => M.cmdSshList },
			{ name: "remove", description: () => M.cmdSshRemove, usage: "<name> [--scope project|user]" },
			{ name: "help", description: () => M.cmdMcpHelp },
		],
		allowArgs: true,
		handle: handleSshAcp,
		handleTui: async (command, runtime) => {
			clearSubmittedText(runtime);
			await runtime.ctx.handleSSHCommand(command.text);
		},
	},
	{
		name: "new",
		icon: "plus",
		description: () => M.cmdNew,
		handleTui: async (_command, runtime) => {
			clearSubmittedText(runtime);
			await runtime.ctx.handleNewCommand();
		},
	},
	{
		name: "fresh",
		icon: "restart",
		description: () => M.cmdFresh,
		getTuiAutocompleteDescription: runtime =>
			runtime.ctx.session.isStreaming ? M.acFreshUnavailable : M.acFreshReady,
		handle: async (_command, runtime) => {
			const result = runtime.session.freshSession();
			if (!result) {
				await runtime.output(
					"Wait for the current response to finish or abort it before refreshing provider state.",
				);
				return commandConsumed();
			}
			await runtime.output(formatFreshSessionResult(result));
			return commandConsumed();
		},
		handleTui: async (_command, runtime) => {
			clearSubmittedText(runtime);
			await runtime.ctx.handleFreshCommand();
		},
	},
	{
		name: "clear",
		icon: "eraser",
		description: () => M.cmdClear,
		getTuiAutocompleteDescription: runtime =>
			runtime.ctx.session.isStreaming ? M.acClearUnavailable : M.acClearDrop,
		handleTui: async (_command, runtime) => {
			clearSubmittedText(runtime);
			await runtime.ctx.handleResetContextCommand();
		},
	},
	{
		name: "delete",
		icon: "trash",
		description: () => M.cmdDrop,
		allowArgs: true,
		inlineHint: "yes",
		handleTui: async (command, runtime) => {
			clearSubmittedText(runtime);
			if (command.args.trim() !== "yes") {
				const title = runtime.ctx.sessionManager.getSessionName() ?? runtime.ctx.sessionManager.getSessionId();
				runtime.ctx.showError(`Usage: /delete yes — would delete “${title}”. Nothing was deleted.`);
				return;
			}
			await runtime.ctx.handleDeleteCommand();
		},
	},
	{
		name: "compact",
		icon: "compress",
		description: () => M.cmdCompact,
		acpDescription: () => M.cmdCompactAcp,
		subcommands: COMPACT_MODES.map(mode => ({
			name: mode.name,
			// Thunk, not an eager `M.*` read: the spec table is built at import
			// time, so a plain read would freeze whichever locale was active then.
			description: () =>
				mode.name === "soft"
					? M.compactModeSoft
					: mode.name === "remote"
						? M.compactModeRemote
						: M.compactModeSnapcompact,
			usage: mode.rejectsFocus ? undefined : "[focus]",
		})),
		acpInputHint: `[${COMPACT_MODES.map(mode => mode.name).join("|")}] [focus]`,
		allowArgs: true,
		getTuiAutocompleteDescription: runtime => {
			const usage = runtime.ctx.session.getContextUsage();
			return usage ? M.acCompactUsedFmt.replace("%s", String(Math.round(usage.percent))) : M.acCompactUnavailable;
		},
		handle: handleCompact,
		handleTui: handleCompactTui,
	},
	{
		name: "shake",
		icon: "vibrate",
		description: () => M.cmdShake,
		acpDescription: () => M.cmdShakeAcp,
		subcommands: [
			{ name: "elide", description: () => M.cmdCompactElide },
			{ name: "images", description: () => M.cmdCompactImages },
			{ name: "thinking", description: () => M.cmdDropAllThinkingBlocks },
		],
		acpInputHint: "[elide|images|thinking]",
		allowArgs: true,
		handle: async (command, runtime) => {
			const mode = parseShakeMode(command.args);
			if (typeof mode !== "string") return usage(mode.error, runtime);
			const result = await runtime.session.shake(mode);
			await runtime.output(formatShakeSummary(result));
			return commandConsumed();
		},
		handleTui: async (command, runtime) => {
			clearSubmittedText(runtime);
			const mode = parseShakeMode(command.args);
			if (typeof mode !== "string") {
				runtime.ctx.showWarning(mode.error);
				return;
			}
			await runtime.ctx.handleShakeCommand(mode);
		},
	},
	{
		name: "handoff",
		icon: "handoff",
		description: () => M.cmdHandoff,
		acpDescription: () => M.cmdHandoff,
		inlineHint: "[focus instructions]",
		allowArgs: true,
		handle: handleCompact,
		handleTui: handleCompactTui,
	},
	{
		name: "resume",
		icon: "history",
		description: () => M.cmdResume,
		inlineHint: "[session id|@claude|@codex]",
		allowArgs: true,
		handleTui: async (command, runtime) => {
			const sessionArg = command.args.trim();
			clearSubmittedText(runtime);
			const foreignSource = sessionArg === "@claude" ? "claude" : sessionArg === "@codex" ? "codex" : undefined;
			if (foreignSource) {
				runtime.ctx.showSessionSelector(foreignSource);
				return;
			}
			if (!sessionArg) {
				runtime.ctx.showSessionSelector();
				return;
			}
			const target = await resolveResumeTarget(
				sessionArg,
				runtime.ctx.sessionManager.getCwd(),
				runtime.ctx.sessionManager.getSessionDir(),
				{ allowGlobalFallback: true },
			);
			if (!target) {
				runtime.ctx.showError(`Session "${sessionArg}" not found`);
				return;
			}
			try {
				await runtime.ctx.handleResumeSession(target.session.path, { continuation: target.continuation });
			} catch (error) {
				// The picker reports a failed switch itself; `/resume <id>` has no picker.
				runtime.ctx.showError(error instanceof Error ? error.message : String(error));
			}
		},
	},
	{
		name: "pin",
		icon: "pin",
		description: () => M.cmdPinorUnpinaSessionattheTopoftheResumeList,
		inlineHint: "[session id]",
		allowArgs: true,
		handle: async (command, runtime) => {
			const sessionId = await resolvePinTarget(command, runtime, "pin");
			if (typeof sessionId !== "string") return sessionId;
			const pinned = await toggleSessionPin(sessionId);
			await runtime.notifySessionPinChanged?.(sessionId, pinned);
			await runtime.output(pinned ? "Session pinned to the top of the resume list." : "Session unpinned.");
			return commandConsumed();
		},
	},
	{
		name: "unpin",
		icon: "pin",
		description: () => M.cmdUnpinaSessionfromtheTopoftheResumeList,
		inlineHint: "[session id]",
		allowArgs: true,
		handle: async (command, runtime) => {
			const sessionId = await resolvePinTarget(command, runtime, "unpin");
			if (typeof sessionId !== "string") return sessionId;
			const wasPinned = await unpinSession(sessionId);
			await runtime.notifySessionPinChanged?.(sessionId, false);
			await runtime.output(wasPinned ? "Session unpinned." : "Session is not pinned.");
			return commandConsumed();
		},
	},
	{
		name: "btw",
		icon: "question",
		description: () => M.cmdBtwHistory,
		inlineHint: "[question]",
		allowArgs: true,
		handleTui: async (command, runtime) => {
			const question = command.text.slice(`/${command.name}`.length).trim();
			await runWithDetachedDraft(
				command,
				runtime,
				() => runtime.ctx.handleBtwCommand(question, runtime.input?.images),
				{ restoreText: true },
			);
		},
	},
	{
		name: "tan",
		icon: "rocket",
		description: () => M.cmdTan,
		inlineHint: "<work>",
		allowArgs: true,
		handle: handleTanSlashCommand,
		handleTui: async (command, runtime) => {
			const work = command.text.slice(`/${command.name}`.length).trim();
			await runWithDetachedDraft(command, runtime, () => runtime.ctx.handleTanCommand(work, runtime.input?.images), {
				restoreText: true,
			});
		},
	},
	{
		name: "omfg",
		icon: "rule",
		description: () => M.cmdOmfg,
		inlineHint: "<complaint>",
		allowArgs: true,
		handle: handleOmfgSlashCommand,
		handleTui: async (command, runtime) => {
			if (refuseImages(command, runtime)) return;
			const complaint = command.text.slice(`/${command.name}`.length).trim();
			clearSubmittedText(runtime);
			await runtime.ctx.handleOmfgCommand(complaint);
		},
	},
	{
		name: "cleanse",
		icon: "stethoscope",
		description: () => M.cmdDetectandFixProjectDiagnosticswithWeightedParallelSubagents,
		inlineHint: "[request] [--all]",
		allowArgs: true,
		handle: async (command, runtime) => {
			const { handleCleanseSlashCommand } = await import("./cleanse");
			return handleCleanseSlashCommand(command, runtime);
		},
		handleTui: async (command, runtime) => {
			if (refuseImages(command, runtime)) return;
			const args = command.text.slice(`/${command.name}`.length).trim();
			clearSubmittedText(runtime);
			await runtime.ctx.handleCleanseCommand(args);
		},
	},
	{
		name: "retry",
		icon: "redo",
		description: () => M.cmdRetry,
		handle: async (_command, runtime) => {
			if (runtime.session.isStreaming) {
				return usage("Wait for the current response to finish or abort it before retrying.", runtime);
			}
			const didRetry = await runtime.session.retry();
			if (!didRetry) {
				return usage("Nothing to retry.", runtime);
			}
			await runtime.output("Retrying the last failed turn.");
			// `AgentSession.retry()` only schedules the continuation as a
			// post-prompt task; it returns before the retried turn streams. Hosts
			// whose prompt turn owns the event subscription (ACP) must stay open
			// across that turn — `AcpAgent.prompt` installs the subscription
			// before running the command and `#finishPrompt` unsubscribes, so
			// returning early would silently swallow the entire retried turn
			// (model output and tool calls). RPC and TUI omit this hook: they
			// stream the continuation through their own session subscription, and
			// blocking their command queue here would strand a follow-up `abort`.
			await runtime.keepTurnOpenUntilIdle?.();
			// `retry()` returned true, so a real agent turn is now scheduled — RPC
			// hosts must not be told this was local-only work.
			return commandConsumed({ agentInvoked: true });
		},
		handleTui: async (_command, runtime) => {
			const didRetry = await runtime.ctx.session.retry();
			if (!didRetry) {
				runtime.ctx.showStatus("Nothing to retry");
			}
			clearSubmittedText(runtime);
		},
	},
	{
		name: "debug",
		icon: "bug",
		description: () => M.cmdDebug,
		handleTui: async (_command, runtime) => {
			await runtime.ctx.showDebugSelector();
			clearSubmittedText(runtime);
		},
	},
	{
		name: "memory",
		icon: "memory",
		description: () => M.cmdMemory,
		acpDescription: () => M.cmdMemoryAcp,
		acpInputHint: "<subcommand>",
		subcommands: [
			{ name: "view", description: () => M.cmdMemoryView },
			{ name: "stats", description: () => M.cmdMemoryStats },
			{ name: "diagnose", description: () => M.cmdMemoryDiagnose },
			{ name: "queue", description: () => M.cmdShowPendingMemoryDeltasAwaitingConsolidation },
			{ name: "sync", description: () => M.cmdRunMemoryConsolidationNow },
			{ name: "clear", description: () => M.cmdMemoryClear },
			{ name: "reset", description: () => M.cmdMemoryReset },
			{ name: "enqueue", description: () => M.cmdMemoryEnqueue },
			{ name: "rebuild", description: () => M.cmdMemoryRebuild },
			{ name: "mm list", description: () => M.cmdMemoryMmList },
			{ name: "mm show", description: () => M.cmdMemoryMmShow },
			{
				name: "mm refresh",
				description: () => M.cmdMemoryMmRefresh,
			},
			{ name: "mm history", description: () => M.cmdMemoryMmHistory },
			{ name: "mm seed", description: () => M.cmdMemoryMmSeed },
			{ name: "mm delete", description: () => M.cmdMemoryMmDelete },
			{ name: "mm reload", description: () => M.cmdMemoryMmReload },
		],
		allowArgs: true,
		handle: async (command, runtime) => {
			const verb = (command.args.trim().split(/\s+/)[0] ?? "").toLowerCase() || "view";
			const backend = await resolveMemoryBackend(runtime.settings);
			switch (verb) {
				case "view": {
					const payload = await backend.buildDeveloperInstructions(
						runtime.settings.getAgentDir(),
						runtime.cwd,
						runtime.settings,
						runtime.session,
					);
					await runtime.output(payload || "Memory payload is empty.");
					return commandConsumed();
				}
				case "clear":
				case "reset": {
					await backend.clear(runtime.settings.getAgentDir(), runtime.cwd, runtime.session);
					await runtime.session.refreshBaseSystemPrompt();
					await runtime.output("Memory cleared.");
					return commandConsumed();
				}
				case "enqueue":
				case "rebuild": {
					await backend.enqueue(runtime.settings.getAgentDir(), runtime.cwd, runtime.session);
					await runtime.output("Memory consolidation enqueued.");
					return commandConsumed();
				}
				case "queue": {
					const payload = await backend.queuePreview?.({
						agentDir: runtime.settings.getAgentDir(),
						cwd: runtime.cwd,
						session: runtime.session,
					});
					await runtime.output(payload ?? `Memory queue is not available for the ${backend.id} backend.`);
					return commandConsumed();
				}
				case "sync": {
					await backend.enqueue(runtime.settings.getAgentDir(), runtime.cwd, runtime.session);
					await runtime.output("Memory consolidation ran.");
					return commandConsumed();
				}
				case "stats":
				case "diagnose": {
					const hook = verb === "stats" ? backend.stats : backend.diagnose;
					const payload = await hook?.(runtime.settings.getAgentDir(), runtime.cwd, runtime.session);
					await runtime.output(payload ?? memoryStatsUnavailableMessage(backend.id, verb));
					return commandConsumed();
				}
				case "mm":
					return usage(
						"Mental-model maintenance via /memory mm is unsupported in ACP mode; use the hindsight HTTP API directly.",
						runtime,
					);
				default:
					return usage("Usage: /memory <view|stats|diagnose|clear|reset|enqueue|rebuild|queue|sync>", runtime);
			}
		},
		handleTui: async (command, runtime) => {
			clearSubmittedText(runtime);
			await runtime.ctx.handleMemoryCommand(command.text);
		},
	},
	{
		name: "rename",
		icon: "pencil",
		description: () => M.cmdRenameGenerate,
		inlineHint: "[title]",
		allowArgs: true,
		handle: async (command, runtime) => {
			const session = runtime.session;
			const sessionManager = runtime.sessionManager;
			const runRename = async (): Promise<void> => {
				const sessionId = sessionManager.getSessionId();
				const titleSignal = session.titleGenerationSignal;
				let titleRevision = sessionManager.titleRevision;
				const isCurrent = () =>
					runtime.session === session &&
					runtime.sessionManager === sessionManager &&
					!runtime.signal?.aborted &&
					// An interrupt cancels a generated title; a typed one applies regardless.
					!(titleSignal.aborted && !command.args) &&
					sessionManager.getSessionId() === sessionId &&
					sessionManager.titleRevision === titleRevision;
				try {
					const generation = session.renameTitle(command.args, runtime.signal, runtime.language);
					titleRevision = sessionManager.titleRevision;
					const title = await generation;
					if (!isCurrent() || title === undefined) return;
					if (!title) {
						await runtime.output("Could not generate a session title. Use /rename <title> to set one.");
						return;
					}
					const persistence = sessionManager.setSessionName(title, "user");
					titleRevision = sessionManager.titleRevision;
					const ok = await persistence;
					if (!isCurrent()) return;
					if (!ok) {
						await runtime.output("Session name not changed (a user-set name takes precedence).");
						return;
					}
					await runtime.notifyTitleChanged?.();
					if (!isCurrent()) return;
					await runtime.output(`Session renamed to ${title}.`);
				} catch (err) {
					if (!isCurrent()) return;
					if (command.args || !runtime.runCommandInBackground) throw err;
					await runtime.output(`Rename failed: ${errorMessage(err)}`);
				}
			};
			if (!command.args && runtime.runCommandInBackground) {
				runtime.runCommandInBackground(runRename);
				return commandConsumed();
			}
			await runRename();
			return commandConsumed();
		},
		handleTui: async (command, runtime) => {
			clearSubmittedText(runtime);
			const session = runtime.ctx.session;
			const sessionManager = runtime.ctx.sessionManager;
			const sessionId = sessionManager.getSessionId();
			// `renameTitle` resolves undefined for a generated title an interrupt cancelled.
			const generation = session.renameTitle(command.args.trim());
			const titleRevision = sessionManager.titleRevision;
			const title = await generation;
			if (
				runtime.ctx.session !== session ||
				runtime.ctx.sessionManager !== sessionManager ||
				sessionManager.getSessionId() !== sessionId ||
				sessionManager.titleRevision !== titleRevision ||
				title === undefined
			)
				return;
			if (!title) {
				runtime.ctx.showStatus("Could not generate a session title. Use /rename <title> to set one.");
				return;
			}
			await runtime.ctx.handleRenameCommand(title);
		},
	},
	{
		name: "cd",
		aliases: ["chdir"],
		icon: "folderMove",
		description: () => M.cmdCd,
		acpDescription: () => M.cmdCdAcp,
		inlineHint: "[<path>]",
		allowArgs: true,
		argumentCompletionOnly: true,
		handle: async (command, runtime) => {
			if (!command.args) return usage("Usage: /cd <path>", runtime);
			if (runtime.session.isStreaming) return usage("Cannot change directory while streaming.", runtime);
			const resolvedPath = resolveShellDirectory(command.args, runtime.cwd);
			try {
				const stat = await fs.stat(resolvedPath);
				if (!stat.isDirectory()) return usage(`Not a directory: ${resolvedPath}`, runtime);
			} catch {
				return usage(`Directory does not exist: ${resolvedPath}`, runtime);
			}
			const failure = await relocateHeadlessSession(runtime, resolvedPath);
			if (failure) return failure;
			await runtime.output(`Changed directory to ${runtime.sessionManager.getCwd()}.`);
			return commandConsumed();
		},
		handleTui: async (command, runtime) => {
			if (runtime.ctx.session.isStreaming) {
				runtime.ctx.showWarning("Wait for the current response to finish or abort it before changing directory.");
				clearSubmittedText(runtime);
				return;
			}
			runtime.ctx.editor.addToHistory(command.text);
			clearSubmittedText(runtime);
			const target = command.args.trim();
			// `/cd <path>` moves directly; a bare `/cd` opens the folder picker.
			// `/cd` never creates a directory: TUI, headless and ACP agree.
			if (target) await runtime.ctx.handleMoveCommand(target, { allowCreate: false });
			else await runtime.ctx.showDirectoryPicker();
		},
	},
	{
		name: "move",
		icon: "folderMove",
		description: () => M.cmdMove,
		acpDescription: () => M.cmdMoveAcp,
		inlineHint: "[<path>]",
		allowArgs: true,
		handle: async (command, runtime) => {
			if (runtime.session.isStreaming) return usage("Cannot move while streaming.", runtime);
			if (!command.args) return usage("Usage: /move <path>", runtime);
			const resolvedPath = resolveShellDirectory(command.args, runtime.cwd);
			let exists = false;
			try {
				const stat = await fs.stat(resolvedPath);
				exists = true;
				if (!stat.isDirectory()) return usage(`Not a directory: ${resolvedPath}`, runtime);
			} catch {
				// Missing target: /move may create it, matching the TUI.
			}
			if (!exists) {
				const parentDir = path.dirname(resolvedPath);
				let parentExists = false;
				try {
					parentExists = (await fs.stat(parentDir)).isDirectory();
				} catch {
					parentExists = false;
				}
				if (!parentExists) {
					return usage(`Cannot create "${path.basename(resolvedPath)}": parent directory does not exist`, runtime);
				}
				try {
					await fs.mkdir(resolvedPath, { recursive: true });
				} catch (error) {
					return usage(`Failed to create directory: ${errorMessage(error)}`, runtime);
				}
			}
			const failure = await relocateHeadlessSession(runtime, resolvedPath);
			if (failure) return failure;
			await runtime.output(`Moved to ${runtime.sessionManager.getCwd()}.`);
			return commandConsumed();
		},
		handleTui: async (command, runtime) => {
			runtime.ctx.editor.addToHistory(command.text);
			clearSubmittedText(runtime);
			await runtime.ctx.handleMoveCommand(command.args || undefined);
		},
	},
	{
		name: "wt",
		aliases: ["worktree"],
		icon: "folderMove",
		description: () => M.cmdMoveThisSessionIntoaNewWorktreeChangesIncluded,
		acpDescription: () => M.cmdMoveThisSessionIntoaNewWorktreeChangesIncluded,
		inlineHint: "[<branch>]",
		allowArgs: true,
		handle: async (command, runtime) => {
			if (runtime.session.isStreaming) return usage("Cannot create a worktree while streaming.", runtime);
			const branch = command.args.trim() || defaultSessionWorktreeBranch();
			const sourceCwd = runtime.sessionManager.getCwd();
			let worktree: SessionWorktree;
			try {
				worktree = await createSessionWorktree(sourceCwd, runtime.settings, branch);
			} catch (err) {
				return usage(`Worktree creation failed: ${errorMessage(err)}`, runtime);
			}
			const failure = await relocateHeadlessSession(runtime, worktree.path);
			if (failure) return failure;
			const cleanup = await cleanSourceCheckoutIfConfigured(sourceCwd, runtime.settings);
			if (cleanup.errorMessage !== undefined) {
				await runtime.output(
					`Warning: Worktree created, but cleaning source checkout failed: ${cleanup.errorMessage}`,
				);
			}
			await runtime.output(formatSessionWorktreeSummary(worktree, cleanup.cleaned));
			return commandConsumed();
		},
		handleTui: async (command, runtime) => {
			runtime.ctx.editor.addToHistory(command.text);
			clearSubmittedText(runtime);
			await runtime.ctx.handleWorktreeCommand(command.args || undefined);
		},
	},
	{
		name: "add-dir",
		icon: "folderPlus",
		description: () => M.cmdAddDir,
		acpDescription: () => M.cmdAddDirAcp,
		inlineHint: "<path>",
		allowArgs: true,
		handle: async (command, runtime) => {
			if (runtime.session.isStreaming) return usage("Cannot add a directory while streaming.", runtime);
			if (!command.args) return usage(formatWorkspaceDirectories(runtime, "Usage: /add-dir <path>"), runtime);
			const resolved = resolveToCwd(command.args, runtime.cwd);
			try {
				const stat = await fs.stat(resolved);
				if (!stat.isDirectory()) return usage(`Not a directory: ${resolved}`, runtime);
			} catch {
				return usage(`Directory does not exist: ${resolved}`, runtime);
			}
			let added: string | null;
			try {
				added = await runtime.sessionManager.addWorkspaceDirectory(resolved);
			} catch (err) {
				return usage(errorMessage(err), runtime);
			}
			if (added === null) {
				await runtime.output(`Already in the workspace: ${resolved}`);
				return commandConsumed();
			}
			await runtime.session.refreshBaseSystemPrompt();
			await runtime.output(formatWorkspaceDirectories(runtime, `Added ${added}.`));
			return commandConsumed();
		},
	},
	{
		name: "remove-dir",
		icon: "folderMinus",
		description: () => M.cmdRemoveDir,
		acpDescription: () => M.cmdRemoveDirAcp,
		inlineHint: "<path>",
		allowArgs: true,
		handle: async (command, runtime) => {
			if (runtime.session.isStreaming) return usage("Cannot remove a directory while streaming.", runtime);
			if (!command.args) return usage("Usage: /remove-dir <path>", runtime);
			const resolved = resolveToCwd(command.args, runtime.cwd);
			if (resolved === path.resolve(runtime.cwd)) {
				return usage("Cannot remove the working directory; use /move to change it.", runtime);
			}
			let removed: string | null;
			try {
				removed = await runtime.sessionManager.removeWorkspaceDirectory(resolved);
			} catch (err) {
				return usage(errorMessage(err), runtime);
			}
			if (removed === null) {
				await runtime.output(`Not a workspace directory: ${resolved}`);
				return commandConsumed();
			}
			await runtime.session.refreshBaseSystemPrompt();
			await runtime.output(formatWorkspaceDirectories(runtime, `Removed ${removed}.`));
			return commandConsumed();
		},
	},
	{
		name: "dirs",
		description: () => M.cmdDirs,
		acpDescription: () => M.cmdDirsAcp,
		handle: async (_command, runtime) => {
			await runtime.output(formatWorkspaceDirectories(runtime));
			return commandConsumed();
		},
	},
	{
		name: "exit",
		description: () => M.cmdExit,
		handleTui: shutdownHandlerTui,
	},
	{
		name: "restart",
		icon: "restart",
		description: () => M.cmdRestartOmpwiththeSameLaunchFlagsResumingThisSession,
		inlineHint: "[client|backend]",
		allowArgs: true,
		handleTui: async (command, runtime) => {
			clearSubmittedText(runtime);
			const target = command.args.trim().toLowerCase();
			if (target === "backend") {
				const attach = runtime.ctx.backendAttach;
				if (!attach) {
					runtime.ctx.showError("This session is local; there is no backend to restart. Use /restart client.");
					return;
				}
				await attach.restartBackend();
				return;
			}
			if (target !== "" && target !== "client") {
				runtime.ctx.showError("Usage: /restart [client|backend]");
				return;
			}
			await runtime.ctx.restart();
		},
	},
];
async function rescopeHeadlessToCwd(runtime: SlashCommandRuntime, cwd: string): Promise<void> {
	setProjectDir(cwd);
	await rescopeSessionToCwd(runtime.session, runtime.settings, cwd);
	await runtime.refreshCommands?.();
}
