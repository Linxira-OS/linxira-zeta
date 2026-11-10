/**
 * Long-message splitting shared by adapters with a hard platform limit.
 *
 * Every chunk stays within `limit` (code points are not split), and the split
 * prefers paragraph, then line, then word boundaries so markdown and code
 * fences survive as well as a plain-text channel allows. A hard cut is the
 * last resort — never an over-limit message.
 */

/** Split `text` into chunks of at most `limit` UTF-16 code units. */
export function splitText(text: string, limit: number): string[] {
	if (!Number.isFinite(limit) || limit <= 0) return [text];
	if (text.length <= limit) return [text];

	const chunks: string[] = [];
	let remaining = text;
	while (remaining.length > limit) {
		const candidates = ["\n\n", "\n", " "];
		let cut = -1;
		for (const separator of candidates) {
			const index = remaining.lastIndexOf(separator, limit);
			if (index > Math.floor(limit * 0.3)) {
				cut = index + separator.length;
				break;
			}
		}
		if (cut <= 0) {
			// Do not split a surrogate pair in half.
			cut = limit;
			const last = remaining.charCodeAt(cut - 1);
			if (last >= 0xd800 && last <= 0xdbff) cut -= 1;
		}
		chunks.push(remaining.slice(0, cut));
		remaining = remaining.slice(cut);
	}
	if (remaining !== "") chunks.push(remaining);
	return chunks.length > 0 ? chunks : [text];
}
