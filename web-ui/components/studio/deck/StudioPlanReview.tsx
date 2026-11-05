"use client";

/**
 * Zeta wiring for the Studio plan review.
 *
 * `PlanCard` / `PlanReviewDeck` are Studio's own plan surface (sections,
 * annotations, refine feedback, the review overlay). This wrapper maps its
 * actions onto Zeta's plan commands — the only four the gateway serves:
 *
 *   PLAN_ACTIONS.execute → `plan_approve` mode `fresh`    (approve, new context)
 *   PLAN_ACTIONS.keep    → `plan_approve` mode `preserve` (approve, keep context)
 *   PLAN_ACTIONS.compact → `plan_approve` mode `compact`  (approve, compact first)
 *   PLAN_ACTIONS.dismiss → `plan_approve` mode `cancel`   (keep planning)
 *   PLAN_ACTIONS.refine  → a normal prompt carrying the section annotations
 *
 * The execution-tier picker reads `modelRoles` (`plan-api.ts`); picking a role
 * is applied by the host through the gateway's `set_model_role` before approval.
 */

import { useState } from "react";
import { PlanExecutionPicker, useNativePlanReview } from "./PlanExecutionPicker";
import { PlanReviewDeck } from "./PlanCard";
import type { PlanActionDetail, PlanActionId } from "./types";

/** Studio's plan action → the gateway's `plan_approve` mode. */
export type PlanApproveMode = "preserve" | "compact" | "fresh" | "cancel";

export function planApproveMode(action: PlanActionId): PlanApproveMode | null {
	switch (action) {
		case "execute":
			return "fresh";
		case "keep":
			return "preserve";
		case "compact":
			return "compact";
		case "dismiss":
			return "cancel";
		default:
			return null;
	}
}

export function StudioPlanReview({
	sessionId,
	planFilePath,
	title: titleProp,
	planMarkdown,
	disabled,
	stateVersion,
	onApprove,
	onRefine,
	onRoleChange,
}: {
	sessionId: string | null;
	planFilePath: string;
	/** Display title; defaults to the plan file stem. */
	title?: string;
	planMarkdown: string;
	disabled?: boolean;
	/** Bumped when the session state changes; re-reads the tier list. */
	stateVersion?: number;
	onApprove: (mode: PlanApproveMode) => void;
	/** Refine keeps plan mode open: `feedback` is the annotated refinement prompt. */
	onRefine?: (feedback: string) => void;
	onRoleChange?: (role: string) => void;
}) {
	const review = useNativePlanReview(sessionId ?? undefined, true, true, stateVersion);
	const [roleOverride, setRoleOverride] = useState<string | null>(null);
	const role = roleOverride ?? review.role;
	const title =
		titleProp ?? planFilePath.split(/[\\/]/).pop()?.replace(/\.md$/i, "") ?? planFilePath;

	const handleAction = (action: PlanActionId, detail?: PlanActionDetail) => {
		if (action === "refine") {
			const feedback = detail?.feedback?.trim();
			if (feedback) onRefine?.(feedback);
			return;
		}
		const mode = planApproveMode(action);
		if (mode) onApprove(mode);
	};

	return (
		<PlanReviewDeck
			title={title}
			body={planMarkdown}
			{...(disabled === true ? { disabled: true } : {})}
			onAction={handleAction}
			executionControl={
				<PlanExecutionPicker
					details={review.details}
					role={role}
					loading={review.loading}
					{...(review.error ? { error: review.error } : {})}
					{...(disabled === true ? { disabled: true } : {})}
					onChange={next => {
						setRoleOverride(next);
						onRoleChange?.(next);
					}}
				/>
			}
		/>
	);
}
