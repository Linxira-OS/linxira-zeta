/**
 * Plan-depth counting for the ultra workflow's per-turn check.
 *
 * The prompt (`plan-mode-ultra-active.md`) states the *quality* bar — granularity,
 * horizon, boundaries, end state — and never a number. This module is the
 * mechanism side of that bar: it counts what the plan actually contains so the
 * harness can nudge with real numbers, and it owns the floor so the prompt stays
 * free of quotas.
 *
 * Everything here is a conservative approximation. A step counts as "generic"
 * only when it both reads as a vague action (`update`/`handle`/`improve` …) and
 * names no concrete target in any spelling we recognise; anything unrecognised
 * counts as concrete, so a good plan is never nagged and false positives are
 * preferred over false negatives.
 */

/** What a plan's Approach section currently contains, and where its floor sits. */
export interface PlanDepth {
	/** List items at the Approach section's outermost level. */
	stepCount: number;
	/** Steps that read as a vague action naming no concrete target. */
	genericStepCount: number;
	/** Approach steps this plan must reach (see the floor constants below). */
	stepFloor: number;
	/** True once the plan is deep enough that the per-turn check stops rendering. */
	meetsFloor: boolean;
}

/**
 * Approach-step floor for a plan confined to a single surface. Kept low on
 * purpose: the prompt already asks for depth, and the real trigger for another
 * round is a *generic* step, not a step count.
 */
export const PLAN_DEPTH_SINGLE_SURFACE_MIN_STEPS = 2;

/**
 * Approach-step floor for a plan large enough to be cross-cutting (see
 * {@link PLAN_DEPTH_CROSS_CUTTING_LINES}). A change that touches several areas
 * has to land more steps before the per-turn check stops asking for more.
 */
export const PLAN_DEPTH_CROSS_CUTTING_MIN_STEPS = 6;

/** Plan length that marks it as cross-cutting rather than single-surface. */
export const PLAN_DEPTH_CROSS_CUTTING_LINES = 40;

/**
 * Verbs that open a vague step — `update`/`handle`/`improve`/`refactor` an area
 * rather than state an edit with a target and a new behaviour.
 */
const VAGUE_STEP_VERB =
	/^(?:address|adjust|clean\s?up|deal\s+with|enhance|fix\s+up|generalize|handle|improve|iterate\s+on|maintain|modernize|optimize|polish|refactor|revisit|rework|review|streamline|support|tidy|touch\s+up|tweak|update|work\s+on)\b/i;

/**
 * Any one of these marks a step as naming something concrete. Deliberately
 * generous across domains (a name, a quote, a number, a label, a heading, a
 * dotted path) so the classifier under-reports generic steps.
 */
const CONCRETE_TARGET_SIGNALS: readonly RegExp[] = [
	/`[^`]+`/, // a name in a code/quoted span
	/["'“”‘’][^"'“”‘’\n]+["'“”‘’]/, // a quoted name
	/#[A-Za-z0-9]/, // a heading / anchor reference
	/\d/, // a count, version, page, section or step number
	/\w+\.\w+/, // a dotted / extension-bearing name
	/\b[A-Z]{2,}\b/, // an acronym
	/\b[a-z]+[A-Z]\w+/, // a camelCase identifier
];

/** List marker at the start of a step line (`-`, `*`, `+`, `1.`, `2)`). */
const LIST_ITEM = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/;

/** A markdown ATX heading and its level. */
const HEADING = /^(#{1,6})\s+(\S.*)$/;

/**
 * Half-open bounds of the Approach section body: the lines between its heading
 * and the next heading of the same or higher level. Undefined when the plan has
 * no Approach heading yet — an in-progress plan, which counts as zero steps.
 */
function approachBounds(lines: readonly string[]): { start: number; end: number } | undefined {
	for (let i = 0; i < lines.length; i++) {
		const match = HEADING.exec(lines[i].trim());
		if (!match || !/^approach\b/i.test(match[2])) continue;
		const level = match[1].length;
		for (let j = i + 1; j < lines.length; j++) {
			const next = HEADING.exec(lines[j].trim());
			if (next && next[1].length <= level) return { start: i + 1, end: j };
		}
		return { start: i + 1, end: lines.length };
	}
	return undefined;
}

/** List items inside the Approach section, with their indentation. */
function approachItems(content: string): { indent: number; text: string }[] {
	const lines = content.split(/\r?\n/);
	const bounds = approachBounds(lines);
	if (!bounds) return [];
	const items: { indent: number; text: string }[] = [];
	for (let i = bounds.start; i < bounds.end; i++) {
		const match = LIST_ITEM.exec(lines[i]);
		if (match) items.push({ indent: match[1].length, text: match[2].trim() });
	}
	return items;
}

/**
 * True when a step reads as a vague action with no named target — the shape the
 * ultra floor calls an unfinished item. Requires a vague verb *and* the absence
 * of every concrete-target signal, so ordinary steps are never flagged.
 */
export function isGenericStep(text: string): boolean {
	const step = text.replace(/^[*_`\s]+/, "").trim();
	if (!VAGUE_STEP_VERB.test(step)) return false;
	for (const signal of CONCRETE_TARGET_SIGNALS) {
		if (signal.test(step)) return false;
	}
	// A capitalised word past the first word reads as a proper name / label.
	return !/\b[A-Z][a-zA-Z]{1,}\b/.test(step.replace(/^\S+\s+/, ""));
}

/** Count the Approach steps of a plan, how many are generic, and where its floor sits. */
export function analyzePlanDepth(content: string): PlanDepth {
	let lines = 1;
	for (let i = 0; i < content.length; i++) {
		if (content.charCodeAt(i) === 10) lines++;
	}
	const stepFloor =
		lines >= PLAN_DEPTH_CROSS_CUTTING_LINES
			? PLAN_DEPTH_CROSS_CUTTING_MIN_STEPS
			: PLAN_DEPTH_SINGLE_SURFACE_MIN_STEPS;

	const items = approachItems(content);
	let minIndent = Number.POSITIVE_INFINITY;
	for (const item of items) {
		if (item.indent < minIndent) minIndent = item.indent;
	}
	let stepCount = 0;
	let genericStepCount = 0;
	for (const item of items) {
		if (item.indent !== minIndent) continue;
		stepCount++;
		if (isGenericStep(item.text)) genericStepCount++;
	}
	return {
		stepCount,
		genericStepCount,
		stepFloor,
		meetsFloor: stepCount >= stepFloor && genericStepCount === 0,
	};
}
