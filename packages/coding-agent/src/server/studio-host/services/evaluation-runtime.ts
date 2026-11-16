import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, realpath, stat } from "node:fs/promises";
import * as path from "node:path";
import { getAgentDir, getWorktreeDir } from "@linxiraos/pi-utils";
import { modelKind } from "@linxiraos/pi-catalog/types";
import type { AgentSession } from "../../../session/agent-session";
import { InternalUrlRouter } from "../../../internal-urls/router";
import { resumePathKey, sameResumePath } from "../../../resume/paths";
import { getRpcSession } from "../../web-gateway/agents";
import { ensureLiveSession, gatewayJson, invalid, unavailable } from "../gateway.js";
import type { StudioHostContext } from "../registry.js";
import { currentSessionId } from "../ops/session.js";
import { listSessionArtifactsForEvaluation, readTextArtifactForEvaluation } from "../ops/files.js";
import { readWorkspaceIdentities, resolveWorkspacePath } from "../ops/workspace.js";
import type {
	EvaluationContext,
	EvaluationRecord,
	EvaluationSpec,
	EvaluationWorkspaceOperation,
} from "../protocol/contracts/evaluation-workspace.js";
import type { ClientInteraction } from "../contract/lifecycle.js";
import type { SessionId, InteractionId } from "../contract/ids.js";
import { EvaluationCoordinator, type EvaluationWorker } from "./evaluation-coordinator.js";
import { EvaluationExportStore } from "./evaluation-export-store.js";
import type { EvaluationLegacyBinding } from "./evaluation-legacy.js";
import { EvaluationInteractionPort } from "./evaluation-interactions.js";
import { EvaluationPublicProjection } from "./evaluation-public.js";
import { StudioEvaluationWorkspaceService } from "./evaluation-workspace-service.js";
import { EVALUATION_LIMITS, validateEvaluationSpec } from "./evaluation-limits.js";
import agentPackage from "../../../../package.json";

interface Resident {
	session: AgentSession;
	sessionId: string;
	workspaceId: string;
	workspace: string;
	coordinator: EvaluationCoordinator;
	projection: EvaluationPublicProjection;
	closed: boolean;
	cancel: Set<() => void>;
}
const residents = new WeakMap<AgentSession, Resident>();
const hosts = new Set<Resident>();
interface EvaluationView {
	resident?: Resident;
	closed: boolean;
}
const views = new Map<string, EvaluationView>();

/** View revocation releases interaction leases; native paid tasks remain Host-owned. */
export function releaseStudioEvaluationOwner(owner: string): void {
	const view = views.get(owner);
	if (view) view.closed = true;
	view?.resident?.coordinator.releaseView(owner);
	views.delete(owner);
}
/** Called by the existing serve shutdown seam; results are saved before releasing workers. */
export async function shutdownStudioEvaluations(): Promise<void> {
	for (const owner of views.keys()) releaseStudioEvaluationOwner(owner);
	await Promise.allSettled(
		[...hosts].map(async resident => {
			resident.closed = true;
			for (const cancel of resident.cancel) cancel();
			await resident.coordinator.shutdown();
			hosts.delete(resident);
		}),
	);
}
function inside(root: string, file: string): boolean {
	const relative = path.relative(root, file);
	return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}
