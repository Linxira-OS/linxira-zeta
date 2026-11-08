/**
 * Offline token counting for the Studio workbench.
 *
 * Split out of `ops/operator.ts` so the token math can be imported (and tested)
 * without pulling the operation gateway into the module graph: `operator.ts`
 * imports `../gateway.js`, which reaches the web gateway and back into this
 * package's operation registry.
 *
 * Uses the embedded tokenizers (`@linxiraos/pi-natives`), the same engine
 * `zetacode toks` reports. No model request, no network.
 */
import * as natives from "@linxiraos/pi-natives";
import type { TokenCountResult } from "../protocol/index.js";

/**
 * Human encoder labels, mirroring the CLI's own display table
 * (`commands/toks.ts`). `natives.Encoding` values are PascalCase wire ids, and
 * the Renderer prints `encoding` as the tokenizer name.
 */
const ENCODING_LABELS: Readonly<Record<natives.Encoding, string>> = {
	[natives.Encoding.O200kBase]: "o200k_base",
	[natives.Encoding.Cl100kBase]: "cl100k_base",
	[natives.Encoding.ClaudeV3]: "claude-v3",
	[natives.Encoding.ClaudeV47]: "claude-v47",
	[natives.Encoding.ClaudeV5]: "claude-v5",
	[natives.Encoding.ClaudeV5Sonnet]: "claude-v5-sonnet",
	[natives.Encoding.Qwen3]: "qwen3",
	[natives.Encoding.DeepSeekV3]: "deepseek-v3",
	[natives.Encoding.KimiK2]: "kimi-k2",
	[natives.Encoding.Glm5]: "glm5",
	[natives.Encoding.Jev]: "jev",
};

/** Unicode scalar count: UTF-16 length minus the trailing half of each surrogate pair. */
function countChars(text: string): number {
	let low = 0;
	for (let index = 0; index < text.length; index++) {
		const code = text.charCodeAt(index);
		if (code >= 0xdc00 && code <= 0xdfff) low++;
	}
	return text.length - low;
}

/** Lines as the editor counts them: a trailing newline does not open a new line. */
function countLines(text: string): number {
	if (text.length === 0) return 0;
	let lines = 0;
	for (let index = text.indexOf("\n"); index !== -1; index = text.indexOf("\n", index + 1)) lines++;
	return text.endsWith("\n") ? lines : lines + 1;
}

/** Count `text` with every embedded offline tokenizer. */
export function countText(text: string): TokenCountResult {
	return {
		bytes: Buffer.byteLength(text, "utf-8"),
		chars: countChars(text),
		lines: countLines(text),
		encodings: Object.values(natives.Encoding).map(encoding => ({
			encoding: ENCODING_LABELS[encoding],
			tokens: natives.countTokens(text, encoding),
		})),
	};
}
