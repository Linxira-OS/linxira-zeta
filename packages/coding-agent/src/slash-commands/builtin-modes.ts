import * as path from "node:path";
import {
	expandRoleAlias,
	formatModelString,
	getModelMatchPreferences,
	type ResolveCliModelResult,
	resolveCliModel,
} from "../config/model-resolver";
import type { SettingPath, Settings } from "../config/settings";
import { M } from "../i18n";
import { describeLoopLimitRuntime } from "../modes/loop-limit";
import type { InteractiveModeContext } from "../modes/types";
import type { AgentSession } from "../session/agent-session";
import { commandConsumed, errorMessage, usage } from "./helpers/parse";
import { handleSecurityCommand } from "./helpers/security";
import type { ParsedSlashCommand, SlashCommandSpec, TuiSlashCommandRuntime } from "./types";

export function refreshStatusLine(ctx: InteractiveModeContext): void {
	ctx.statusLine.invalidate();
	ctx.ui.requestRender();
}

/**
 * Resolve a `/model` / `/switch` selector the way `omp bench` and `--model`
 * do: exact `provider/id`, fuzzy ids (`opus`), role aliases (`@smol`, `smol`),
 * and `:level` thinking suffixes. Unqualified selectors prefer the session's
 * `--models` scope, else the authenticated set, before the full catalog.
 */
function resolveSessionModelSelector(
	selector: string,
	session: AgentSession,
	settings: Settings,
): ResolveCliModelResult {
	const scoped = session.scopedModels.map(entry => entry.model);
	return resolveCliModel({
		cliModel: selector,
		modelRegistry: session.modelRegistry,
		availableModels: scoped.length > 0 ? scoped : undefined,
		settings,
		preferences: getModelMatchPreferences(settings),
	});
}

async function runWithDetachedModeDraft(
	command: ParsedSlashCommand,
	runtime: TuiSlashCommandRuntime,
	run: () => Promise<boolean>,
): Promise<void> {
	const { editor } = runtime.ctx;
	if (!runtime.draftDetached) editor.clearDraft();
	try {
		const submitted = await run();
		if (!submitted && ((runtime.input?.images?.length ?? 0) > 0 || (runtime.input?.imageLinks?.length ?? 0) > 0)) {
			editor.pendingImages = [...(runtime.input?.images ?? []), ...editor.pendingImages];
			editor.pendingImageLinks = [
				...(runtime.input?.imageLinks ?? runtime.input?.images?.map(() => undefined) ?? []),
				...editor.pendingImageLinks,
			];
			editor.imageLinks = editor.pendingImageLinks.length > 0 ? editor.pendingImageLinks : undefined;
		}
	} catch (error) {
		if (!editor.getText() && editor.pendingImages.length === 0) {
			editor.setText(command.text);
			editor.pendingImages = runtime.input?.images ? [...runtime.input.images] : [];
			editor.pendingImageLinks = runtime.input?.imageLinks ? [...runtime.input.imageLinks] : [];
			editor.imageLinks = editor.pendingImageLinks.length > 0 ? editor.pendingImageLinks : undefined;
		}
		runtime.ctx.showError(error instanceof Error ? error.message : String(error));
	}
}

/** `/fast status` label for the active model: "on" when its family is priority, else "off". */
function formatFastModeStatus(session: AgentSession): string {
	return session.isFastModeEnabled() ? "on" : "off";
}

/** `/extended-context status` label for the premium long-context window setting. */
function formatExtendedContextStatus(settings: Settings): string {
	return settings.get("extendedContext") ? "on" : "off";
}

