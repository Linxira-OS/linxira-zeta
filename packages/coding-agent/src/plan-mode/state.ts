export type PlanWorkflow = "parallel" | "iterative" | "ultra";

export interface PlanModeState {
	enabled: boolean;
	planFilePath: string;
	workflow?: PlanWorkflow;
	reentry?: boolean;
}