async function createWorker(
	resident: Resident,
	directory: string,
	attachSessionId?: string,
): Promise<EvaluationWorker> {
	const { session, sessionId, workspace } = resident;
	if (attachSessionId && attachSessionId !== sessionId)
		throw invalid("judgment batch must belong to the selected session");
	const nativeLive = () =>
		!resident.closed &&
		!session.isDisposed &&
		session.sessionId === sessionId &&
		getRpcSession(sessionId)?.getSession() === session;
	if (!nativeLive()) throw unavailable("evaluation session changed");
	if (!session.getEvalToolSession()) throw unavailable("native evaluation tool session is unavailable");
	let closed = false;
	const interactions = new EvaluationInteractionPort(session, () => service.dispose());
	const service = new StudioEvaluationWorkspaceService(session, {}, interactions);
	const inputs = path.join(directory, "inputs");
	await mkdir(inputs, { recursive: true, mode: 0o700 });
	if (!nativeLive()) throw unavailable("evaluation session changed while preparing inputs");
	const cancel = () => service.dispose();
	resident.cancel.add(cancel);
	const resolveImage = async (reference: string): Promise<string> => {
		if (reference.startsWith("evaluation-image:")) {
			const name = reference.slice("evaluation-image:".length);
			if (!/^[a-f0-9-]{36}\.[a-z0-9]{1,8}$/u.test(name)) throw invalid("invalid retained evaluation image");
			const file = await realpath(path.join(inputs, name));
			if (!inside(await realpath(inputs), file)) throw invalid("evaluation image escapes its input store");
			return file;
		}
		let file: string;
		if (reference.startsWith("artifact://")) {
			const id = reference.slice("artifact://".length);
			const decoded = Buffer.from(id, "base64url").toString("utf8").split("\0");
			let localUrl = reference;
			if (decoded[0] === "zeta-artifact") {
				if (
					decoded.length !== 3 ||
					decoded[1] !== sessionId ||
					!decoded[2] ||
					decoded[2].split(/[\\/]/u).some(part => !part || part === "." || part === "..")
				)
					throw invalid("image artifact belongs to another session");
				localUrl = `local://${decoded[2]}`;
			} else if (!/^\d+$/u.test(id)) throw invalid("invalid image artifact identity");
			const artifacts = session.sessionManager.getArtifactsDir();
			if (!artifacts) throw unavailable("session artifact storage is unavailable");
			const located = await InternalUrlRouter.instance().locate(localUrl, {
				localProtocolOptions: { getArtifactsDir: () => artifacts, getSessionId: () => sessionId },
			});
			if (!located) throw invalid("image artifact was not found");
			file = await realpath(located);
			if (!inside(await realpath(artifacts), file)) throw invalid("image artifact escapes its session");
		} else {
			file = await realpath(path.resolve(workspace, reference));
			if (!inside(await realpath(workspace), file)) throw invalid("image must belong to the selected workspace");
		}
		const info = await stat(file);
		if (!info.isFile() || info.size > 16 * 1024 * 1024)
			throw invalid("evaluation image exceeds 16 MiB or is not a file");
		return file;
	};
	const preserveInputs = async (spec: EvaluationSpec, authorize?: () => void): Promise<EvaluationSpec> => {
		authorize?.();
		if (spec.kind !== "judgment") return spec;
		const items = [];
		let totalBytes = 0;
		for (const item of spec.items) {
			const images: string[] = [];
			for (const reference of item.images ?? []) {
				if (reference.startsWith("evaluation-image:")) {
					const retained = await resolveImage(reference);
					totalBytes += (await stat(retained)).size;
					if (totalBytes > EVALUATION_LIMITS.reportBytes) throw invalid("judgment image inputs exceed 64 MiB");
					images.push(reference);
					continue;
				}
				const file = await resolveImage(reference);
				totalBytes += (await stat(file)).size;
				if (totalBytes > EVALUATION_LIMITS.reportBytes) throw invalid("judgment image inputs exceed 64 MiB");
				const extension = path.extname(file).slice(1).toLowerCase();
				const name = `${randomUUID()}.${/^[a-z0-9]{1,8}$/u.test(extension) ? extension : "img"}`;
				if (!nativeLive()) throw unavailable("evaluation session changed while preserving inputs");
				authorize?.();
				await copyFile(file, path.join(inputs, name));
				authorize?.();
				images.push(`evaluation-image:${name}`);
			}
			items.push({ ...item, ...(item.images ? { images } : {}) });
		}
		return { ...spec, items };
	};
	return {
		sessionId,
		runtimeVersion: agentPackage.version,
		async context(): Promise<EvaluationContext> {
			if (!nativeLive()) throw unavailable("evaluation session changed");
			await session.modelRegistry.awaitBackgroundRefresh();
			if (!nativeLive()) throw unavailable("evaluation session changed");
			return {
				available: true,
				runtimeVersion: agentPackage.version,
				models: session.modelRegistry
					.getAvailable("all")
					.filter(model => modelKind(model) === "chat")
					.slice(0, 2000)
					.map(model => ({
						selector: `${model.provider}/${model.id}`,
						name: model.name,
						provider: model.provider,
						kind: modelKind(model),
						image: model.input.includes("image"),
					})),
			};
		},
		preserveInputs,
		async invoke(operation: EvaluationWorkspaceOperation, authorize?: () => void): Promise<unknown> {
			const mutation =
				operation.kind === "evaluation.runtime.start" ||
				operation.kind === "evaluation.runtime.plan" ||
				(operation.kind === "evaluation.runtime.control" && operation.action !== "cancel");
			if (closed || (mutation && !nativeLive())) throw unavailable("evaluation session changed");
			authorize?.();
			let op = operation;
			if (op.kind === "evaluation.runtime.plan" || op.kind === "evaluation.runtime.start") {
				validateEvaluationSpec(op.spec);
				if (op.spec.kind === "judgment" && op.spec.attachSessionId && op.spec.attachSessionId !== sessionId)
					throw invalid("judgment batch belongs to another session");
				let spec = op.kind === "evaluation.runtime.plan" ? await preserveInputs(op.spec, authorize) : op.spec;
				if (spec.kind === "benchmark" && spec.cachePrefixFile && spec.cachePrefixContent === undefined) {
					const file = await realpath(path.resolve(workspace, spec.cachePrefixFile));
					if (!inside(await realpath(workspace), file))
						throw invalid("cache prefix must belong to the selected workspace");
					spec = { ...spec, cachePrefixFile: file };
				}
				if (op.kind === "evaluation.runtime.start" && spec.kind === "judgment")
					spec = {
						...spec,
						items: await Promise.all(
							spec.items.map(async item => ({
								...item,
								...(item.images ? { images: await Promise.all(item.images.map(resolveImage)) } : {}),
							})),
						),
					};
				if (!nativeLive()) throw unavailable("evaluation session changed while resolving inputs");
				op = { ...op, spec };
			}
			authorize?.();
			const result = await service.execute(op, authorize);
			if (mutation && !nativeLive()) {
				service.dispose();
				throw unavailable("evaluation session changed during native work");
			}
			return structuredClone(result);
		},
		pending: () => interactions.pending(),
		respond: input => interactions.respond(input),
		claim: owner => interactions.claim(owner),
		isView: owner => interactions.isView(owner),
		releaseView: owner => interactions.release(owner),
		subscribe(listener) {
			const a = service.subscribe(listener),
				b = interactions.subscribe(listener);
			return () => {
				a();
				b();
			};
		},
		settled: () => service.settled(),
		async release() {
			if (closed) return;
			if (service.running) service.dispose();
			interactions.close();
			await service.settled();
			service.release();
			resident.cancel.delete(cancel);
			closed = true;
		},
	};
}

