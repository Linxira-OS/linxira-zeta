/**
 * The goal objective an approved plan executes under.
 *
 * Approving a plan starts a goal-directed execution round (goal context plus
 * continuation), and goal mode needs a non-empty objective. The statement of
 * intent is taken from the strongest available source, in order:
 *
 * 1. the task the operator stated when entering plan mode (`/plan <task>`,
 *    `/plan-ultra <task>`), carried on `PlanModeState.objective`;
 * 2. the plan's own first heading — what the agent decided the plan is about;
 * 3. the plan title supplied with the proposal;
 * 4. the plan's first content line.
 *
 * The winner is flattened to one line and clamped: the value is rendered into
 * the goal-mode context and the continuation prompt, so a pasted task must not
 * turn either into a wall of text. `undefined` means nothing usable was found —
 * the approval path then runs the plan without a goal.
 */

/** Longest objective carried into goal mode; longer text is ellipsized. */
export const PLAN_GOAL_OBJECTIVE_MAX_LENGTH = 200;

export interface PlanGoalObjectiveInput {
	/** Task stated at plan-mode entry, when the operator supplied one. */
	statedTask?: string | null;
	/** Rendered content of the approved plan. */
	planContent: string;
	/** Title the agent supplied with the plan proposal, when any. */
	title?: string | null;
}

/**
 * Flatten a task statement into a storable objective: one line, clamped, or
 * `undefined` when nothing survives. Used at plan-mode entry so the persisted
 * plan state (and every `get_state`/`mode_changed` payload) never carries a
 * raw multi-line paste.
 */
export function normalizeGoalObjective(value: string | null | undefined): string | undefined {
	const collapsed = collapse(value);
	return collapsed ? clampObjective(collapsed) : undefined;
}

export function derivePlanGoalObjective(input: PlanGoalObjectiveInput): string | undefined {
	const stated = normalizeGoalObjective(input.statedTask);
	if (stated) return stated;
	const lines = proseLines(input.planContent);
	const heading = lines.find(line => /^#{1,6}\s+\S/.test(line));
	if (heading) {
		const text = plainText(heading.replace(/^#{1,6}\s+/, "").replace(/\s+#+\s*$/, ""));
		if (text) return clampObjective(text);
	}
	const title = plainText(collapse(input.title));
	if (title) return clampObjective(title);
	for (const line of lines) {
		if (!line || /^([-*_])\1{2,}$/.test(line) || line.startsWith("|")) continue;
		const text = plainText(line.replace(/^(?:[-*+]|\d+[.)])\s+/, ""));
		if (text) return clampObjective(text);
	}
	return undefined;
}

/** Lines of the plan outside fenced code blocks, trimmed. */
function proseLines(planContent: string): string[] {
	const lines: string[] = [];
	let fenced = false;
	for (const raw of planContent.split(/\r?\n/)) {
		const line = raw.trim();
		if (/^(?:```|~~~)/.test(line)) {
			fenced = !fenced;
			continue;
		}
		if (fenced) continue;
		lines.push(line);
	}
	return lines;
}

/** Drop the markdown emphasis/code wrappers that would read as noise in a prompt. */
function plainText(value: string | undefined): string | undefined {
	if (!value) return undefined;
	return collapse(
		value
			.replace(/`([^`]*)`/g, "$1")
			.replace(/\*\*([^*]+)\*\*/g, "$1")
			.replace(/\*([^*]+)\*/g, "$1")
			.replace(/__([^_]+)__/g, "$1")
			.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1"),
	);
}

/** Single-line, trimmed; `undefined` when nothing survives. */
function collapse(value: string | null | undefined): string | undefined {
	const collapsed = value?.replace(/\s+/g, " ").trim();
	return collapsed ? collapsed : undefined;
}

function clampObjective(value: string): string {
	if (value.length <= PLAN_GOAL_OBJECTIVE_MAX_LENGTH) return value;
	return `${value.slice(0, PLAN_GOAL_OBJECTIVE_MAX_LENGTH - 1).trimEnd()}…`;
}
