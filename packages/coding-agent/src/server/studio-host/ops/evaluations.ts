import type { StudioFamily, StudioHostContext } from "../registry.js";
import type { EvaluationSpec } from "../protocol/contracts/evaluation-workspace.js";
import { invalid, requiredString, unavailable } from "../gateway.js";
import { evaluationRuntime, type EvaluationAccess } from "../services/evaluation-runtime.js";
import { EvaluationPublicProjection } from "../services/evaluation-public.js";
import { validateEvaluationSpec } from "../services/evaluation-limits.js";

/** Every public result and error uses the same private-data projection. */
async function access<T>(
	workspaceId: string | undefined,
	context: StudioHostContext,
	action: (runtime: EvaluationAccess) => Promise<T>,
): Promise<T> {
	let runtime: EvaluationAccess | undefined;
	try {
		runtime = await evaluationRuntime(workspaceId, context);
		const result = await action(runtime);
		runtime.assert();
		return runtime.publicValue(result);
	} catch (error) {
		const message = error instanceof Error ? error.message : "Evaluation operation failed";
		const safe = runtime ? runtime.publicValue(message) : new EvaluationPublicProjection().text(message);
		if (error instanceof Error && "code" in error && error.code === "INVALID_ARGUMENT") throw invalid(safe);
		throw unavailable(safe);
	}
}
async function withRecord<T>(
	id: string,
	context: StudioHostContext,
	action: (runtime: EvaluationAccess) => Promise<T>,
): Promise<T> {
	return access(undefined, context, async runtime => {
		await runtime.read(id, false);
		return action(runtime);
	});
}

export const evaluationsOps: StudioFamily = {
	id: "evaluations",
	queries: {
		"evaluations.context": (input, context) =>
			access(requiredString(input, "workspaceId"), context, runtime =>
				runtime.coordinator.context(runtime.workspaceId),
			),
		"evaluations.list": (input, context) =>
			access(input.workspaceId, context, runtime =>
				runtime.coordinator.list({ ...input, workspaceId: runtime.workspaceId }),
			),
		"evaluations.read": (input, context) =>
			withRecord(requiredString(input, "id"), context, runtime => runtime.read(input.id)),
		"evaluations.rows": (input, context) =>
			withRecord(requiredString(input, "id"), context, runtime => runtime.coordinator.rows(input)),
		"evaluations.retrySpec": (input, context) =>
			withRecord(requiredString(input, "id"), context, runtime => runtime.coordinator.retrySpec(input.id)),
		"evaluations.patch": (input, context) =>
			withRecord(requiredString(input, "id"), context, runtime => runtime.coordinator.patch(input)),
		"evaluations.exportChunk": (input, context) =>
			access(undefined, context, runtime => runtime.coordinator.exportChunk(input)),
	},
	commands: {
		"evaluations.prepare": (input, context) =>
			access(requiredString(input, "workspaceId"), context, async runtime => {
				validateEvaluationSpec(input.spec);
				return runtime.coordinator.prepare(input, runtime.assert);
			}),
		"evaluations.start": (input, context) =>
			access(requiredString(input, "workspaceId"), context, async runtime => {
				validateEvaluationSpec(input.spec);
				if (input.sourceId) await runtime.read(input.sourceId, false);
				const record = await runtime.coordinator.start(
					{ ...input, title: requiredString(input, "title") },
					runtime.assert,
				);
				return runtime.read(record.id);
			}),
		"evaluations.control": (input, context) =>
			withRecord(requiredString(input, "id"), context, async runtime => {
				if (!["cancel", "start", "approve", "configure", "pilot", "retry"].includes(input.action))
					throw invalid("invalid evaluation control action");
				if (input.stage !== undefined && !["inputs", "grader", "plan"].includes(input.stage))
					throw invalid("invalid Ratchet approval stage");
				if (input.action === "retry") {
					const source = await runtime.coordinator.read(input.id);
					const spec: EvaluationSpec =
						source.spec.kind === "judgment" ? await runtime.coordinator.retrySpec(input.id) : source.spec;
					const record = await runtime.coordinator.start(
						{ workspaceId: runtime.workspaceId, title: source.title, spec, sourceId: source.id },
						runtime.assert,
					);
					return runtime.read(record.id);
				}
				await runtime.coordinator.control(input, runtime.assert);
				return runtime.read(input.id);
			}),
		"evaluations.export": (input, context) =>
			withRecord(requiredString(input, "id"), context, runtime => runtime.coordinator.export(input)),
		"evaluations.respond": (input, context) =>
			withRecord(requiredString(input, "id"), context, async runtime => {
				runtime.assert();
				await runtime.coordinator.respond(input, runtime.owner, runtime.assert);
				return { responded: true as const };
			}),
		"evaluations.openWorkspace": (input, context) =>
			withRecord(requiredString(input, "id"), context, async runtime => {
				await runtime.coordinator.openWorkspace(input.id, runtime.assert);
				return { opened: true as const };
			}),
	},
};
