import { randomUUID } from "node:crypto";
import { isRecord } from "@linxiraos/pi-utils";
import type { AgentToolContext } from "@linxiraos/pi-agent-core";
import type { AgentSession } from "../../../session/agent-session";
import type {
	ExtensionUIContext,
	ExtensionUIDialogOptions,
	ExtensionAskDialogQuestion,
	ExtensionAskDialogResult,
} from "../../../extensibility/extensions";
import type { StudioPendingInteraction, RemoteInteractionRequest } from "../protocol/contracts/interactions.js";
import type { InteractionId, CommandId } from "../protocol/contracts/ids.js";
import { invalid, unavailable } from "../errors.js";

type RequestInput = RemoteInteractionRequest extends infer R
	? R extends RemoteInteractionRequest
		? Omit<R, "interactionId" | "commandId">
		: never
	: never;
interface Pending {
	request: RemoteInteractionRequest;
	resolve(value: unknown): void;
}

/** One native evaluation's prompts, independent of the renderer transport. */
export class EvaluationInteractionPort {
	#pending?: Pending;
	#owner?: string;
	#generation = 0;
	#closed = false;
	readonly #listeners = new Set<() => void>();
	constructor(
		readonly session: AgentSession,
		readonly abort: () => void,
	) {}
	subscribe(listener: () => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}
	#changed(): void {
		for (const listener of this.#listeners) listener();
	}
	isView(owner: string): boolean {
		return this.#owner === owner;
	}
	claim(owner: string): void {
		if (this.#owner === owner) return;
		this.#owner = owner;
		this.#generation++;
		this.#changed();
	}
	release(owner: string): void {
		if (this.#owner !== owner) return;
		this.#owner = undefined;
		this.#generation++;
		this.#changed();
	}
	pending(): StudioPendingInteraction | undefined {
		return this.#pending
			? { request: this.#pending.request, owner: "gui", leaseGeneration: this.#generation }
			: undefined;
	}
	async #request(input: RequestInput, options?: ExtensionUIDialogOptions): Promise<unknown> {
		if (this.#closed || this.#pending) throw unavailable("evaluation interaction is closed or already pending");
		options?.signal?.throwIfAborted();
		if (Buffer.byteLength(JSON.stringify(input)) > 256_000)
			throw invalid("evaluation review exceeds 256 KiB; inspect the full materials in its workspace");
		const { promise, resolve } = Promise.withResolvers<unknown>();
		const pending: Pending = {
			request: {
				...input,
				interactionId: randomUUID() as InteractionId,
				commandId: randomUUID() as CommandId,
			} as RemoteInteractionRequest,
			resolve,
		};
		this.#pending = pending;
		this.#generation++;
		const cancel = () => resolve(undefined);
		options?.signal?.addEventListener("abort", cancel, { once: true });
		this.#changed();
		try {
			return await promise;
		} finally {
			options?.signal?.removeEventListener("abort", cancel);
			if (this.#pending === pending) this.#pending = undefined;
			this.#changed();
		}
	}
	async respond(input: {
		interactionId: string;
		leaseGeneration: number;
		decision: "submit" | "cancel";
		value?: unknown;
	}): Promise<void> {
		const pending = this.#pending;
		if (
			!this.#owner ||
			!pending ||
			pending.request.interactionId !== input.interactionId ||
			this.#generation !== input.leaseGeneration
		)
			throw invalid("evaluation interaction lease is stale");
		if (input.decision !== "submit" && input.decision !== "cancel") throw invalid("invalid interaction decision");
		let value = input.decision === "submit" ? input.value : undefined;
		if (value !== undefined && Buffer.byteLength(JSON.stringify(value)) > 256_000)
			throw invalid("evaluation answer exceeds 256 KiB");
		if (input.decision === "submit") {
			const request = pending.request;
			if (request.kind === "input" || request.kind === "editor") {
				if (typeof value !== "string" || value.length > 128_000)
					throw invalid("interaction answer must be bounded text");
			} else if (request.kind === "confirm") {
				if (typeof value !== "boolean") throw invalid("confirmation answer must be boolean");
			} else if (request.kind === "select") {
				if (typeof value !== "string" || !request.options.some(option => option.id === value))
					throw invalid("unknown interaction option");
				value = request.options.find(option => option.id === value)!.label;
			} else if (request.kind === "ask") {
				if (!isRecord(value) || !Array.isArray(value.results) || value.results.length !== request.questions.length)
					throw invalid("invalid native review answer");
				const answers: unknown[] = value.results;
				value = {
					kind: "submit",
					results: request.questions.map(question => {
						const answer = answers.find(item => isRecord(item) && item.id === question.id);
						if (
							!isRecord(answer) ||
							!Array.isArray(answer.selectedOptions) ||
							answer.selectedOptions.some(id => !question.options.some(option => option.id === id)) ||
							(!question.multiple && answer.selectedOptions.length > 1)
						)
							throw invalid("invalid review selection");
						if (
							(answer.customInput !== undefined && typeof answer.customInput !== "string") ||
							(answer.note !== undefined && typeof answer.note !== "string")
						)
							throw invalid("invalid review note");
						return {
							id: question.id,
							question: question.question,
							options: question.options.map(option => option.label),
							multi: question.multiple === true,
							selectedOptions: answer.selectedOptions.map(
								id => question.options.find(option => option.id === id)!.label,
							),
							...(answer.customInput === undefined ? {} : { customInput: answer.customInput }),
							...(answer.note === undefined ? {} : { note: answer.note }),
						};
					}),
				} satisfies ExtensionAskDialogResult;
			}
		}
		this.#pending = undefined;
		pending.resolve(value);
		this.#changed();
	}
	context(signal?: AbortSignal): AgentToolContext {
		const base = this.session.getEvalToolSession()?.getToolContext?.();
		const dialog = (options?: ExtensionUIDialogOptions): ExtensionUIDialogOptions => ({
			...options,
			signal: signal && options?.signal ? AbortSignal.any([signal, options.signal]) : (signal ?? options?.signal),
		});
		// Inherit the gateway UI through the prototype chain instead of spreading it:
		// the gateway exposes `theme` as an enumerable throwing getter, so an object
		// spread would read it before the evaluation dialog can even open.
		const ui = Object.assign(Object.create(base?.ui ?? null), {
			select: async (
				title: string,
				options: Parameters<ExtensionUIContext["select"]>[1],
				settings?: ExtensionUIDialogOptions,
			) =>
				this.#request(
					{
						kind: "select",
						title,
						options: options.map((option, index) => ({
							id: String(index),
							...(typeof option === "string" ? { label: option } : option),
						})),
					},
					dialog(settings),
				) as Promise<string | undefined>,
			confirm: async (title: string, message: string, settings?: ExtensionUIDialogOptions) =>
				(await this.#request({ kind: "confirm", title, message }, dialog(settings))) === true,
			input: async (title: string, placeholder?: string, settings?: ExtensionUIDialogOptions) =>
				this.#request({ kind: "input", title, placeholder }, dialog(settings)) as Promise<string | undefined>,
			editor: async (title: string, content?: string, settings?: ExtensionUIDialogOptions) =>
				this.#request({ kind: "editor", title, content }, dialog(settings)) as Promise<string | undefined>,
			askDialog: async (questions: ExtensionAskDialogQuestion[], settings?: ExtensionUIDialogOptions) =>
				this.#request(
					{
						kind: "ask",
						title: questions[0]?.header ?? "Evaluation review",
						acceptImages: false,
						questions: questions.map(question => ({
							id: question.id,
							question: question.question,
							header: question.header,
							multiple: question.multi,
							recommended: question.recommended,
							options: question.options.map((option, index) => ({ id: String(index), ...option })),
						})),
					},
					dialog(settings),
				) as Promise<ExtensionAskDialogResult | undefined>,
		}) as ExtensionUIContext;
		// Do not inherit a terminal form surface or direct a subagent's cancellation into the main turn.
		delete ui.formDialog;
		return { ...this.session.buildAskReanswerContext(ui), abort: this.abort };
	}
	close(): void {
		this.#closed = true;
		this.#pending?.resolve(undefined);
		this.#pending = undefined;
		this.#listeners.clear();
	}
}
