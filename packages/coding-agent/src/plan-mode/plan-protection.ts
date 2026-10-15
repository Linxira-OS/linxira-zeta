import { getReadToolPath, type ProtectedToolContext } from "@linxiraos/pi-agent-core/compaction/tool-protection";
import { InternalUrlRouter } from "../internal-urls/router";

/** Canonical plan alias every session's `local://` root resolves. */
const LOCAL_PLAN_ALIAS = "local://PLAN.md";

/** Canonical session-local plan artifact name: `local://<name>-plan.md`. */
const PLAN_ARTIFACT_RE = /^local:\/\/[^/:]+-plan\.md$/i;

/** True when `readPath` targets `planTarget`, ignoring `local:/` vs `local://`
 *  scheme spelling and any trailing read selector (`:1-50`, `:raw`, …). */
export function readTargetsPlan(readPath: string, planTarget: string): boolean {
	const router = InternalUrlRouter.instance();
	const read = router.normalize(readPath);
	const target = router.normalize(planTarget);
	return read === target || read.startsWith(`${target}:`);
}

/**
 * True when `readPath` names the canonical session-local plan artifact
 * `local://<name>-plan.md`, ignoring a trailing read selector (`:1-50`, `:raw`,
 * `:conflicts`) and accepting the single-slash `local:/` alias spelling.
 *
 * This covers the pre-approval planning window: the agent writes its plan to
 * `local://<slug>-plan.md`, but the session plan *reference* is still the
 * default `local://PLAN.md` (it is only promoted to the slug path once the plan
 * is submitted), so the reference-based {@link readTargetsPlan} checks do not
 * recognize it yet.
 */
export function readTargetsPlanArtifact(readPath: string): boolean {
	return PLAN_ARTIFACT_RE.test(InternalUrlRouter.instance().split(readPath).path);
}

/**
 * Build a compaction protection matcher that keeps `read` results for the active
 * plan file intact through prune/shake — the plan analog of skill-read
 * protection. Matches both the canonical `local://PLAN.md` alias and the
 * session's current plan reference path (the agent-chosen `local://<slug>-plan.md`),
 * so the plan survives compaction whether the agent reads it by alias or by name.
 *
 * `getPlanReferencePath` is evaluated at match time so the plan path set on
 * approval is honored immediately.
 */
export function createPlanReadMatcher(getPlanReferencePath: () => string): (context: ProtectedToolContext) => boolean {
	return (context: ProtectedToolContext) => {
		const path = getReadToolPath(context);
		if (path === undefined) return false;
		return (
			readTargetsPlan(path, LOCAL_PLAN_ALIAS) ||
			readTargetsPlan(path, getPlanReferencePath()) ||
			readTargetsPlanArtifact(path)
		);
	};
}
