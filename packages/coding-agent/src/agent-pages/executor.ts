/**
 * Agent pages — bounded DAG workflow executor.
 *
 * The executor validates the whole reachable workflow graph before running a
 * single step: unknown workflows/steps, cycles, unsafe paths, and undeclared
 * permissions all fail up front. Steps then run with a shared concurrency
 * limiter, propagate typed outputs through dependency edges, and stop as soon
 * as one step fails or the caller aborts.
 *
 * There is no shell or eval step. `spawn` composes another declared workflow
 * in-process; `fetch` is a GET with a per-redirect host permission check; file
 * reads and writes resolve through `realpath` inside the page root.
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolveAgentPageFile, resolveAgentPageWritePath, parseAgentPageHttpUrl } from "./manifest";
import { assertAgentPagePermission } from "./permissions";
import {
	AGENT_PAGE_DEFAULT_CONCURRENCY,
	AGENT_PAGE_MAX_CONCURRENCY,
	AGENT_PAGE_MAX_SPAWN_DEPTH,
	AgentPageError,
	type AgentPageJsonValue,
	type AgentPageManifest,
	type AgentPageOutputType,
	type AgentPageStep,
	type AgentPageStepOutput,
	type AgentPageWorkflow,
	type AgentPageWorkflowRunOptions,
	type AgentPageWorkflowRunResult,
	type AgentPageFetch,
} from "./types";

export interface AgentPageWorkflowPlan {
	readonly workflow: AgentPageWorkflow;
	readonly dependencies: ReadonlyMap<string, readonly string[]>;
	/** Deterministic topological order (declaration order breaks ties). */
	readonly order: readonly string[];
}

interface WorkflowExecutionContext {
	readonly manifest: AgentPageManifest;
	readonly pageRoot: string;
	readonly plans: ReadonlyMap<string, AgentPageWorkflowPlan>;
	readonly limiter: ConcurrencyLimiter;
	readonly signal: AbortSignal;
	readonly controller: AbortController;
	readonly fetchImpl: AgentPageFetch;
	readonly maxSpawnDepth: number;
}

interface StepExecutionContext extends WorkflowExecutionContext {
	readonly outputs: ReadonlyMap<string, AgentPageStepOutput>;
	/** Workflow ids from the top-level run through the current workflow. */
	readonly chain: readonly string[];
}

interface WorkflowExecution {
	readonly pageId: string;
	readonly workflowId: string;
	readonly outputs: Readonly<Record<string, AgentPageStepOutput>>;
	readonly order: readonly string[];
}

interface LimiterWaiter {
	readonly signal: AbortSignal;
	settled: boolean;
	resolve: () => void;
	reject: (error: unknown) => void;
	onAbort: () => void;
}

function cancelledError(): AgentPageError {
	return new AgentPageError("cancelled", "Workflow run was cancelled", 409);
}

function throwIfCancelled(signal: AbortSignal): void {
	if (signal.aborted) throw cancelledError();
}

