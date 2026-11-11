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
import { settingsOps } from "./settings.js";
import { skillsOps } from "./skills.js";
import { teamOps } from "./team.js";
import { usageOps } from "./usage.js";
import { workspaceOps } from "./workspace.js";

export const STUDIO_FAMILIES: readonly StudioFamily[] = [
	sessionOps,
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
	runtimeOps,
];
