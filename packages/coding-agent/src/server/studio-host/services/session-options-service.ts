import { realizesPriorityServiceTier, serviceTierFamily, shouldSendServiceTier } from "@linxiraos/pi-ai";
import {
	applyModelPreset,
	deleteModelPreset,
	findActiveModelPreset,
	getModelPreset,
	getModelPresetNames,
	modelPresetShadowOwner,
	saveModelPreset,
} from "../../../config/model-presets.js";
import type { AgentSession } from "../../../session/agent-session.js";
import {
	cfgProvidersAnthropicSlowMode,
	cfgProvidersCacheWarming,
	cfgSessionMaxCost,
	cfgSessionWarnCost,
} from "../../../session/settings.js";
import { StudioOpError } from "../errors.js";
import type {
	ModelPresetResult,
	ModelPresetRow,
	SessionBudgetState,
	SessionOptionsOperation,
	SessionSpeedState,
	SessionWarmingState,
	StudioSpeed,
} from "../protocol/contracts/session-options.js";
import type { RuntimeSkillIdentity, SessionTier, SessionTierState } from "../protocol/contracts/session-gui.js";

function blocked(message: string): StudioOpError {
	return new StudioOpError("UNAVAILABLE", message);
}

/**
 * Thin adapters over native session controls and settings; no provider
 * execution, no attach/start. Every mutating operation refuses when the model
 * or session identity moved between the read and the write.
 */
export class StudioSessionOptionsService {
	constructor(readonly session: AgentSession) {}

	speed(): SessionSpeedState {
		const session = this.session;
		const model = session.model;
		const supported: StudioSpeed[] = ["normal"];
		if (model && serviceTierFamily(model) && realizesPriorityServiceTier("priority", model)) supported.push("fast");
		if (model && serviceTierFamily(model) === "openai" && shouldSendServiceTier("ultrafast", model))
			supported.push("ultrafast");
		if (
			session.isSlowModeSupported() &&
			model &&
			(serviceTierFamily(model) === "anthropic" || shouldSendServiceTier("flex", model))
		)
			supported.push("slow");
		const effectiveTier = model ? session.effectiveServiceTier(model) : undefined;
		const slowEnabled = session.isSlowModeEnabled();
		const slowScope = session.getSlowModeScope();
		const usageLimit = session.getUsageLimitState();
		return {
			model: model ? `${model.provider}/${model.id}` : null,
			selected: session.isUltrafastModeEnabled()
				? "ultrafast"
				: session.isFastModeEnabled()
					? "fast"
					: slowEnabled
						? "slow"
						: "normal",
			supported,
			fastActive: session.isFastModeActive(),
			slowEnabled,
			...(effectiveTier ? { effectiveTier } : {}),
			...(slowScope ? { slowScope } : {}),
			...(usageLimit ? { usageLimit: { ...usageLimit } } : {}),
		};
	}

	warming(): SessionWarmingState {
		const status = this.session.cacheWarmingStatus;
		return {
			mode: cfgProvidersCacheWarming.get(this.session.settings),
			source: cfgProvidersCacheWarming.provenance(this.session.settings),
			state: status?.state ?? "unavailable",
			...(status?.reason ? { reason: status.reason } : {}),
			...(status?.nextWarmAt === undefined ? {} : { nextWarmAt: status.nextWarmAt }),
			...(status?.decision ? { decision: { ...status.decision } } : {}),
		};
	}

	budget(): SessionBudgetState {
		const settings = this.session.settings;
		return {
			treeSpent: this.session.costGate?.spent ?? this.session.getSessionStats().cost,
			warnCost: cfgSessionWarnCost.get(settings) ?? null,
			maxCost: cfgSessionMaxCost.get(settings) ?? null,
			limitReached: this.session.costGate?.check() !== undefined,
			warnSource: cfgSessionWarnCost.provenance(settings),
			maxSource: cfgSessionMaxCost.provenance(settings),
		};
	}

