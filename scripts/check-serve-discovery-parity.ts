/**
 * Serve-discovery parity guard — `packages/coding-agent/src/server/serve-registry.ts`
 * (the CLI side) and `desktop/src/serve-discovery.ts` (the Electron side) are two
 * copies of one contract: the desktop project has no workspace dependency on
 * `packages/*`, so it carries the read/probe/decide half itself and reads the
 * same registry file and the same `/api/server/identity` endpoint.
 *
 * This guard keeps the two copies from drifting *semantically*. It never diffs
 * the files as text: it extracts, from each side, the items that decide
 * behaviour and compares those —
 *
 * - the action names of the plan union (`ServeStartPlan` vs `DesktopServicePlan`);
 * - the fields each action's result carries;
 * - the version comparison that picks `reuse` vs `version-mismatch`, and its
 *   position relative to those returns;
 * - the intentional differences, which must stay *explicit* (see DIFFERENCES):
 *   the CLI's no-instance action is `start` while the desktop's is `spawn`, its
 *   stale field is `stale` vs `stalePid`, and only the CLI gates reuse on the
 *   target port (`occupiesTarget`) because an explicit `--web-port` there means
 *   "a deliberate second listener".
 *
 * Anything the extraction cannot read fails loudly (a guard that cannot parse
 * must never pass), and a text-level difference in comments, JSDoc, formatting
 * or side-specific extra fields (the desktop's URLs) is not a drift.
 *
 * Usage: bun scripts/check-serve-discovery-parity.ts          (gate mode; exit 0/1)
 *        bun scripts/check-serve-discovery-parity.ts --json   (machine-readable)
 */

import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");

/** The two copies, with the names their extractors are anchored on. */
const CLI = {
	file: "packages/coding-agent/src/server/serve-registry.ts",
	planType: "ServeStartPlan",
	decisionFn: "planServeStart",
	/** Must reference the desktop mirror so the pairing is discoverable. */
	siblingPath: "desktop/src/serve-discovery.ts",
	versionParam: "currentVersion",
	occupiesTargetGate: true,
};
const DESKTOP = {
	file: "desktop/src/serve-discovery.ts",
	planType: "DesktopServicePlan",
	decisionFn: "discoverDesktopService",
	siblingPath: "packages/coding-agent/src/server/serve-registry.ts",
	versionParam: "expectedVersion",
	occupiesTargetGate: false,
};

type Side = typeof CLI | typeof DESKTOP;

/**
 * The recorded, intentional divergence between the two copies. `reuse` and
 * `version-mismatch` are the shared semantics and must be identical; the
 * no-instance action and the stale field are named differently on purpose.
 */
const DIFFERENCES = {
	noInstanceAction: { cli: "start", desktop: "spawn" },
	staleField: { cli: "stale", desktop: "stalePid" },
} as const;

/** Fields every plan variant of an action must carry on both sides. */
const SHARED_FIELDS: Record<string, string[]> = {
	reuse: ["identity", "registration"],
	"version-mismatch": ["identity", "registration"],
};

interface Extracted {
	actions: Map<string, string[]>;
	versionComparison: string | null;
	decisionOrder: Map<string, number>;
	hasOccupiesTarget: boolean;
	referencesSibling: boolean;
}

interface Violation {
	rule: string;
	side: string;
	detail: string;
}

