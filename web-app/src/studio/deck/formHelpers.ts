/**
 * Renderer-local copies of the terminal form helpers.
 *
 * The upstream Studio renderer imports `@linxiraos/pi-tui/html-form/*`. Those
 * modules are part of the TUI package and one of them imports the entire
 * `@linxiraos/pi-ai` source graph; pulling them into the browser build makes
 * web-app typecheck root provider sources under the browser's stricter
 * compiler settings. Keep the small, framework-free form helpers here and
 * share the Studio protocol types instead.
 */
import type {
	FormAnswerValue,
	FormChoiceField,
	FormSpan,
	FormTextField,
	InteractionFormField,
} from "@linxiraos/studio-protocol";

export const OTHER_LABEL = "Other";

export function spansText(spans: readonly FormSpan[]): string {
	return spans.map(span => span.text).join("");
}

export function isArrayChoice(field: FormChoiceField): boolean {
	return field.multi && field.options.length > 1;
}

export function choiceValue(
	field: FormChoiceField,
	checked: ReadonlySet<number>,
	other?: string,
): FormAnswerValue | undefined {
	const typed = field.other ? other?.trim() : undefined;
	const values = field.options.flatMap((option, index) =>
		checked.has(index) && !option.disabled ? [option.value] : [],
	);
	if (isArrayChoice(field)) return typed ? [...values, typed] : values;
	return typed || values[0];
}

export function textValue(field: FormTextField, text: string): FormAnswerValue {
	if ((field.type === "number" || field.type === "range") && text.trim() !== "") {
		const number = Number(text);
		if (Number.isFinite(number)) return number;
	}
	return text;
}

export function fieldError(field: InteractionFormField, value: FormAnswerValue | undefined): string | undefined {
	if (field.kind === "choice") {
		const empty = value === undefined || (Array.isArray(value) && value.length === 0);
		if (!field.required || !empty) return undefined;
		return isArrayChoice(field) ? "Select at least one" : "Required";
	}
	const text = value === undefined ? "" : String(value);
	if (text.trim() === "") return field.required ? "Required" : undefined;
	if (field.type === "number" || field.type === "range") {
		const number = Number(text);
		if (!Number.isFinite(number)) return "Enter a number";
		if (field.min !== undefined && number < field.min) return `Must be at least ${field.min}`;
		if (field.max !== undefined && number > field.max) return `Must be at most ${field.max}`;
	}
	if (field.minLength !== undefined && text.length < field.minLength)
		return `Needs at least ${field.minLength} characters`;
	if (field.maxLength !== undefined && text.length > field.maxLength) return `At most ${field.maxLength} characters`;
	if (field.type === "email" && !/^[^\s@]+@[^\s@]+$/.test(text)) return "Enter an email address";
	if (field.type === "url" && !URL.canParse(text)) return "Enter a full URL";
	if (field.pattern && compilePattern(field.pattern)?.test(text) === false) {
		return `Must match ${field.pattern.length > 40 ? `${field.pattern.slice(0, 39)}…` : field.pattern}`;
	}
	return undefined;
}

function compilePattern(pattern: string): RegExp | undefined {
	try {
		return new RegExp(`^(?:${pattern})$`, "v");
	} catch {
		return undefined;
	}
}
