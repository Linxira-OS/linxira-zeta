import type {
	EvaluationContext,
	EvaluationControlInput,
	EvaluationExportInput,
	EvaluationExportResult,
	EvaluationListInput,
	EvaluationListResult,
	EvaluationPlan,
	EvaluationRecord,
	EvaluationResultPage,
	EvaluationSpec,
	EvaluationStartInput,
} from "../protocol/contracts/evaluation-workspace.js";
import type { ClientInteraction } from "./lifecycle.js";

export interface EvaluationWorkspaceQueryInputMap {
	"evaluations.context": { workspaceId: string };
	"evaluations.list": EvaluationListInput;
	"evaluations.read": { id: string };
	"evaluations.rows": { id: string; offset?: number; limit?: number };
	"evaluations.retrySpec": { id: string };
	"evaluations.patch": { id: string; offset?: number };
	"evaluations.exportChunk": { artifactId: string; offset?: number };
}
export interface EvaluationWorkspaceQueryResultMap {
	"evaluations.context": EvaluationContext;
	"evaluations.list": EvaluationListResult;
	"evaluations.read": EvaluationRecord & { clientInteraction?: ClientInteraction };
	"evaluations.rows": EvaluationResultPage;
	"evaluations.retrySpec": EvaluationSpec;
	"evaluations.patch": { text: string; nextOffset: number; total: number };
	"evaluations.exportChunk": { data: string; nextOffset: number; total: number; mimeType: string; name: string };
}
export interface EvaluationWorkspaceCommandInputMap {
	"evaluations.prepare": { workspaceId: string; spec: EvaluationSpec };
	"evaluations.start": EvaluationStartInput;
	"evaluations.control": EvaluationControlInput;
	"evaluations.export": EvaluationExportInput;
	"evaluations.respond": {
		id: string;
		interactionId: string;
		leaseGeneration: number;
		decision: "submit" | "cancel";
		value?: unknown;
	};
	"evaluations.openWorkspace": { id: string };
}
export interface EvaluationWorkspaceCommandResultMap {
	"evaluations.prepare": EvaluationPlan;
	"evaluations.start": EvaluationRecord;
	"evaluations.control": EvaluationRecord;
	"evaluations.export": EvaluationExportResult;
	"evaluations.respond": { responded: true };
	"evaluations.openWorkspace": { opened: true };
}