function isAbortError(error: unknown): boolean {
	if (error instanceof DOMException) return error.name === "AbortError";
	return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

function normalizeStepError(step: AgentPageStep, error: unknown, signal: AbortSignal): AgentPageError {
	if (error instanceof AgentPageError) return error;
	if (signal.aborted || isAbortError(error)) return cancelledError();
	const message = error instanceof Error ? error.message : String(error);
	return new AgentPageError("step_failed", `Step "${step.id}" failed: ${message}`, 500, { stepId: step.id });
}

function normalizeConcurrency(value: number | undefined): number {
	if (value === undefined) return AGENT_PAGE_DEFAULT_CONCURRENCY;
	if (!Number.isInteger(value) || value < 1 || value > AGENT_PAGE_MAX_CONCURRENCY) {
		throw new AgentPageError(
			"invalid_request",
			`concurrency must be an integer between 1 and ${AGENT_PAGE_MAX_CONCURRENCY}`,
			400,
		);
	}
	return value;
}

function normalizeSpawnDepth(value: number | undefined): number {
	if (value === undefined) return AGENT_PAGE_MAX_SPAWN_DEPTH;
	if (!Number.isInteger(value) || value < 0 || value > AGENT_PAGE_MAX_SPAWN_DEPTH) {
		throw new AgentPageError(
			"invalid_request",
			`maxSpawnDepth must be between 0 and ${AGENT_PAGE_MAX_SPAWN_DEPTH}`,
			400,
		);
	}
	return value;
}

/** The natural output type of a step kind; manifests may only repeat it. */
export function agentPageStepOutputType(step: AgentPageStep): AgentPageOutputType {
	switch (step.kind) {
		case "constant":
			if (typeof step.value === "string") return "text";
			if (typeof step.value === "number") return "number";
			if (typeof step.value === "boolean") return "boolean";
			return "json";
		case "spawn":
			return "json";
		default:
			return "text";
	}
}

function directlyDeclaredDependencies(step: AgentPageStep): readonly string[] {
	const dependencies = new Set<string>(step.dependsOn ?? []);
	if (step.kind === "template") {
		for (const source of Object.values(step.inputs ?? {})) dependencies.add(source);
	}
	if (step.kind === "write" && step.input !== undefined) dependencies.add(step.input);
	return [...dependencies];
}

/**
 * Validate one workflow's steps and build its dependency graph. Missing
 * references and cycles throw before any step can run.
 */
export function planAgentPageWorkflow(workflow: AgentPageWorkflow): AgentPageWorkflowPlan {
	const byId = new Map<string, AgentPageStep>();
	for (const step of workflow.steps) {
		if (byId.has(step.id)) {
			throw new AgentPageError("duplicate_step", `Duplicate step id "${step.id}"`, 400, {
				workflowId: workflow.id,
				stepId: step.id,
			});
		}
		byId.set(step.id, step);
	}
	const dependencies = new Map<string, readonly string[]>();
	const dependents = new Map<string, string[]>();
	for (const step of workflow.steps) {
		const refs = directlyDeclaredDependencies(step);
		for (const reference of refs) {
			if (!byId.has(reference)) {
				throw new AgentPageError("unknown_step", `Step "${step.id}" depends on unknown step "${reference}"`, 400, {
					workflowId: workflow.id,
					stepId: step.id,
					reference,
				});
			}
			if (reference === step.id) {
				throw new AgentPageError("cycle", `Step "${step.id}" depends on itself`, 409, {
					workflowId: workflow.id,
					stepId: step.id,
				});
			}
		}
		dependencies.set(step.id, refs);
		for (const reference of refs) {
			const list = dependents.get(reference) ?? [];
			list.push(step.id);
			dependents.set(reference, list);
		}
	}

	const inDegree = new Map<string, number>();
	for (const step of workflow.steps) inDegree.set(step.id, dependencies.get(step.id)?.length ?? 0);
	const queue: string[] = [];
	for (const step of workflow.steps) {
		if (inDegree.get(step.id) === 0) queue.push(step.id);
	}
	const order: string[] = [];
	while (queue.length > 0) {
		const current = queue.shift();
		if (current === undefined) break;
		order.push(current);
		for (const next of dependents.get(current) ?? []) {
			const remaining = (inDegree.get(next) ?? 0) - 1;
			inDegree.set(next, remaining);
			if (remaining === 0) queue.push(next);
		}
	}
	if (order.length !== workflow.steps.length) {
		const cycle = workflow.steps.map(step => step.id).filter(id => !order.includes(id));
		throw new AgentPageError("cycle", `Workflow "${workflow.id}" contains a dependency cycle`, 409, {
			workflowId: workflow.id,
			steps: cycle,
		});
	}
	return { workflow, dependencies, order };
}

function assertStepPermission(manifest: AgentPageManifest, workflowId: string, step: AgentPageStep): void {
	try {
		switch (step.kind) {
			case "read":
				assertAgentPagePermission(manifest.permissions, { permission: "read", path: step.path });
				break;
			case "write":
				assertAgentPagePermission(manifest.permissions, { permission: "write", path: step.path });
				break;
			case "fetch":
				assertAgentPagePermission(manifest.permissions, { permission: "network", url: step.url });
				break;
			case "spawn":
				assertAgentPagePermission(manifest.permissions, { permission: "spawn", workflow: step.workflow });
				break;
			default:
				break;
		}
	} catch (error) {
		if (!(error instanceof AgentPageError)) throw error;
		throw new AgentPageError(
			error.code,
			`Workflow "${workflowId}" step "${step.id}": ${error.message}`,
			error.status,
			{ ...error.details, workflowId, stepId: step.id },
		);
	}
}

/**
 * Validate every workflow reachable from `workflowId`, including cycles across
 * `spawn` edges and every reachable step's permission. Running this first means
 * a denied or cyclic descendant cannot leave partial side effects in a parent.
 */
export function preflightAgentPageWorkflows(
	manifest: AgentPageManifest,
	workflowId: string,
	maxSpawnDepth = AGENT_PAGE_MAX_SPAWN_DEPTH,
): ReadonlyMap<string, AgentPageWorkflowPlan> {
	const byId = new Map(manifest.workflows.map(workflow => [workflow.id, workflow]));
	const plans = new Map<string, AgentPageWorkflowPlan>();
	const visiting = new Set<string>();
	const visited = new Set<string>();

	const visit = (id: string, depth: number): void => {
		if (depth > maxSpawnDepth) {
			throw new AgentPageError("limit_exceeded", `Workflow spawn depth exceeds ${maxSpawnDepth}`, 400, {
				workflowId: id,
			});
		}
		if (visiting.has(id)) {
			throw new AgentPageError("cycle", `Spawn cycle includes workflow "${id}"`, 409, { workflowId: id });
		}
		if (visited.has(id)) return;
		const workflow = byId.get(id);
		if (workflow === undefined) {
			throw new AgentPageError("unknown_workflow", `Unknown workflow: ${id}`, 404, { workflowId: id });
		}
		const plan = planAgentPageWorkflow(workflow);
		plans.set(id, plan);
		visiting.add(id);
		for (const step of workflow.steps) {
			assertStepPermission(manifest, id, step);
			if (step.kind === "spawn") visit(step.workflow, depth + 1);
		}
		visiting.delete(id);
		visited.add(id);
	};

	visit(workflowId, 0);
	return plans;
}

class ConcurrencyLimiter {
	private active = 0;
	private readonly waiters: LimiterWaiter[] = [];

	constructor(private readonly limit: number) {}

	async run<T>(task: () => Promise<T>, signal: AbortSignal): Promise<T> {
		const release = await this.acquire(signal);
		try {
			throwIfCancelled(signal);
			return await task();
		} finally {
			release();
		}
	}

	private acquire(signal: AbortSignal): Promise<() => void> {
		throwIfCancelled(signal);
		if (this.active < this.limit) {
			this.active += 1;
			return Promise.resolve(this.releaseOnce());
		}
		const waiting = Promise.withResolvers<() => void>();
		const waiter: LimiterWaiter = {
			signal,
			settled: false,
			resolve: () => {},
			reject: () => {},
			onAbort: () => {},
		};
		waiter.resolve = () => {
			if (waiter.settled) return;
			waiter.settled = true;
			signal.removeEventListener("abort", waiter.onAbort);
			this.active += 1;
			waiting.resolve(this.releaseOnce());
		};
		waiter.reject = error => {
			if (waiter.settled) return;
			waiter.settled = true;
			signal.removeEventListener("abort", waiter.onAbort);
			waiting.reject(error);
		};
		waiter.onAbort = () => {
			const index = this.waiters.indexOf(waiter);
			if (index >= 0) this.waiters.splice(index, 1);
			waiter.reject(cancelledError());
		};
		signal.addEventListener("abort", waiter.onAbort, { once: true });
		this.waiters.push(waiter);
		return waiting.promise;
	}

	private releaseOnce(): () => void {
		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.active -= 1;
			this.wake();
		};
	}

	private wake(): void {
		while (this.active < this.limit && this.waiters.length > 0) {
			const waiter = this.waiters.shift();
			if (waiter === undefined) return;
			if (waiter.signal.aborted) {
				waiter.reject(cancelledError());
				continue;
			}
			waiter.resolve();
			return;
		}
	}
}