export interface EvaluationAccess {
	coordinator: EvaluationCoordinator;
	owner: string;
	workspaceId: string;
	assert(): void;
	publicValue<T>(value: T): T;
	read(id: string, claimView?: boolean): Promise<EvaluationRecord & { clientInteraction?: ClientInteraction }>;
}
export async function evaluationRuntime(
	workspaceId: string | undefined,
	context: StudioHostContext,
): Promise<EvaluationAccess> {
	const owner = context.privateOwner;
	if (!owner || !owner.isLive() || owner.expiresAt <= Date.now() || context.selection?.closed)
		throw unavailable("evaluations require a live authenticated view");
	const view: EvaluationView = views.get(owner.id) ?? { closed: false };
	if (!views.has(owner.id)) views.set(owner.id, view);
	const viewLive = () =>
		!view.closed &&
		views.get(owner.id) === view &&
		owner.isLive() &&
		owner.expiresAt > Date.now() &&
		!context.selection?.closed;
	const sessionId = await currentSessionId();
	await ensureLiveSession(sessionId);
	const session = getRpcSession(sessionId)?.getSession();
	if (!session || session.isDisposed || !viewLive()) throw unavailable("evaluation session is not resident");
	const identities =
		workspaceId ??
		context.selection?.workspaceId ??
		residents.get(session)?.workspaceId ??
		(await readWorkspaceIdentities()).get(resumePathKey(session.sessionManager.getCwd()))?.workspaceId;
	if (!identities) throw invalid("select a workspace before opening evaluations");
	if (context.selection && (context.selection.sessionId !== sessionId || context.selection.workspaceId !== identities))
		throw invalid("evaluation belongs to another conversation context");
	const workspace = await resolveWorkspacePath(identities);
	const assert = () => {
		if (
			!viewLive() ||
			session.isDisposed ||
			session.sessionId !== sessionId ||
			getRpcSession(sessionId)?.getSession() !== session ||
			(context.selection &&
				(context.selection.sessionId !== sessionId || context.selection.workspaceId !== identities))
		)
			throw unavailable("evaluation session or view changed");
	};
	assert();
	if (!sameResumePath(workspace, session.sessionManager.getCwd()))
		throw invalid("evaluation workspace does not own the selected session");
	let resident = residents.get(session);
	if (!resident || resident.sessionId !== sessionId) {
		if (hosts.size >= 64) throw unavailable("Host evaluation session limit reached");
		const directory = path.join(
			getAgentDir(),
			"studio",
			"evaluations",
			"v1",
			createHash("sha256").update(sessionId).digest("hex"),
		);
		const projection = new EvaluationPublicProjection([workspace, directory, getAgentDir(), getWorktreeDir("")]);
		const legacy: EvaluationLegacyBinding = {
			sessionId,
			workspaceId: identities,
			source: {
				async list({ kind, limit, cursor }) {
					assert();
					const page = await listSessionArtifactsForEvaluation(sessionId, kind, limit, cursor);
					assert();
					return {
						artifacts: page.artifacts.flatMap(artifact =>
							artifact.kind === "benchmark" || artifact.kind === "judgment"
								? [
										{
											artifactId: artifact.artifactId,
											kind: artifact.kind,
											name: artifact.name,
											createdAt: artifact.createdAt,
											sessionId: artifact.sessionId,
											...(artifact.workspaceId === undefined ? {} : { workspaceId: artifact.workspaceId }),
											...(artifact.runId === undefined ? {} : { runId: artifact.runId }),
										},
									]
								: [],
						),
						...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
					};
				},
				async readText(artifactId) {
					assert();
					const result = await readTextArtifactForEvaluation(artifactId);
					assert();
					if (result.artifact.sessionId !== sessionId)
						throw invalid("evaluation report belongs to another session");
					return { text: result.text };
				},
			},
		};
		const coordinator = new EvaluationCoordinator(
			directory,
			{
				open: async (requested, attached) => {
					if (requested !== next.workspaceId) throw invalid("evaluation belongs to another workspace");
					return createWorker(next, directory, attached);
				},
				reveal: async (isolated, authorize) => {
					const root = await realpath(getWorktreeDir("")),
						target = await realpath(isolated);
					if (!inside(root, target) || root === target) throw invalid("invalid evaluation workspace");
					authorize();
					await gatewayJson("/api/projects", { method: "PUT", body: { path: target } });
					authorize();
				},
			},
			new EvaluationExportStore(path.join(directory, "exports")),
			sessionId,
			projection,
			legacy,
		);
		const next: Resident = {
			session,
			sessionId,
			workspaceId: identities,
			workspace,
			coordinator,
			projection,
			closed: false,
			cancel: new Set(),
		};
		resident = next;
		residents.set(session, next);
		hosts.add(next);
		const release = () => {
			if (next.closed) return;
			next.closed = true;
			for (const cancel of next.cancel) cancel();
			for (const [id, view] of views) if (view.resident === next) releaseStudioEvaluationOwner(id);
			void coordinator
				.shutdown()
				.catch(() => {})
				.finally(() => hosts.delete(next));
		};
		session.addDisposer(release);
		session.registerSessionChangeCallback(release);
	}
	if (resident.closed || resident.workspaceId !== identities)
		throw unavailable("evaluation session generation is closed");
	if (view.resident !== resident) view.resident?.coordinator.releaseView(owner.id);
	view.resident = resident;
	const coordinator = resident.coordinator,
		projection = resident.projection;
	return {
		coordinator,
		owner: owner.id,
		workspaceId: identities,
		assert,
		publicValue: value => projection.value(value),
		async read(id, claimView = true) {
			const record = await coordinator.read(id);
			assert();
			if (record.workspaceId !== identities || record.sessionId !== sessionId)
				throw invalid("evaluation belongs to another session");
			if (claimView) coordinator.claim(id, owner.id);
			assert();
			const pending = coordinator.pending(id, owner.id);
			const result = projection.value(record);
			delete result.interaction;

			if (!pending) return result;
			const request = projection.value(pending.request);
			const base = {
				interactionId: request.interactionId as string as InteractionId,
				sessionId: sessionId as SessionId,
				leaseGeneration: pending.leaseGeneration,
				title: request.title,
			};
			let clientInteraction: ClientInteraction;
			if (request.kind === "confirm")
				clientInteraction = { ...request, ...base, destructive: request.destructive === true };
			else if (request.kind === "select")
				clientInteraction = { ...request, ...base, multiple: request.multiple === true };
			else if (request.kind === "input")
				clientInteraction = { ...request, ...base, secret: request.secret === true };
			else if (request.kind === "approval")
				clientInteraction = {
					...base,
					kind: "approval",
					approvalType: request.approvalType,
					detail: { review: request.details },
				};
			else if (request.kind === "ask")
				clientInteraction = {
					...request,
					...base,
					questions: request.questions.map(question => ({ ...question, multiple: question.multiple === true })),
				};
			else clientInteraction = { ...request, ...base };
			return { ...result, clientInteraction };
		},
	};
}
