import type { Model } from "@linxiraos/pi-ai";
import { outRepliesActive } from "../../../internal-urls/out-protocol";
import { cfgJudgmentAttemptTimeoutMs } from "../../../config/model-settings";
import type { ContextWindowTiers } from "../../../config/model-registry";
import type { AnySetting } from "../../../config/registry";
import { cfgSttEnabled, cfgSttLanguage, cfgSttSubmitTrigger } from "../../../stt/settings";
import { cfgBashGitGuard } from "../../../exec/settings";
import { cfgSpeechSpeed, cfgTtsLocalSpeed } from "../../../tts/settings";
import { cfgGcAutoCompress, cfgGcCompress, cfgGcCompressAfterDays } from "../../../cli/gc-settings";
import { cfgSkillsManualSkills, cfgExtensionHandlersModeControl } from "../../../extensibility/settings";
import { cfgHindsightGlobalScope } from "../../../hindsight/settings";
import { cfgTitleRefreshAfterPrompts } from "../../../utils/title-settings";
import {
	cfgBtwInject,
	cfgComposerPredictionAlternatives,
	cfgComposerPredictions,
	cfgDisplayAdvisorCollapsedLines,
	cfgDisplayShellVisualization,
	cfgMagicKeyword,
	cfgMagicKeywordsEnabled,
	cfgRecapEnabled,
	cfgRecapIdleSeconds,
} from "../../../modes/settings";
import {
	cfgTaskAgentAccountPools,
	cfgOvnfsPath,
	cfgTaskPerCallModel,
	cfgTaskPerCallModelAllow,
	cfgTaskStructured,
	cfgTaskWorkerThreads,
	cfgWorktreeOnExit,
	cfgWorktreeOnStart,
} from "../../../task/settings";
import {
	cfgCompactionIdleEnabled,
	cfgCompactionIdleThresholdTokens,
	cfgCompactionIdleTimeoutSeconds,
	cfgCompactionModelThresholds,
	cfgContextFilesExtra,
} from "../../../session/context-settings";
import {
	cfgPrewalkAuto,
	cfgPrewalkAutoTarget,
	cfgPrewalkFrom,
	cfgPrewalkInto,
	cfgProvidersOpenaiCodexDaybreak,
	cfgProvidersOpenaiResponsesWebsockets,
	cfgRetryFallbackOn,
	cfgRetryRateLimitWalksChain,
	cfgSessionWorktreeScope,
} from "../../../session/settings";
import {
	cfgAsyncWidgets,
	cfgComputerBackgroundFallback,
	cfgComputerDisplay,
	cfgComputerEnabled,
	cfgComputerMaxHeight,
	cfgComputerMaxWidth,
	cfgOutEnabled,
	cfgToolsRestrictedFolders,
	cfgToolsXdevNotices,
} from "../../../tools/settings";
import {
	cfgSpotlightExperimentEnabled,
	cfgSpotlightExperimentHoldout,
	cfgSpotlightExperimentScoreFree,
	cfgSpotlightExperimentTools,
	cfgSpotlightModel,
	cfgSpotlightThinking,
	cfgSpotlightTimeoutMs,
	cfgSpotlightUrl,
} from "../../../spotlight/settings";
import {
	planModelCompactionPoint,
	previewModelCompactionPoint,
	setModelCompactionPoint,
	type ModelCompactionPointUpdate,
} from "../../../session/model-compaction-threshold";
import { computerPreludeAvailableForOwner } from "../../../tools/computer/supervisor";
import type { AgentSession } from "../../../session/agent-session";
import {
	FEATURE_SETTING_KEYS,
	type CompactionPreview,
	type FeatureSettingKey,
	type FeatureSettingRow,
	type FeatureSettingsOperation,
	type FeatureSettingsResultMap,
} from "../protocol/contracts/feature-settings.js";
import { StudioOpError, invalid, unavailable } from "../errors.js";

/**
 * Native handles for the additive feature settings surface. `task.file` exists
 * in the official key list but has no handle in Runtime 18.20.0; it stays out
 * of this map so the operation boundary can answer CAPABILITY_UNAVAILABLE
 * instead of inventing a default.
 */