/** Applies an `/extended-context` argument and returns its operator feedback. */
function applyExtendedContextCommand(settings: Settings, args: string): string | undefined {
	const arg = args.trim().toLowerCase();
	const current = settings.get("extendedContext");
	if (!arg || arg === "toggle") {
		const enabled = !current;
		settings.set("extendedContext", enabled);
		return `Extended context ${enabled ? "enabled" : "disabled"}.`;
	}
	if (arg === "on") {
		settings.set("extendedContext", true);
		return "Extended context enabled.";
	}
	if (arg === "off") {
		settings.set("extendedContext", false);
		return "Extended context disabled.";
	}
	if (arg === "status") return `Extended context is ${formatExtendedContextStatus(settings)}.`;
	return undefined;
}

/** Detailed, session-effective `/computer status` diagnostics. */
function formatComputerUseStatus(session: AgentSession): string {
	const enabled = session.settings.get("computer.enabled");
	const active = session.getEvalPreludes().some(definition => definition.name === "computer");
	const configured = {
		display: session.settings.get("computer.display"),
		maxWidth: session.settings.get("computer.maxWidth"),
		maxHeight: session.settings.get("computer.maxHeight"),
	};
	return [
		M.ccComputerUseStateFmt.replace("%s", enabled ? M.stateEnabled : M.stateDisabled),
		M.ccPreludeStateFmt.replace("%s", active ? M.stateActive : M.stateInactive),
		M.ccComputerConfiguredFmt
			.replace("%s", String(configured.display))
			.replace("%s", String(configured.maxWidth))
			.replace("%s", String(configured.maxHeight)),
	].join(" · ");
}

/**
 * Apply a session-scoped computer-use toggle and rebuild the current prompt.
 * The override is never persisted to settings.json.
 */
async function applyComputerUseToggle(session: AgentSession, enable: boolean): Promise<string> {
	const previous = session.settings.get("computer.enabled");
	session.settings.override("computer.enabled", enable);
	if (enable && !session.getEvalPreludes().some(definition => definition.name === "computer")) {
		session.settings.override("computer.enabled", previous);
		return "Computer use is unavailable in this session.";
	}
	try {
		await session.refreshBaseSystemPrompt();
	} catch (error) {
		session.settings.override("computer.enabled", previous);
		throw error;
	}
	return enable
		? `Computer use enabled for this session. ${formatComputerUseStatus(session)}`
		: "Computer use disabled for this session.";
}

const AUTOCOMPLETE_DETAIL_LIMIT = 48;

function shortDetail(value: string, limit = AUTOCOMPLETE_DETAIL_LIMIT): string {
	const singleLine = value.replace(/\s+/g, " ").trim();
	return singleLine.length <= limit ? singleLine : `${singleLine.slice(0, limit - 1)}…`;
}

export function formatTokenCount(value: number): string {
	return value.toLocaleString();
}

