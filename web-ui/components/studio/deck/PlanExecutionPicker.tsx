"use client";

/**
 * Execution-tier picker for an approved plan.
 *
 * Ported from OMP Studio (MIT) `deck/PlanExecutionPicker.tsx`. Studio asked
 * `mode.plan.review.details` for a native tier list; Zeta's equivalent is the
 * configured `modelRoles` map, read through `plan-api.ts`. Picking a tier is
 * applied by the host with the gateway's `set_model_role` before the plan is
 * approved (`planExecutionRoleCommand` in `client-handlers.ts`) — Zeta has no
 * role-scoped approval command, so the picker never approves by itself.
 */

import { useEffect, useRef, useState } from "react";
import type { NativePlanReview } from "@/lib/studio-protocol/protocol";
import { AppSelect } from "../primitives/AppSelect";
import { useI18n } from "../i18n";
import { hostErrorMessage } from "../primitives/hostError";
import { fetchPlanReview } from "./plan-api";

/**
 * Reads the plan review for a live session while plan mode is waiting for a
 * decision. Re-reads when `stateVersion` changes (a plan file writeback or a
 * mode change bumps it).
 */
export function useNativePlanReview(
	sessionId: string | undefined,
	enabled: boolean,
	active: boolean,
	stateVersion: number | undefined,
) {
	const [details, setDetails] = useState<NativePlanReview | undefined>();
	const [role, setRole] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");
	const previousReview = useRef("");
	useEffect(() => {
		let current = true;
		if (!enabled || !active || !sessionId) {
			setDetails(undefined);
			setRole("");
			setLoading(false);
			setError("");
			previousReview.current = "";
			return;
		}
		setLoading(true);
		setError("");
		void fetchPlanReview(sessionId)
			.then(result => {
				if (!current) return;
				setDetails(result);
				const sameReview = previousReview.current === (result.reviewId ?? "");
				setRole(value => (sameReview && result.tiers.some(tier => tier.role === value) ? value : (result.selectedRole ?? "")));
				previousReview.current = result.reviewId ?? "";
			})
			.catch((cause: unknown) => {
				if (!current) return;
				setDetails(undefined);
				setError(hostErrorMessage(cause, "Cannot read plan execution tiers"));
			})
			.finally(() => {
				if (current) setLoading(false);
			});
		return () => {
			current = false;
		};
	}, [sessionId, enabled, active, stateVersion]);
	return { details, role, setRole, loading, error };
}

export function PlanExecutionPicker({
	details,
	role,
	onChange,
	disabled,
	loading,
	error,
}: {
	details?: NativePlanReview | undefined;
	role: string;
	onChange(role: string): void;
	disabled?: boolean | undefined;
	loading?: boolean | undefined;
	error?: string | undefined;
}) {
	const { resolvedLanguage } = useI18n();
	const zh = resolvedLanguage === "zh";
	const tier = details?.tiers.find(item => item.role === role);
	return (
		<div className="plan-execution">
			<label>
				<span>{zh ? "执行档位" : "Execution tier"}</span>
				<AppSelect
					className="select"
					aria-label={zh ? "计划执行档位" : "Plan execution tier"}
					value={role}
					disabled={disabled || loading || !details?.available || !details.tiers.length}
					onChange={event => onChange(event.target.value)}
				>
					{!details?.tiers.length ? (
						<option value="">
							{loading ? (zh ? "读取中…" : "Loading…") : zh ? "使用原有模型" : "Use the existing model"}
						</option>
					) : (
						details.tiers.map(item => (
							<option key={item.role} value={item.role}>
								{item.role} · {item.name}
							</option>
						))
					)}
				</AppSelect>
			</label>
			{tier ? (
				<span className="plan-execution-detail">
					{tier.provider}/{tier.model}
					{tier.thinkingLevel ? " · " + tier.thinkingLevel : ""}
				</span>
			) : null}
			{error ? (
				<span role="alert" className="feature-err small">
					{error}
				</span>
			) : null}
		</div>
	);
}