const HANDLES: Record<FeatureSettingKey, AnySetting> = {
	"magicKeywords.enabled": cfgMagicKeywordsEnabled,
	"magicKeywords.chillax": cfgMagicKeyword.chillax,
	"out.enabled": cfgOutEnabled,
	"btw.inject": cfgBtwInject,
	"composer.predictionAlternatives": cfgComposerPredictionAlternatives,
	"display.shellVisualization": cfgDisplayShellVisualization,
	"title.refreshAfterPrompts": cfgTitleRefreshAfterPrompts,
	"display.advisorCollapsedLines": cfgDisplayAdvisorCollapsedLines,
	"task.perCallModel": cfgTaskPerCallModel,
	"task.perCallModelAllow": cfgTaskPerCallModelAllow,
	"task.workerThreads": cfgTaskWorkerThreads,
	"ovnfs.path": cfgOvnfsPath,
	"prewalk.from": cfgPrewalkFrom,
	"prewalk.into": cfgPrewalkInto,
	"retry.rateLimitWalksChain": cfgRetryRateLimitWalksChain,
	"providers.openaiResponsesWebsockets": cfgProvidersOpenaiResponsesWebsockets,
	"providers.openai-codex.daybreak": cfgProvidersOpenaiCodexDaybreak,
	"judgment.attemptTimeoutMs": cfgJudgmentAttemptTimeoutMs,
	"skills.manualSkills": cfgSkillsManualSkills,
	"hindsight.globalScope": cfgHindsightGlobalScope,
	"tools.xdevNotices": cfgToolsXdevNotices,
	"spotlight.experiment.enabled": cfgSpotlightExperimentEnabled,
	"spotlight.url": cfgSpotlightUrl,
	"spotlight.model": cfgSpotlightModel,
	"spotlight.thinking": cfgSpotlightThinking,
	"spotlight.timeoutMs": cfgSpotlightTimeoutMs,
	"spotlight.experiment.holdout": cfgSpotlightExperimentHoldout,
	"spotlight.experiment.scoreFree": cfgSpotlightExperimentScoreFree,
	"spotlight.experiment.tools": cfgSpotlightExperimentTools,

	"task.agentAccountPools": cfgTaskAgentAccountPools,
	"compaction.modelThresholds": cfgCompactionModelThresholds,
	"retry.fallbackOn": cfgRetryFallbackOn,
	"contextFiles.extra": cfgContextFilesExtra,
	"task.structured": cfgTaskStructured,
	"bash.gitGuard": cfgBashGitGuard,
	"worktree.onStart": cfgWorktreeOnStart,
	"worktree.onExit": cfgWorktreeOnExit,
	"composer.predictions": cfgComposerPredictions,
	"speech.speed": cfgSpeechSpeed,
	"tts.localSpeed": cfgTtsLocalSpeed,
	"gc.compress": cfgGcCompress,
	"gc.compressAfterDays": cfgGcCompressAfterDays,
	"prewalk.auto": cfgPrewalkAuto,
	"prewalk.autoTarget": cfgPrewalkAutoTarget,
	"async.widgets": cfgAsyncWidgets,
	"computer.enabled": cfgComputerEnabled,
	"computer.display": cfgComputerDisplay,
	"computer.maxWidth": cfgComputerMaxWidth,
	"computer.maxHeight": cfgComputerMaxHeight,
	"computer.backgroundFallback": cfgComputerBackgroundFallback,
	"tools.restrictedFolders": cfgToolsRestrictedFolders,
	"extensionHandlers.modeControl": cfgExtensionHandlersModeControl,
	"recap.enabled": cfgRecapEnabled,
	"recap.idleSeconds": cfgRecapIdleSeconds,
	"compaction.idleEnabled": cfgCompactionIdleEnabled,
	"compaction.idleThresholdTokens": cfgCompactionIdleThresholdTokens,
	"compaction.idleTimeoutSeconds": cfgCompactionIdleTimeoutSeconds,
	"gc.autoCompress": cfgGcAutoCompress,
	"session.worktreeScope": cfgSessionWorktreeScope,
	"stt.enabled": cfgSttEnabled,
	"stt.language": cfgSttLanguage,
	"stt.submitTrigger": cfgSttSubmitTrigger,
};