function outputAsText(
	step: AgentPageStep,
	sourceId: string,
	outputs: ReadonlyMap<string, AgentPageStepOutput>,
): string {
	const output = outputs.get(sourceId);
	if (output === undefined) {
		throw new AgentPageError("step_failed", `Step "${step.id}" has no output from "${sourceId}"`, 500, {
			stepId: step.id,
		});
	}
	return output.type === "text" ? String(output.value) : (JSON.stringify(output.value) ?? "");
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function runTemplateStep(
	step: Extract<AgentPageStep, { kind: "template" }>,
	context: StepExecutionContext,
): AgentPageStepOutput {
	let rendered = step.template;
	for (const [name, sourceId] of Object.entries(step.inputs ?? {})) {
		const replacement = outputAsText(step, sourceId, context.outputs);
		rendered = rendered.replace(new RegExp(`\\{\\{\\s*${escapeRegExp(name)}\\s*\\}\\}`, "g"), () => replacement);
	}
	if (/\{\{[^}]*\}\}/.test(rendered)) {
		throw new AgentPageError("step_failed", `Step "${step.id}" has an unresolved template placeholder`, 500, {
			stepId: step.id,
		});
	}
	return { stepId: step.id, type: "text", value: rendered };
}

async function runReadStep(
	step: Extract<AgentPageStep, { kind: "read" }>,
	context: StepExecutionContext,
): Promise<AgentPageStepOutput> {
	assertAgentPagePermission(context.manifest.permissions, { permission: "read", path: step.path });
	const file = await resolveAgentPageFile(context.pageRoot, step.path);
	const value = await readFile(file, "utf8");
	return { stepId: step.id, type: "text", value };
}