	async execute(operation: SessionOptionsOperation): Promise<unknown> {
		const session = this.session;
		const settings = session.settings;
		if (operation.sessionId !== session.sessionId) throw blocked("The active session changed; reload its controls");
		if (operation.kind === "session.budget.get") return this.budget();
		if (operation.kind === "session.budget.clearOverride") {
			cfgSessionWarnCost.clearOverride(settings);
			cfgSessionMaxCost.clearOverride(settings);
			return this.budget();
		}
		if (operation.kind === "session.budget.set") {
			if (operation.scope !== "session" && operation.scope !== "global")
				throw new StudioOpError("INVALID_ARGUMENT", "Choose a session or user budget scope");
			for (const value of [operation.warnCost, operation.maxCost]) {
				if (value !== null && (typeof value !== "number" || !Number.isFinite(value) || value <= 0)) {
					throw new StudioOpError("INVALID_ARGUMENT", "Cost thresholds must be positive USD amounts or unset");
				}
			}
			if (operation.scope === "global") {
				cfgSessionWarnCost.set(settings, operation.warnCost ?? undefined);
				cfgSessionMaxCost.set(settings, operation.maxCost ?? undefined);
				cfgSessionWarnCost.clearOverride(settings);
				cfgSessionMaxCost.clearOverride(settings);
				await settings.flush();
				if (operation.sessionId !== session.sessionId) throw blocked("The session changed during the budget save");
			} else {
				// null masks an inherited threshold for this session; undefined would merely clear the override.
				settings.writeValue(cfgSessionWarnCost, operation.warnCost, "override");
				settings.writeValue(cfgSessionMaxCost, operation.maxCost, "override");
			}
			return this.budget();
		}
		if (operation.kind === "session.speed.get") return this.speed();
		if (operation.kind === "session.warming.get") return this.warming();
		if (operation.kind === "session.speed.set") {
			const state = this.speed();
			if (operation.expectedModel !== state.model) throw blocked("The model changed; reload its speed options");
			if (!state.supported.includes(operation.speed)) throw blocked("This model does not offer the selected speed");
			if (operation.speed === "slow") {
				if (state.supported.includes("fast")) session.setFastMode(false);
				session.setSlowMode(true);
			} else {
				if (state.slowEnabled) session.setSlowMode(false);
				if (operation.speed === "ultrafast") session.setUltrafastMode(true);
				else if (operation.speed === "fast") session.setFastMode(true);
				else {
					const family = session.model ? serviceTierFamily(session.model) : undefined;
					if (family) session.setServiceTierFamily(family, undefined);
				}
			}
			if (state.slowScope === "global" && (operation.speed === "slow" || state.slowEnabled)) {
				await settings.flush();
				if (operation.sessionId !== session.sessionId) throw blocked("The session changed during the speed save");
			}
			return this.speed();
		}
		if (operation.kind === "session.warming.set") {
			if (operation.persist) {
				cfgProvidersCacheWarming.clearOverride(settings);
				cfgProvidersCacheWarming.set(settings, operation.mode);
				await settings.flush();
				if (operation.sessionId !== session.sessionId) throw blocked("The session changed during the warming save");
			} else cfgProvidersCacheWarming.override(settings, operation.mode);
			return this.warming();
		}
		if (operation.kind === "models.presets.list") {
			const active = findActiveModelPreset(settings);
			const presets: ModelPresetRow[] = getModelPresetNames(settings)
				.slice(0, 200)
				.map(name => {
					const lookup = getModelPreset(settings, name);
					return {
						name,
						source: settings.getOwnedModelPreset(name)?.source ?? "default",
						active: name === active,
						roles: lookup.kind === "found" ? lookup.preset.modelRoles : {},
						...(lookup.kind === "found" && lookup.preset.defaultThinkingLevel
							? { thinking: lookup.preset.defaultThinkingLevel }
							: {}),
						...(lookup.kind === "invalid" ? { error: lookup.reason } : {}),
					};
				});
			return { presets };
		}
		if (session.isStreaming || session.isCompacting)
			throw blocked("Wait for the current turn before changing model presets");
		if (operation.kind === "models.presets.save") {
			saveModelPreset(settings, operation.name);
			await settings.flush();
			if (operation.sessionId !== session.sessionId) throw blocked("The session changed during the preset save");
			const shadowOwner = modelPresetShadowOwner(settings, operation.name);
			return { outcome: "saved", ...(shadowOwner ? { shadowOwner } : {}) } satisfies ModelPresetResult;
		}
		if (operation.kind === "models.presets.delete") {
			const outcome = deleteModelPreset(settings, operation.name);
			await settings.flush();
			if (operation.sessionId !== session.sessionId) throw blocked("The session changed during the preset delete");
			return { outcome } satisfies ModelPresetResult;
		}
		const result = await applyModelPreset(settings, session, operation.name);
		await settings.flush();
		if (operation.sessionId !== session.sessionId) throw blocked("The session changed during the preset switch");
		if (result.kind === "switched")
			return {
				outcome: result.kind,
				model: `${result.model.provider}/${result.model.id}`,
				...(result.thinkingLevel ? { thinking: result.thinkingLevel } : {}),
				shadowed: result.shadowed,
				...(result.shadowedThinking ? { shadowedThinking: result.shadowedThinking } : {}),
			} satisfies ModelPresetResult;
		return {
			outcome: result.kind,
			...("reason" in result ? { reason: result.reason } : {}),
			...("shadowed" in result ? { shadowed: result.shadowed } : {}),
		} satisfies ModelPresetResult;
	}
}

