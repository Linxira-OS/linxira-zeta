/**
 * Shared `ask` dialog answer validation.
 *
 * One validator for every host that speaks the rich multi-question `ask`
 * dialog: stdio RPC (`modes/rpc/rpc-mode.ts`) and the web gateway
 * (`server/web-gateway/agents.ts`). Hosts send the answers over their own
 * transport, but the rules — one answer per question in request order, exact
 * ids, known option labels, no duplicates, single-select exclusivity, string
 * free text/notes — live here so the two channels cannot drift.
 *
 * Validation is strict on purpose: any mismatch throws instead of guessing
 * (fail-closed). Hosts surface that rejection to the extension, so an
 * unanswered/malformed dialog can never be silently read as an answer.
 */
import { isRecord } from "@linxiraos/pi-utils";
import type { ExtensionAskDialogSubmitResult } from "@linxiraos/pi-tui/overlays/ask-dialog";
import type { ExtensionAskDialogQuestion, ExtensionUIDialogOptions } from "./types";

/** One question's answer, as sent by the host. */
export interface AskDialogAnswer {
	id: string;
	/** Exact option labels the user chose (possibly empty for multi-select). */
	selectedOptions: string[];
	/** Free text typed instead of choosing an option. */
	customInput?: string;
	/** Free-text note attached to the answer (web AskCard). */
	note?: string;
}

/** Transport-neutral `extension_ui_response` payload answering an `ask` request. */
export interface AskDialogResponseInput {
	/** Host deadline elapsed: the host answered nothing and expects the recommended fallback. */
	cancelled?: boolean;
	timedOut?: boolean;
	/** One {@link AskDialogAnswer} per question, in request order. */
	answers?: unknown;
	/**
	 * Host frames carry more keys (`id`, `value`, `confirmed`, …); this view
	 * reads only the three above, and stays assignable from every host's
	 * response union because it is deliberately open.
	 */
	[key: string]: unknown;
}

/** Validates `ask` answers against the questions; any mismatch throws instead of guessing. */
export function parseAskDialogResponse(
	response: AskDialogResponseInput,
	questions: ExtensionAskDialogQuestion[],
	dialogOptions: ExtensionUIDialogOptions,
): ExtensionAskDialogSubmitResult | undefined {
	if (response.cancelled) {
		if (response.timedOut) dialogOptions.onTimeout?.();
		return undefined;
	}
	const answers: unknown = response.answers;
	if (!Array.isArray(answers) || answers.length !== questions.length) {
		throw new Error(`Ask dialog response must carry ${questions.length} answers in question order`);
	}
	return {
		kind: "submit",
		results: questions.map((question, index) => {
			const answer: unknown = answers[index];
			if (!isRecord(answer) || answer.id !== question.id) {
				throw new Error(`Ask dialog answer ${index} must have id ${JSON.stringify(question.id)}`);
			}
			const labels = question.options.map(option => option.label);
			const multi = question.multi ?? false;
			const { selectedOptions, customInput, note, customInputImages, noteImages } = answer;
			if (!Array.isArray(selectedOptions)) {
				throw new Error(`Ask dialog answer ${JSON.stringify(question.id)} must carry a selectedOptions array`);
			}
			// Rich dialogs may attach pasted images; this channel carries text
			// only, so reject them instead of dropping them silently.
			for (const attachments of [customInputImages, noteImages]) {
				if (attachments !== undefined && (!Array.isArray(attachments) || attachments.length > 0)) {
					throw new Error(
						`Ask dialog answer ${JSON.stringify(question.id)} carries image attachments, which this channel does not support`,
					);
				}
			}
			const selected: string[] = [];
			for (const label of selectedOptions) {
				if (typeof label !== "string" || !labels.includes(label)) {
					throw new Error(
						`Ask dialog answer ${JSON.stringify(question.id)} selected unknown option ${JSON.stringify(label)}`,
					);
				}
				if (selected.includes(label)) {
					throw new Error(
						`Ask dialog answer ${JSON.stringify(question.id)} selected ${JSON.stringify(label)} twice`,
					);
				}
				selected.push(label);
			}
			if (customInput !== undefined && typeof customInput !== "string") {
				throw new Error(`Ask dialog answer ${JSON.stringify(question.id)} customInput must be a string`);
			}
			if (note !== undefined && typeof note !== "string") {
				throw new Error(`Ask dialog answer ${JSON.stringify(question.id)} note must be a string`);
			}
			const custom = customInput?.trim() || undefined;
			if (!multi && (selected.length > 1 || (selected.length > 0 && custom !== undefined))) {
				throw new Error(
					`Ask dialog answer ${JSON.stringify(question.id)} is single-select but carries more than one answer`,
				);
			}
			return {
				id: question.id,
				question: question.question,
				options: labels,
				multi,
				selectedOptions: selected,
				customInput: custom,
				note: note?.trim() || undefined,
			};
		}),
	};
}
