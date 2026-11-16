import { homedir } from "node:os";
import { sanitizeText } from "@linxiraos/pi-utils";
import { conversationRedactKey } from "../protocol/contracts/conversation.js";

/** Private native reports are retained verbatim; only this projection crosses HTTP. */
export class EvaluationPublicProjection {
	readonly #privateText: string[];
	constructor(paths: readonly string[] = []) {
		this.#privateText = [...new Set([...paths, homedir()])].filter(value => value.length > 3).sort((a, b) => b.length - a.length);
	}
	text(value: string): string {
		let text = sanitizeText(value);
		for (const privateText of this.#privateText) {
			text = text.replaceAll(privateText, "[private path]").replaceAll(privateText.replaceAll("\\", "/"), "[private path]");
		}
		return text
			.replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gu, "[redacted]")
			.replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})\b/gu, "[redacted]")
			.replace(/\b(?:Bearer\s+)[A-Za-z0-9._~+/=-]+/giu, "Bearer [redacted]")
			.replace(/\b((?:api[_-]?key|token|secret|password|authorization)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/giu, "$1[redacted]")
			.replace(/(["']?(?:api[_-]?key|token|secret|password|authorization)["']?\s*:\s*)"(?:\\.|[^"\\])*"/giu, "$1\"[redacted]\"")
			.replace(/\b(?:https?|wss?|file):\/\/[^\s<>"'`]+/giu, "[private endpoint]")
			.replace(/(?:[A-Za-z]:[\\/]|\\\\)[^\r\n<>"'`|]*/gu, "[private path]")
			.replace(/(^|[\s("'=])\/(?:home|Users|root|tmp|var|run|etc|mnt|opt|private)\/[^\s"'`<>)]*/gmu, "$1[private path]");
	}
	value<T>(value: T): T {
		const visit = (item: unknown, depth: number): unknown => {
			if (typeof item === "string") return this.text(item);
			if (item === null || typeof item !== "object") return item;
			if (depth > 24) return "[nested value omitted]";
			if (Array.isArray(item)) return item.map(child => visit(child, depth + 1));
			return Object.fromEntries(Object.entries(item).map(([key, child]) => [
				this.text(key),
				(!/^(?:maxTokens|max_tokens|cacheReadTokens|cacheWriteTokens|inputTokens|outputTokens|totalTokens|tokens|tokensBefore|contextTokens|tokenUsage|tokensPerSecond)$/iu.test(key) && conversationRedactKey(key)) || /^(?:baseUrl|endpoint|socketPath|socketDirectory|mediaDirectory|workspace|cwd|source)$/iu.test(key)
					? "[private]" : visit(child, depth + 1),
			]));
		};
		return visit(value, 0) as T;
	}
}