/**
 * Service-tier and skill reads of the live session, ported from the official
 * session GUI service. Queue handling stays in `runtime-view-service.ts`.
 */
export class StudioSessionTierService {
	constructor(readonly session: AgentSession) {}

	tier(): SessionTierState {
		const model = this.session.model;
		const family = model ? serviceTierFamily(model) : undefined;
		const configured = family ? (this.session.serviceTierByFamily[family] ?? "none") : "none";
		const available = {
			standard: !!model,
			slow: !!model && (model.provider === "anthropic" || (!!family && shouldSendServiceTier("flex", model))),
			priority: !!model && realizesPriorityServiceTier("priority", model),
			ultrafast: !!model && family === "openai" && shouldSendServiceTier("ultrafast", model),
		};
		const effective: SessionTier =
			this.session.isSlowModeEnabled() && available.slow
				? "slow"
				: configured === "ultrafast" && available.ultrafast
					? "ultrafast"
					: configured === "priority" && available.priority && this.session.isFastModeActive()
						? "priority"
						: "standard";
		const usageStatus = this.session.getAnthropicSlowModeLabel();
		return {
			selector: model ? `${model.provider}/${model.id}` : "",
			configured,
			effective,
			choices: (["standard", "slow", "priority", "ultrafast"] as const).map(id => ({
				id,
				available: available[id],
				...(!available[id] ? { reason: "Not supported by the current model" } : {}),
			})),
			...(usageStatus ? { usageStatus } : {}),
		};
	}

	setTier(selector: string, tier: SessionTier): SessionTierState {
		const state = this.tier();
		if (state.selector !== selector || !state.choices.find(choice => choice.id === tier)?.available)
			throw blocked("The model changed or the service tier is unavailable");
		const model = this.session.model;
		if (!model) throw blocked("The session has no model");
		const family = serviceTierFamily(model);
		// Native Anthropic slow mode writes a config handle: override only the session layer first.
		if (model.provider === "anthropic")
			cfgProvidersAnthropicSlowMode.override(this.session.settings, tier === "slow" ? "auto" : "off");
		if (family) {
			this.session.setServiceTierFamily(
				family,
				tier === "slow" && family !== "anthropic"
					? "flex"
					: tier === "priority"
						? "priority"
						: tier === "ultrafast"
							? "ultrafast"
							: undefined,
			);
		}
		if (model.provider === "anthropic") {
			const lane = this.session.getAnthropicSlowModeLane();
			if (tier === "slow") lane?.accept();
			else lane?.stop("user");
		}
		return this.tier();
	}

	skills(): { skills: RuntimeSkillIdentity[]; warnings: string[] } {
		return {
			skills: this.session.skills.map(skill => ({
				id: skill.name,
				name: skill.name,
				description: skill.description,
				source: skill.source,
				scope:
					skill._source?.level === "user"
						? "global"
						: skill._source?.level === "project"
							? "workspace"
							: skill._source?.level === "native"
								? "builtin"
								: "runtime",
				...(skill.name.includes("/") ? { namespace: skill.name.split("/")[0] } : {}),
				conflict: /~\d+$/.test(skill.name),
			})),
			warnings: [],
		};
	}
}