async function runWriteStep(
	step: Extract<AgentPageStep, { kind: "write" }>,
	context: StepExecutionContext,
): Promise<AgentPageStepOutput> {
	assertAgentPagePermission(context.manifest.permissions, { permission: "write", path: step.path });
	let content: string;
	if (step.input !== undefined) {
		content = outputAsText(step, step.input, context.outputs);
	} else if (step.value !== undefined) {
		content = typeof step.value === "string" ? step.value : (JSON.stringify(step.value) ?? "");
	} else {
		throw new AgentPageError("step_failed", `Step "${step.id}" has no write content`, 500, { stepId: step.id });
	}
	const file = await resolveAgentPageWritePath(context.pageRoot, step.path);
	await writeFile(file, content, "utf8");
	return { stepId: step.id, type: "text", value: step.path };
}

function isRedirectStatus(status: number): boolean {
	return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

async function fetchAllowed(
	step: Extract<AgentPageStep, { kind: "fetch" }>,
	context: StepExecutionContext,
): Promise<Response> {
	let url = parseAgentPageHttpUrl(step.url, `workflow.${step.id}.url`);
	for (let redirects = 0; redirects <= 5; redirects += 1) {
		assertAgentPagePermission(context.manifest.permissions, { permission: "network", url: url.href });
		const response = await context.fetchImpl(url.href, {
			method: "GET",
			redirect: "manual",
			signal: context.signal,
		});
		if (!isRedirectStatus(response.status)) {
			if (!response.ok) {
				throw new AgentPageError("step_failed", `Step "${step.id}" fetched HTTP ${response.status}`, 500, {
					stepId: step.id,
					status: response.status,
				});
			}
			return response;
		}
		const location = response.headers.get("location");
		if (location === null || location === "") {
			throw new AgentPageError("step_failed", `Step "${step.id}" got a redirect without Location`, 500, {
				stepId: step.id,
			});
		}
		if (redirects === 5) {
			throw new AgentPageError("step_failed", `Step "${step.id}" exceeded the redirect limit`, 500, {
				stepId: step.id,
			});
		}
		try {
			url = parseAgentPageHttpUrl(new URL(location, url).href, `workflow.${step.id}.url`);
		} catch {
			throw new AgentPageError("step_failed", `Step "${step.id}" redirected to an invalid URL`, 500, {
				stepId: step.id,
			});
		}
	}
	throw new AgentPageError("step_failed", `Step "${step.id}" exceeded the redirect limit`, 500, {
		stepId: step.id,
	});
}

async function runFetchStep(
	step: Extract<AgentPageStep, { kind: "fetch" }>,
	context: StepExecutionContext,
): Promise<AgentPageStepOutput> {
	const response = await fetchAllowed(step, context);
	const value = await response.text();
	return { stepId: step.id, type: "text", value };
}

async function runSpawnStep(
	step: Extract<AgentPageStep, { kind: "spawn" }>,
	context: StepExecutionContext,
): Promise<AgentPageStepOutput> {
	assertAgentPagePermission(context.manifest.permissions, { permission: "spawn", workflow: step.workflow });
	if (context.chain.includes(step.workflow)) {
		throw new AgentPageError("cycle", `Spawn cycle includes workflow "${step.workflow}"`, 409, {
			workflowId: step.workflow,
		});
	}
	if (context.chain.length >= context.maxSpawnDepth + 1) {
		throw new AgentPageError("limit_exceeded", `Workflow spawn depth exceeds ${context.maxSpawnDepth}`, 400, {
			workflowId: step.workflow,
		});
	}
	const child = await executeWorkflow(context, step.workflow, context.chain);
	const outputs: Record<string, AgentPageJsonValue> = {};
	for (const [stepId, output] of Object.entries(child.outputs)) {
		outputs[stepId] = { type: output.type, value: output.value };
	}
	return { stepId: step.id, type: "json", value: { workflow: step.workflow, outputs } };
}

async function executeStep(step: AgentPageStep, context: StepExecutionContext): Promise<AgentPageStepOutput> {
	switch (step.kind) {
		case "constant":
			return { stepId: step.id, type: agentPageStepOutputType(step), value: step.value };
		case "template":
			return context.limiter.run(async () => runTemplateStep(step, context), context.signal);
		case "read":
			return context.limiter.run(async () => runReadStep(step, context), context.signal);
		case "write":
			return context.limiter.run(async () => runWriteStep(step, context), context.signal);
		case "fetch":
			return context.limiter.run(async () => runFetchStep(step, context), context.signal);
		case "spawn":
			return runSpawnStep(step, context);
	}
}

async function executeWorkflow(
	context: WorkflowExecutionContext,
	workflowId: string,
	stack: readonly string[],
): Promise<WorkflowExecution> {
	throwIfCancelled(context.signal);
	const plan = context.plans.get(workflowId);
	if (plan === undefined) {
		throw new AgentPageError("unknown_workflow", `Unknown workflow: ${workflowId}`, 404, { workflowId });
	}
	const chain = [...stack, workflowId];
	const outputs = new Map<string, AgentPageStepOutput>();
	let firstError: unknown;
	const promises = new Map<string, Promise<AgentPageStepOutput>>();
	const stepContext: StepExecutionContext = {
		...context,
		outputs,
		chain,
	};
	const stepsById = new Map(plan.workflow.steps.map(step => [step.id, step]));

	for (const stepId of plan.order) {
		const step = stepsById.get(stepId);
		if (step === undefined) continue;
		const dependencies = plan.dependencies.get(step.id) ?? [];
		const promise = (async (): Promise<AgentPageStepOutput> => {
			const dependencyPromises = dependencies.map(dependency => {
				const promise = promises.get(dependency);
				if (promise === undefined) {
					throw new AgentPageError(
						"unknown_step",
						`Step "${step.id}" depends on unknown step "${dependency}"`,
						400,
						{
							workflowId,
							stepId: step.id,
							reference: dependency,
						},
					);
				}
				return promise;
			});
			await Promise.all(dependencyPromises);
			throwIfCancelled(context.signal);
			try {
				const output = await executeStep(step, stepContext);
				outputs.set(step.id, output);
				return output;
			} catch (error) {
				const failure = normalizeStepError(step, error, context.signal);
				if (firstError === undefined) {
					firstError = failure;
					// Stop unrelated in-flight steps. The first failure is retained
					// even when their aborts surface as `cancelled`.
					context.controller.abort(failure);
				}
				throw failure;
			}
		})();
		promises.set(step.id, promise);
	}

	await Promise.allSettled(promises.values());
	if (firstError !== undefined) throw firstError;
	throwIfCancelled(context.signal);
	const resultOutputs: Record<string, AgentPageStepOutput> = {};
	for (const step of plan.workflow.steps) {
		const output = outputs.get(step.id);
		if (output === undefined) {
			throw new AgentPageError("step_failed", `Step "${step.id}" produced no output`, 500, { stepId: step.id });
		}
		resultOutputs[step.id] = output;
	}
	return {
		pageId: context.manifest.id,
		workflowId,
		outputs: resultOutputs,
		order: plan.order,
	};
}

/**
 * Run one workflow. The returned promise rejects with an {@link AgentPageError}
 * whose `code` is one of `unknown_workflow`, `cycle`, `permission_denied`,
 * `cancelled`, or `step_failed`; callers map those codes to HTTP responses.
 */
export async function runAgentPageWorkflow(options: AgentPageWorkflowRunOptions): Promise<AgentPageWorkflowRunResult> {
	const startedAt = Date.now();
	const concurrency = normalizeConcurrency(options.concurrency);
	const maxSpawnDepth = normalizeSpawnDepth(options.maxSpawnDepth);
	if (options.signal?.aborted === true) throw cancelledError();
	const plans = preflightAgentPageWorkflows(options.manifest, options.workflowId, maxSpawnDepth);
	const controller = new AbortController();
	const signal = controller.signal;
	const forwardAbort = (): void => controller.abort(options.signal?.reason);
	if (options.signal !== undefined) {
		if (options.signal.aborted) throw cancelledError();
		options.signal.addEventListener("abort", forwardAbort, { once: true });
		if (options.signal.aborted) controller.abort(options.signal.reason);
	}
	try {
		const execution = await executeWorkflow(
			{
				manifest: options.manifest,
				pageRoot: options.pageRoot,
				plans,
				limiter: new ConcurrencyLimiter(concurrency),
				signal,
				controller,
				fetchImpl: options.fetchImpl ?? fetch,
				maxSpawnDepth,
			},
			options.workflowId,
			[],
		);
		return { ...execution, durationMs: Date.now() - startedAt };
	} finally {
		options.signal?.removeEventListener("abort", forwardAbort);
		controller.abort();
	}
}