type PreferencesGet = Extract<FeatureSettingsOperation, { kind: "preferences.features.get" }>;
type PreferencesSet = Extract<FeatureSettingsOperation, { kind: "preferences.features.set" }>;
type PreferencesClear = Extract<FeatureSettingsOperation, { kind: "preferences.features.clearOverride" }>;
type CompactionPreviewOperation = Extract<FeatureSettingsOperation, { kind: "models.compaction.preview" }>;
type CompactionSetOperation = Extract<FeatureSettingsOperation, { kind: "models.compaction.set" }>;
/** The part of {@link FeatureSettingsOperation} this service owns; accounts and session compaction have other owners. */
export type StudioFeaturePreferencesOperation =
	| PreferencesGet
	| PreferencesSet
	| PreferencesClear
	| CompactionPreviewOperation
	| CompactionSetOperation;

/**
 * Native feature-settings reads and writes for one resident session.
 *
 * Every write goes through the registered `AnySetting` handle so its own
 * validation, normalisation and write precedence stay authoritative; this
 * service never edits settings layers directly. `compaction.modelThresholds`
 * is refused because only `setModelCompactionPoint` may validate and persist
 * an entry against the selected model's windows and pricing.
 */
export class StudioFeatureSettingsService {
	constructor(readonly session: AgentSession) {}

	async execute<K extends StudioFeaturePreferencesOperation["kind"]>(
		operation: Extract<StudioFeaturePreferencesOperation, { kind: K }>,
	): Promise<FeatureSettingsResultMap[K]>;
	async execute(
		operation: StudioFeaturePreferencesOperation,
	): Promise<
		| FeatureSettingsResultMap["preferences.features.get"]
		| FeatureSettingsResultMap["preferences.features.set"]
		| FeatureSettingsResultMap["preferences.features.clearOverride"]
		| FeatureSettingsResultMap["models.compaction.preview"]
		| FeatureSettingsResultMap["models.compaction.set"]
	> {
		this.#assertSession(operation.sessionId);
		if (operation.kind === "preferences.features.get") return this.#list();
		if (operation.kind === "preferences.features.clearOverride") return this.#clear(operation.key);
		if (operation.kind === "models.compaction.preview")
			return this.#previewCompaction(operation.selector, operation.input);
		if (operation.kind === "models.compaction.set")
			return this.#setCompaction(operation.selector, operation.input, operation.confirmed);
		return this.#set(operation.key, operation.value, operation.scope);
	}

