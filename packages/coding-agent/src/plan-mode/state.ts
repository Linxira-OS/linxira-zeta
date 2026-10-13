export type PlanWorkflow = "parallel" | "iterative" | "ultra";

export interface PlanModeState {
	enabled: boolean;
	planFilePath: string;
	workflow?: PlanWorkflow;
	reentry?: boolean;
	/**
	 * Who armed this mode: the user (or an external client), or the agent's own
	 * `mode` tool. Absent means the user. The `mode` tool refuses to leave a
	 * user-armed plan mode, so this field is what keeps the agent from walking
	 * out of the approval gate the user put it behind.
	 */
	enteredBy?: "user" | "agent";
	/**
	 * Task stated when plan mode was entered (`/plan <task>`, `/plan-ultra <task>`).
	 * Seeds the goal objective of the approved-plan execution round; a plan
	 * restored from disk has none, so approval falls back to the plan content.
	 */
	objective?: string;
}