export const BUILTIN_MODE_SLASH_COMMANDS: ReadonlyArray<SlashCommandSpec> = [
	{
		name: "security",
		icon: "shield",
		description: M.cmdSecurity,
		allowArgs: true,
		acpInputHint: "<plan|scan|status|cancel|scans|show|import|export|validate|compare|disposition>",
		subcommands: [
			{ name: "plan", description: M.cmdSecurityPlan },
			{ name: "scan", description: M.cmdSecurityScan },
			{ name: "status", description: M.cmdSecurityStatus },
			{ name: "cancel", description: M.cmdSecurityCancel },
			{ name: "scans", description: M.cmdSecurityScans },
			{ name: "show", description: M.cmdSecurityShow },
			{ name: "import", description: M.cmdSecurityImport },
			{ name: "export", description: M.cmdSecurityExport },
			{ name: "validate", description: M.cmdSecurityValidate },
			{ name: "compare", description: M.cmdSecurityCompare },
			{ name: "disposition", description: M.cmdSecurityDisposition },
		],
		handle: handleSecurityCommand,
	},
	{
		name: "settings",
		icon: "settings",
		description: M.cmdSettings,
		handleTui: (_command, runtime) => {
			runtime.ctx.showSettingsSelector();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "setup",
		aliases: ["providers"],
		icon: "gear",
		description: M.cmdSetup,
		allowArgs: true,
		subcommands: [{ name: "providers", description: M.cmdSetupProviders }],
		handleTui: async (command, runtime) => {
			const args = command.args.trim().toLowerCase();
			const opensProviders = args === "" || args === "providers";
			if (opensProviders) {
				await runtime.ctx.showProviderSetup();
			} else {
				runtime.ctx.showWarning(`Usage: /${command.name} [providers]`);
			}
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "plan",
		icon: "plan",
		description: M.cmdPlan,
		inlineHint: "[prompt]",
		allowArgs: true,
		getTuiAutocompleteDescription: runtime => {
			if (!runtime.ctx.settings.get("plan.enabled" as SettingPath)) return M.acPlanDisabledInSettings;
			if (runtime.ctx.planModeEnabled) {
				const planFile = runtime.ctx.planModePlanFilePath;
				return M.acPlanOnFmt.replace("%s", planFile ? ` (${path.basename(planFile)})` : "");
			}
			if (runtime.ctx.goalModeEnabled) return M.acPlanBlockedByGoalMode;
			return M.acPlanOff;
		},
		handleTui: async (command, runtime) => {
			await runWithDetachedModeDraft(command, runtime, () =>
				runtime.ctx.handlePlanModeCommand(command.args || undefined, runtime.input),
			);
		},
	},
	{
		name: "plan-ultra",
		icon: "plan",
		description: M.cmdToggleUltraPlanModeFanOutScoutingIncrementalPlanWritesDeepestDecisionFloor,
		inlineHint: "[prompt]",
		allowArgs: true,
		getTuiAutocompleteDescription: runtime => {
			if (!runtime.ctx.settings.get("plan.enabled" as SettingPath)) return M.acPlanUltraDisabledInSettings;
			const workflow = runtime.ctx.session.getPlanModeState?.()?.workflow;
			if (runtime.ctx.planModeEnabled && workflow === "ultra") {
				const planFile = runtime.ctx.planModePlanFilePath;
				return M.acPlanUltraOnFmt.replace("%s", planFile ? ` (${path.basename(planFile)})` : "");
			}
			if (runtime.ctx.planModeEnabled) return M.acPlanUltraAlreadyActive;
			if (runtime.ctx.goalModeEnabled) return M.acPlanUltraBlockedByGoalMode;
			return M.acPlanUltraOff;
		},
		handleTui: async (command, runtime) => {
			await runWithDetachedModeDraft(command, runtime, () =>
				runtime.ctx.handlePlanUltraCommand(command.args || undefined, runtime.input),
			);
		},
	},
	{
		name: "plan-review",
		icon: "plan",
		description: M.cmdPlanReview,
		getTuiAutocompleteDescription: runtime =>
			runtime.ctx.planModeEnabled ? M.acPlanReviewAvailable : M.acPlanReviewInactive,
		handleTui: async (_command, runtime) => {
			await runtime.ctx.openPlanReview();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "vibe",
		icon: "wave",
		description: M.cmdVibe,
		inlineHint: "[prompt]",
		allowArgs: true,
		getTuiAutocompleteDescription: runtime => {
			if (runtime.ctx.vibeModeEnabled) return M.acVibeOn;
			if (runtime.ctx.planModeEnabled) return M.acVibeBlockedByPlanMode;
			if (runtime.ctx.goalModeEnabled) return M.acVibeBlockedByGoalMode;
			return M.acVibeOff;
		},
		handleTui: async (command, runtime) => {
			await runWithDetachedModeDraft(command, runtime, () =>
				runtime.ctx.handleVibeModeCommand(command.args || undefined, runtime.input),
			);
		},
	},
	{
		name: "goal",
		icon: "goal",
		description: M.cmdGoal,
		subcommands: [
			{ name: "set", description: M.cmdGoalSet, usage: "<objective>" },
			{ name: "show", description: M.cmdGoalShow },
			{ name: "pause", description: M.cmdGoalPause },
			{ name: "resume", description: M.cmdGoalResume },
			{ name: "drop", description: M.cmdGoalDrop },
			{ name: "budget", description: M.cmdGoalBudget, usage: "<N|off>" },
		],
		inlineHint: "[objective]",
		allowArgs: true,
		getTuiAutocompleteDescription: runtime => {
			if (!runtime.ctx.settings.get("goal.enabled" as SettingPath)) return M.acGoalDisabledInSettings;
			if (runtime.ctx.planModeEnabled) return M.acGoalBlockedByPlanMode;
			const state = runtime.ctx.session.getGoalModeState();
			return state
				? M.acGoalOnFmt.replace("%s", state.goal.status).replace("%s", shortDetail(state.goal.objective))
				: M.acGoalOff;
		},
		handleTui: async (command, runtime) => {
			await runWithDetachedModeDraft(command, runtime, () =>
				runtime.ctx.handleGoalModeCommand(command.args || undefined, runtime.input),
			);
		},
	},
	{
		name: "guided-goal",
		icon: "compass",
		description: M.cmdGuidedGoal,
		inlineHint: "[rough objective]",
		allowArgs: true,
		handleTui: async (command, runtime) => {
			await runWithDetachedModeDraft(command, runtime, () =>
				runtime.ctx.handleGuidedGoalCommand(command.args || undefined, runtime.input),
			);
		},
	},
	{
		name: "loop",
		icon: "loop",
		description: M.cmdLoop,
		inlineHint: "[count|duration] [prompt]",
		allowArgs: true,
		getTuiAutocompleteDescription: runtime => {
			if (!runtime.ctx.loopModeEnabled) return M.acLoopOff;
			if (runtime.ctx.loopModePaused) return M.acLoopPaused;
			if (runtime.ctx.loopLimit)
				return M.acLoopOnLimitFmt.replace("%s", describeLoopLimitRuntime(runtime.ctx.loopLimit));
			if (runtime.ctx.loopPrompt) return M.acLoopOnRepeating;
			return M.acLoopOnWaiting;
		},
		handleTui: async (command, runtime) => {
			const prompt = await runtime.ctx.handleLoopCommand(command.args);
			runtime.ctx.editor.setText("");
			// Surface any inline prompt so the dispatcher returns it and the normal
			// submit flow runs the first loop iteration (recording it as the loop prompt).
			if (prompt) return { prompt };
		},
	},
	{
		name: "queue",
		icon: "inbox",
		description: M.cmdQueue,
		inlineHint: "<message>",
		allowArgs: true,
		handleTui: async (command, runtime) => {
			await runtime.ctx.handleQueueCommand(command.args);
		},
	},
	{
		name: "model",
		aliases: ["models"],
		icon: "model",
		description: M.cmdModel,
		acpDescription: M.cmdModelAcp,
		getTuiAutocompleteDescription: runtime => {
			const model = runtime.ctx.session.model;
			return model ? M.acModelFmt.replace("%s", model.provider).replace("%s", model.id) : M.acModelNone;
		},
		handle: async (command, runtime) => {
			if (command.args) {
				const selector = command.args.trim();
				const resolved = resolveSessionModelSelector(selector, runtime.session, runtime.settings);
				const match = resolved.model;
				if (!match) {
					return usage(
						`Unknown model: ${selector}. Use ACP \`session/setModel\` for picker-driven selection or list available models with /model.`,
						runtime,
					);
				}
				try {
					await runtime.session.setModel(match);
					if (resolved.thinkingLevel !== undefined) runtime.session.setThinkingLevel(resolved.thinkingLevel);
					await runtime.output(`Model set to ${match.provider}/${match.id}.`);
					await runtime.notifyTitleChanged?.();
					await runtime.notifyConfigChanged?.();
					return commandConsumed();
				} catch (err) {
					return usage(`Failed to set model: ${errorMessage(err)}`, runtime);
				}
			}

			const model = runtime.session.model;
			await runtime.output(
				model ? `Current model: ${model.provider}/${model.id}` : "No model is currently selected.",
			);
			return commandConsumed();
		},
		handleTui: (_command, runtime) => {
			runtime.ctx.showModelSelector();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "switch",
		icon: "swap",
		description: M.cmdSwitchModelWithSelectors,
		acpDescription: M.cmdSwitchModelSessionOnly,
		acpInputHint: "[model]",
		inlineHint: "[model]",
		allowArgs: true,
		getTuiAutocompleteDescription: runtime => {
			const model = runtime.ctx.session.model;
			return model ? M.acModelFmt.replace("%s", model.provider).replace("%s", model.id) : M.acModelNone;
		},
		handle: async (command, runtime) => {
			const selector = command.args.trim();
			if (!selector) {
				const model = runtime.session.model;
				await runtime.output(
					model ? `Current model: ${model.provider}/${model.id}` : "No model is currently selected.",
				);
				return commandConsumed();
			}
			const resolved = resolveSessionModelSelector(selector, runtime.session, runtime.settings);
			if (!resolved.model) return usage(`Unknown model: ${selector}`, runtime);
			try {
				await runtime.session.setModelTemporary(resolved.model, resolved.thinkingLevel);
				await runtime.output(`Session-only model: ${formatModelString(resolved.model)}.`);
				await runtime.notifyTitleChanged?.();
				await runtime.notifyConfigChanged?.();
				return commandConsumed();
			} catch (err) {
				return usage(`Failed to switch model: ${errorMessage(err)}`, runtime);
			}
		},
		handleTui: async (command, runtime) => {
			runtime.ctx.editor.setText("");
			const selector = command.args.trim();
			if (!selector) {
				runtime.ctx.showModelSelector({ temporaryOnly: true });
				return;
			}
			const resolved = resolveSessionModelSelector(selector, runtime.ctx.session, runtime.ctx.settings);
			if (!resolved.model) {
				runtime.ctx.showError(`Unknown model: ${selector}`);
				return;
			}
			if (resolved.warning) runtime.ctx.showStatus(resolved.warning);
			await runtime.ctx.switchSessionModel(resolved.model, resolved.thinkingLevel);
		},
	},
	{
		name: "fast",
		icon: "fast",
		description: M.cmdFast,
		acpDescription: M.cmdFastAcp,
		acpInputHint: "[on|off|status]",
		subcommands: [
			{ name: "on", description: M.cmdFastOn },
			{ name: "off", description: M.cmdFastOff },
			{ name: "status", description: M.cmdFastStatus },
		],
		allowArgs: true,
		getTuiAutocompleteDescription: runtime =>
			M.acFastFmt.replace("%s", runtime.ctx.session.isFastModeEnabled() ? M.stateOn : M.stateOff),
		handle: async (command, runtime) => {
			const arg = command.args.toLowerCase();
			if (!arg || arg === "toggle") {
				const enabled = runtime.session.toggleFastMode();
				await runtime.output(`Fast mode ${enabled ? "enabled" : "disabled"}.`);
				return commandConsumed();
			}
			if (arg === "on") {
				const supported = runtime.session.setFastMode(true);
				await runtime.output(supported ? "Fast mode enabled." : "Fast mode is unavailable for the current model.");
				return commandConsumed();
			}
			if (arg === "off") {
				runtime.session.setFastMode(false);
				await runtime.output("Fast mode disabled.");
				return commandConsumed();
			}
			if (arg === "status") {
				await runtime.output(`Fast mode is ${formatFastModeStatus(runtime.session)}.`);
				return commandConsumed();
			}
			return usage("Usage: /fast [on|off|status]", runtime);
		},
		handleTui: (command, runtime) => {
			const arg = command.args.trim().toLowerCase();
			if (!arg || arg === "toggle") {
				const enabled = runtime.ctx.session.toggleFastMode();
				refreshStatusLine(runtime.ctx);
				runtime.ctx.showStatus(`Fast mode ${enabled ? "enabled" : "disabled"}.`);
				runtime.ctx.editor.setText("");
				return;
			}
			if (arg === "on") {
				const supported = runtime.ctx.session.setFastMode(true);
				refreshStatusLine(runtime.ctx);
				runtime.ctx.showStatus(
					supported ? "Fast mode enabled." : "Fast mode is unavailable for the current model.",
				);
				runtime.ctx.editor.setText("");
				return;
			}
			if (arg === "off") {
				runtime.ctx.session.setFastMode(false);
				refreshStatusLine(runtime.ctx);
				runtime.ctx.showStatus("Fast mode disabled.");
				runtime.ctx.editor.setText("");
				return;
			}
			if (arg === "status") {
				runtime.ctx.showStatus(`Fast mode is ${formatFastModeStatus(runtime.ctx.session)}.`);
				runtime.ctx.editor.setText("");
				return;
			}
			runtime.ctx.showStatus("Usage: /fast [on|off|status]");
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "skillful",
		icon: "compass",
		description: M.cmdSkillful,
		acpDescription: M.cmdSkillfulAcp,
		acpInputHint: "[on|off|status]",
		subcommands: [
			{ name: "on", description: M.cmdSkillfulOn },
			{ name: "off", description: M.cmdSkillfulOff },
			{ name: "status", description: M.cmdSkillfulStatus },
		],
		allowArgs: true,
		getTuiAutocompleteDescription: runtime =>
			M.acSkillfulFmt.replace("%s", runtime.ctx.session.settings.get("skillful") ? M.stateOn : M.stateOff),
		handle: async (command, runtime) => {
			const arg = command.args.trim().toLowerCase();
			if (arg === "status") {
				await runtime.output(
					`Skill listing: ${runtime.session.settings.get("skillful") ? "on" : "off"} (session override; default from the skillful setting).`,
				);
				return commandConsumed();
			}
			if (!arg || arg === "toggle" || arg === "on" || arg === "off") {
				const enabled =
					arg === "on"
						? await runtime.session.setSkillful(true)
						: arg === "off"
							? await runtime.session.setSkillful(false)
							: await runtime.session.toggleSkillful();
				await runtime.output(`Skill listing ${enabled ? "enabled" : "disabled"} for this session.`);
				return commandConsumed();
			}
			return usage("Usage: /skillful [on|off|status]", runtime);
		},
		handleTui: async (command, runtime) => {
			const arg = command.args.trim().toLowerCase();
			if (arg === "status") {
				runtime.ctx.showStatus(`Skill listing: ${runtime.ctx.session.settings.get("skillful") ? "on" : "off"}.`);
				runtime.ctx.editor.setText("");
				return;
			}
			if (!arg || arg === "toggle" || arg === "on" || arg === "off") {
				const enabled =
					arg === "on"
						? await runtime.ctx.session.setSkillful(true)
						: arg === "off"
							? await runtime.ctx.session.setSkillful(false)
							: await runtime.ctx.session.toggleSkillful();
				runtime.ctx.showStatus(`Skill listing ${enabled ? "enabled" : "disabled"} for this session.`);
				runtime.ctx.editor.setText("");
				return;
			}
			runtime.ctx.showStatus("Usage: /skillful [on|off|status]");
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "extended-context",
		icon: "expand",
		description: M.cmdTogglePremiumLongContextWindows,
		acpDescription: M.cmdToggleExtendedContext,
		acpInputHint: "[on|off|status]",
		subcommands: [
			{ name: "on", description: M.cmdEnablePremiumLongContextWindows },
			{ name: "off", description: M.cmdUseStandardPricingContextWindows },
			{ name: "status", description: M.cmdShowExtendedContextStatus },
		],
		allowArgs: true,
		getTuiAutocompleteDescription: runtime =>
			M.acExtendedContextFmt.replace("%s", runtime.ctx.settings.get("extendedContext") ? M.stateOn : M.stateOff),
		handle: async (command, runtime) => {
			const output = applyExtendedContextCommand(runtime.settings, command.args);
			if (!output) return usage("Usage: /extended-context [on|off|status]", runtime);
			await runtime.output(output);
			return commandConsumed();
		},
		handleTui: (command, runtime) => {
			const output = applyExtendedContextCommand(runtime.ctx.settings, command.args);
			refreshStatusLine(runtime.ctx);
			runtime.ctx.showStatus(output ?? "Usage: /extended-context [on|off|status]");
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "computer",
		icon: "computer",
		description: M.cmdToggleTheNativeComputerUseEvalPreludeForThisSession,
		acpDescription: M.cmdComputerAcp,
		acpInputHint: "[on|off|status]",
		subcommands: [
			{ name: "on", description: M.cmdComputerOn },
			{ name: "off", description: M.cmdComputerOff },
			{ name: "status", description: M.cmdComputerStatus },
		],
		allowArgs: true,
		getTuiAutocompleteDescription: runtime =>
			M.acComputerFmt.replace("%s", runtime.ctx.session.settings.get("computer.enabled") ? M.stateOn : M.stateOff),
		handle: async (command, runtime) => {
			const arg = command.args.trim().toLowerCase();
			if (arg === "status") {
				await runtime.output(formatComputerUseStatus(runtime.session));
				return commandConsumed();
			}
			if (!arg || arg === "toggle" || arg === "on" || arg === "off") {
				const enable = arg === "off" ? false : arg === "on" || !runtime.session.settings.get("computer.enabled");
				await runtime.output(await applyComputerUseToggle(runtime.session, enable));
				return commandConsumed();
			}
			return usage("Usage: /computer [on|off|status]", runtime);
		},
		handleTui: async (command, runtime) => {
			const arg = command.args.trim().toLowerCase();
			if (arg === "status") {
				runtime.ctx.showStatus(formatComputerUseStatus(runtime.ctx.session));
				runtime.ctx.editor.setText("");
				return;
			}
			if (!arg || arg === "toggle" || arg === "on" || arg === "off") {
				const enable =
					arg === "off" ? false : arg === "on" || !runtime.ctx.session.settings.get("computer.enabled");
				runtime.ctx.showStatus(await applyComputerUseToggle(runtime.ctx.session, enable));
				runtime.ctx.editor.setText("");
				return;
			}
			runtime.ctx.showStatus("Usage: /computer [on|off|status]");
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "prewalk",
		icon: "prewalk",
		description: M.cmdPrewalk,
		acpDescription: M.cmdPrewalkAcp,
		handle: async (_command, runtime) => {
			const rolePattern = expandRoleAlias("@smol", runtime.settings);
			const resolved = resolveCliModel({
				cliModel: rolePattern,
				modelRegistry: runtime.session.modelRegistry,
				preferences: getModelMatchPreferences(runtime.settings),
			});
			if (resolved.error || !resolved.model) {
				return usage(resolved.error ?? `Model "${rolePattern}" not found`, runtime);
			}
			if (!runtime.session.modelRegistry.hasConfiguredAuth(resolved.model)) {
				return usage(`No API key for ${resolved.model.provider}/${resolved.model.id}`, runtime);
			}
			const armed = runtime.session.armPrewalk(resolved.model, resolved.thinkingLevel);
			if (armed) {
				await runtime.output(
					`Prewalk on: switching to ${resolved.model.provider}/${resolved.model.id} at the next edit/write (todo-gated).`,
				);
			}
			return commandConsumed();
		},
	},
];