	#assertSession(sessionId: string): void {
		if (sessionId !== this.session.sessionId) throw unavailable("Settings session changed");
		if (this.session.isDisposed) throw unavailable("The settings session is no longer live");
	}

	#row(key: FeatureSettingKey): FeatureSettingRow {
		const setting = HANDLES[key];
		if (setting.isCredential)
			throw new StudioOpError("CAPABILITY_UNAVAILABLE", "Credentials are not part of feature settings");
		const value =
			key === "out.enabled"
				? outRepliesActive(this.session.settings, this.session.getEvalToolSession()?.tuiTranscript === true)
				: structuredClone(setting.get(this.session.settings) ?? null);
		return {
			key,
			value: value as FeatureSettingRow["value"],
			source: this.session.settings.getProvenance(setting),
		};
	}

	#list(): { settings: FeatureSettingRow[] } {
		// A credential handle never enters the list, even if a future key aliases one.
		return { settings: FEATURE_SETTING_KEYS.filter(key => !HANDLES[key].isCredential).map(key => this.#row(key)) };
	}

	#assertWritable(setting: AnySetting, value: unknown): void {
		try {
			setting.assertWritable(value);
		} catch (error) {
			throw invalid(error instanceof Error ? error.message : "Invalid setting value");
		}
	}

	async #set(key: FeatureSettingKey, value: unknown, scope: "session" | "global"): Promise<FeatureSettingRow> {
		if (key === "compaction.modelThresholds")
			throw new StudioOpError(
				"CAPABILITY_UNAVAILABLE",
				"Use the model compaction editor to validate window and pricing changes",
			);
		const setting = HANDLES[key];
		if (setting.isCredential)
			throw new StudioOpError("CAPABILITY_UNAVAILABLE", "Credentials are not part of feature settings");
		if (key === "computer.enabled" && value === true) {
			const available =
				this.session.getEvalToolSession()?.computerPreludeAvailable?.() === true ||
				this.session.getEvalPreludes().some(prelude => prelude.name === "computer") ||
				computerPreludeAvailableForOwner(this.session.getEvalKernelOwnerId());
			if (!available)
				throw new StudioOpError("CAPABILITY_UNAVAILABLE", "Native Computer Eval prelude is unavailable");
		}
		if (
			(key === "computer.maxWidth" || key === "computer.maxHeight") &&
			(!Number.isInteger(value) || (value as number) < 1 || (value as number) > 16384)
		)
			throw invalid("Computer image dimensions must be integers from 1 to 16384");
		if (key === "computer.display" && (typeof value !== "string" || !value.trim() || value.length > 512))
			throw invalid("A native display id, active, or all is required");
		this.#assertWritable(setting, value);
		this.#assertSession(this.session.sessionId);
		if (scope === "session") setting.override(this.session.settings, value);
		else {
			setting.set(this.session.settings, value);
			await this.session.settings.flush();
		}
		this.#assertSession(this.session.sessionId);
		this.session.refreshIdleMaintenance?.();
		return this.#row(key);
	}

	async #clear(key: FeatureSettingKey): Promise<FeatureSettingRow> {
		if (key === "compaction.modelThresholds")
			throw new StudioOpError(
				"CAPABILITY_UNAVAILABLE",
				"Use the model compaction editor to validate window and pricing changes",
			);
		const setting = HANDLES[key];
		if (setting.isCredential)
			throw new StudioOpError("CAPABILITY_UNAVAILABLE", "Credentials are not part of feature settings");
		this.#assertSession(this.session.sessionId);
		setting.clearOverride(this.session.settings);
		// A disabled Computer setting is stopped by the existing workspace owner's
		// native cfgComputerEnabled listener; this path never attaches or starts one.
		this.#assertSession(this.session.sessionId);
		this.session.refreshIdleMaintenance?.();
		return this.#row(key);
	}

	#compactionModel(selector: string): { model: Model; tiers: ContextWindowTiers | undefined } {
		const slash = selector.indexOf("/");
		const registry = this.session.modelRegistry;
		const model = slash > 0 ? registry.find(selector.slice(0, slash), selector.slice(slash + 1)) : undefined;
		if (!model) throw invalid("Model is no longer available");
		return { model, tiers: registry.contextWindowTiers(model) };
	}

	#previewCompaction(selector: string, input: string): CompactionPreview {
		this.#assertSession(this.session.sessionId);
		const { model, tiers } = this.#compactionModel(selector);
		const plan = planModelCompactionPoint(this.session.settings, model, input, tiers);
		const summary = previewModelCompactionPoint(this.session.settings, model, input, tiers);
		return {
			valid: plan !== undefined,
			...(summary ? { summary } : {}),
			...(plan?.window === undefined ? {} : { window: plan.window }),
			...(plan?.trigger ? { trigger: plan.trigger.tokens } : {}),
			extended: !!(tiers && plan?.window && plan.window > tiers.standard),
		};
	}

	async #setCompaction(
		selector: string,
		input: string,
		confirmed: boolean | undefined,
	): Promise<{ saved: boolean; confirmationRequired: boolean; summary: string }> {
		this.#assertSession(this.session.sessionId);
		const { model, tiers } = this.#compactionModel(selector);
		let update: ModelCompactionPointUpdate;
		try {
			update = setModelCompactionPoint(this.session.settings, model, input, { tiers, confirmed });
		} catch (error) {
			throw invalid(error instanceof Error ? error.message : "Invalid compaction limit");
		}
		if (update.kind === "confirm") return { saved: false, confirmationRequired: true, summary: update.message };
		await this.session.settings.flush();
		await this.session.modelRegistry.reapplyModelPolicies();
		this.#assertSession(this.session.sessionId);
		this.session.refreshIdleMaintenance?.();
		return { saved: true, confirmationRequired: false, summary: update.summary ?? update.described };
	}
}