/** Strip comments so extracted identifiers come from code only. */
function stripComments(text: string): string {
	return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

/** Range of the declaration opened at `marker`, up to its terminating top-level `;`. */
function declarationRange(text: string, marker: string): [number, number] | null {
	const start = text.indexOf(marker);
	if (start < 0) return null;
	let depth = 0;
	for (let i = text.indexOf("{", start); i >= 0 && i < text.length; i++) {
		const char = text[i];
		if ("{[(".includes(char)) depth++;
		else if ("}])".includes(char)) depth--;
		else if (char === ";" && depth === 0) return [start, i + 1];
	}
	return null;
}

/** Range of a function body: the block after its parameter list. */
function functionBodyRange(text: string, name: string): [number, number] | null {
	const at = text.indexOf(`function ${name}(`);
	if (at < 0) return null;
	let i = text.indexOf("(", at);
	let depth = 0;
	for (; i < text.length; i++) {
		if (text[i] === "(") depth++;
		else if (text[i] === ")") {
			depth--;
			if (depth === 0) {
				i++;
				break;
			}
		}
	}
	const open = text.indexOf("{", i);
	if (open < 0) return null;
	depth = 0;
	for (let j = open; j < text.length; j++) {
		if (text[j] === "{") depth++;
		else if (text[j] === "}") {
			depth--;
			if (depth === 0) return [open + 1, j];
		}
	}
	return null;
}

/**
 * Field names of the object literal enclosing each `action: "x"` literal inside
 * `[from, to)`. Handles shorthand properties (`{ action: "reuse", identity }`),
 * multi-line variants, and `null`-union field types.
 */
function actionObjects(text: string, from: number, to: number): Map<string, string[]> {
	const found = new Map<string, string[]>();
	for (const match of text.slice(from, to).matchAll(/action:\s*"([a-z][a-z-]*)"/g)) {
		const action = match[1];
		const at = from + (match.index ?? 0);
		const open = text.lastIndexOf("{", at);
		if (open < from) continue;
		let depth = 0;
		let close = -1;
		for (let i = open; i < to; i++) {
			if (text[i] === "{") depth++;
			else if (text[i] === "}") {
				depth--;
				if (depth === 0) {
					close = i;
					break;
				}
			}
		}
		if (close < 0) continue;
		const parts: string[] = [];
		let nesting = 0;
		let current = "";
		for (const char of text.slice(open + 1, close)) {
			if ("{[(".includes(char)) nesting++;
			else if ("}])".includes(char)) nesting--;
			if (char === "," && nesting === 0) {
				parts.push(current);
				current = "";
			} else {
				current += char;
			}
		}
		parts.push(current);
		const fields: string[] = [];
		for (const part of parts) {
			const trimmed = part.trim();
			const named = /^([A-Za-z_$][\w$]*)\s*:/.exec(trimmed);
			const shorthand = /^([A-Za-z_$][\w$]*)$/.exec(trimmed);
			const name = named?.[1] ?? shorthand?.[1];
			if (name && name !== "action" && !fields.includes(name)) fields.push(name);
		}
		found.set(action, fields);
	}
	return found;
}

function extract(side: Side, raw: string): Extracted | string {
	const text = stripComments(raw);
	const planRange = declarationRange(text, `export type ${side.planType} =`);
	if (!planRange) return `plan union \`${side.planType}\` not found`;
	const decisionRange = functionBodyRange(text, side.decisionFn);
	if (!decisionRange) return `decision function \`${side.decisionFn}\` not found`;

	const declared = actionObjects(text, planRange[0], planRange[1]);
	const returned = actionObjects(text, decisionRange[0], decisionRange[1]);
	if (declared.size < 2) return `plan union \`${side.planType}\` declares ${declared.size} action(s)`;
	if (returned.size < 2) return `\`${side.decisionFn}\` returns ${returned.size} action(s)`;
	for (const action of declared.keys()) {
		if (!returned.has(action)) return `action "${action}" is declared but never returned`;
	}

	const body = text.slice(decisionRange[0], decisionRange[1]);
	const comparison = new RegExp(`identity\\.version\\s*(===|!==)\\s*${side.versionParam}\\b`).exec(body);
	return {
		actions: returned,
		versionComparison: comparison ? `${comparison[1]} ${side.versionParam}` : null,
		decisionOrder: new Map(
			[...returned.keys()].map(action => [action, body.indexOf(`action: "${action}"`)] as const),
		),
		hasOccupiesTarget: body.includes("occupiesTarget"),
		referencesSibling: raw.includes(side.siblingPath),
	};
}

function main(): void {
	const violations: Violation[] = [];
	const extracted: Partial<Record<"cli" | "desktop", Extracted>> = {};
	for (const [key, side] of [
		["cli", CLI],
		["desktop", DESKTOP],
	] as const) {
		let raw: string;
		try {
			raw = fs.readFileSync(path.join(ROOT, side.file), "utf8");
		} catch {
			violations.push({ rule: "file-present", side: side.file, detail: "file is missing" });
			continue;
		}
		const result = extract(side, raw);
		if (typeof result === "string") violations.push({ rule: "parsable", side: side.file, detail: result });
		else extracted[key] = result;
	}

	const cli = extracted.cli;
	const desktop = extracted.desktop;
	if (cli && desktop) {
		// 1. Same action set, modulo the recorded no-instance rename.
		const normalize = (plan: Extracted, side: "cli" | "desktop"): string[] =>
			[...plan.actions.keys()]
				.map(action => (action === DIFFERENCES.noInstanceAction[side] ? "no-instance" : action))
				.sort();
		const cliActions = normalize(cli, "cli");
		const desktopActions = normalize(desktop, "desktop");
		if (cliActions.join(",") !== desktopActions.join(",")) {
			violations.push({
				rule: "action-set",
				side: "cli vs desktop",
				detail: `cli [${cliActions}] != desktop [${desktopActions}]`,
			});
		}

		// 2. Contract fields for the shared actions, and stale info on every action.
		for (const [action, required] of Object.entries(SHARED_FIELDS)) {
			for (const [side, plan] of [
				[CLI.file, cli],
				[DESKTOP.file, desktop],
			] as const) {
				for (const field of required) {
					if (!(plan.actions.get(action) ?? []).includes(field)) {
						violations.push({
							rule: "action-fields",
							side,
							detail: `"${action}" does not carry \`${field}\``,
						});
					}
				}
			}
		}
		for (const [side, plan, key] of [
			[CLI.file, cli, "cli"],
			[DESKTOP.file, desktop, "desktop"],
		] as const) {
			const staleField: string = DIFFERENCES.staleField[key];
			const noInstance = plan.actions.get(DIFFERENCES.noInstanceAction[key]);
			if (noInstance?.includes("identity")) {
				violations.push({
					rule: "no-instance-fields",
					side,
					detail: "the no-instance action must not carry `identity`",
				});
			}
			for (const action of plan.actions.keys()) {
				if (!(plan.actions.get(action) ?? []).includes(staleField)) {
					violations.push({ rule: "stale-field", side, detail: `"${action}" does not carry \`${staleField}\`` });
				}
			}
		}

		// 3. Both pick reuse/version-mismatch with a strict version inequality,
		//    mismatch first, and keep the recorded policy differences explicit.
		for (const [side, plan, key] of [
			[CLI.file, cli, "cli"],
			[DESKTOP.file, desktop, "desktop"],
		] as const) {
			const param = key === "cli" ? CLI.versionParam : DESKTOP.versionParam;
			if (plan.versionComparison !== `!== ${param}`) {
				violations.push({
					rule: "version-comparison",
					side,
					detail: `expected a strict \`identity.version !== ${param}\`, found ${plan.versionComparison ?? "none"}`,
				});
			}
			const mismatch = plan.decisionOrder.get("version-mismatch") ?? -1;
			const reuse = plan.decisionOrder.get("reuse") ?? -1;
			if (mismatch < 0 || reuse < 0) {
				violations.push({
					rule: "shared-actions",
					side,
					detail: "`reuse` and `version-mismatch` must both be returned",
				});
			} else if (mismatch > reuse) {
				violations.push({
					rule: "branch-order",
					side,
					detail: "`version-mismatch` must be returned before `reuse`",
				});
			}
			const expectedGate = key === "cli" ? CLI.occupiesTargetGate : DESKTOP.occupiesTargetGate;
			if (plan.hasOccupiesTarget !== expectedGate) {
				violations.push({
					rule: "recorded-difference",
					side,
					detail: `the target-port gate (\`occupiesTarget\`) must stay ${
						expectedGate ? "present (CLI policy)" : "absent (desktop policy)"
					} — update DIFFERENCES if this is a deliberate policy change`,
				});
			}
			if (!plan.referencesSibling) {
				violations.push({
					rule: "cross-reference",
					side,
					detail: `the file must name its other copy (\`${key === "cli" ? CLI.siblingPath : DESKTOP.siblingPath}\`)`,
				});
			}
		}
	}

	if (process.argv.includes("--json")) {
		process.stdout.write(`${JSON.stringify({ ok: violations.length === 0, violations }, null, 2)}\n`);
	} else if (violations.length > 0) {
		console.error("Serve-discovery parity FAILED:");
		for (const violation of violations)
			console.error(`  - [${violation.rule}] ${violation.side}: ${violation.detail}`);
	} else {
		console.log(
			`Serve-discovery parity OK: ${CLI.file} ↔ ${DESKTOP.file} (actions [${[...cli!.actions.keys()].join("/")}] ↔ [${[...desktop!.actions.keys()].join("/")}], version guard, contract fields)`,
		);
	}
	if (violations.length > 0) process.exitCode = 1;
}

main();
