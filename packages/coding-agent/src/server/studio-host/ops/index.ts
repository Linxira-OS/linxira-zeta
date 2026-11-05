/**
 * Studio operation families, in the order the capability manifest lists them.
 *
 * One file per domain. A family owns only its own operations: adding a handler
 * here is what makes a Studio surface reachable, and removing one hides it.
 */
import type { StudioFamily } from "../registry.js";
import { filesOps } from "./files.js";
import { gitOps } from "./git.js";
import { modelsOps } from "./models.js";
import { planOps } from "./plan.js";
import { sessionOps } from "./session.js";
import { settingsOps } from "./settings.js";
import { skillsOps } from "./skills.js";
import { usageOps } from "./usage.js";
import { workspaceOps } from "./workspace.js";

export const STUDIO_FAMILIES: readonly StudioFamily[] = [
	sessionOps,
	modelsOps,
	gitOps,
	skillsOps,
	planOps,
	workspaceOps,
	filesOps,
	usageOps,
	settingsOps,
];
