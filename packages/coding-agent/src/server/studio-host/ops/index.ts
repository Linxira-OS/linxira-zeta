/**
 * Studio operation families, in the order the capability manifest lists them.
 *
 * One file per domain. A family owns only its own operations: adding a handler
 * here is what makes a Studio surface reachable, and removing one hides it.
 */
import type { StudioFamily } from "../registry.js";
import { agentsOps } from "./agents.js";
import { dictationOps } from "./dictation.js";
import { filesOps } from "./files.js";
import { gitOps } from "./git.js";
import { modelsOps } from "./models.js";
import { operatorOps } from "./operator.js";
import { planOps } from "./plan.js";
import { pluginHostOps } from "./plugin-host.js";
import { roomsOps } from "./rooms.js";
import { runtimeOps } from "./runtime.js";
import { sessionOps } from "./session.js";
import { sessionUtilitiesOps } from "./session-utilities.js";
import { settingsOps } from "./settings.js";
import { skillsOps } from "./skills.js";
import { teamOps } from "./team.js";
import { usageOps } from "./usage.js";
import { workspaceOps } from "./workspace.js";
import { browserOps } from "./browser.js";
import { evaluationsOps } from "./evaluations.js";
import { timeTravelOps } from "./time-travel.js";
import { computerOps } from "./computer.js";
import { servicesOps } from "./services.js";
import { predictionOps } from "./prediction";
import { accountsOps } from "./accounts.js";
import { agentDetailsOps } from "./agent-details.js";
import { worktreesOps } from "./worktrees.js";
import { idaOps } from "./ida.js";
import { annotationsOps } from "./annotations.js";
import { compactionOps } from "./compaction.js";
import { featureSettingsOps } from "./feature-settings.js";
import { mediaOps } from "./media.js";
import { historyUtilitiesOps } from "./history-utilities.js";
import { historyMetadataOps } from "./history-metadata.js";
import { btwImagesOps } from "./btw-images.js";

export const STUDIO_FAMILIES: readonly StudioFamily[] = [
	sessionOps,
	sessionUtilitiesOps,
	operatorOps,
	modelsOps,
	agentsOps,
	roomsOps,
	teamOps,
	dictationOps,
	gitOps,
	skillsOps,
	pluginHostOps,
	planOps,
	workspaceOps,
	filesOps,
	usageOps,
	settingsOps,
	featureSettingsOps,
	runtimeOps,
	browserOps,
	evaluationsOps,
	timeTravelOps,
	computerOps,
	servicesOps,
	predictionOps,
	accountsOps,
	agentDetailsOps,
	worktreesOps,
	idaOps,
	annotationsOps,
	compactionOps,
	mediaOps,
	historyUtilitiesOps,
	historyMetadataOps,
	btwImagesOps,
];
