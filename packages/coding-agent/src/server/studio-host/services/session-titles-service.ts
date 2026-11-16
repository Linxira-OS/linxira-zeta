/**
 * `session.titles.inspect` — one batched, read-only title projection.
 *
 * Target rows come only from the selected session's own transcript bucket and
 * only after both the listed path and the bucket resolve inside the same real
 * directory. A body is read with `SessionManager.peekSessionTitle`, which never
 * opens, claims or migrates a session, and a stat identity check rejects a
 * transcript that changed while its metadata was read. No path, title slot or
 * raw cause crosses the wire.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { sanitizeText } from "@linxiraos/pi-utils";
import { LRUCache } from "@linxiraos/pi-utils/lru";
import type { AgentSession } from "../../../session/agent-session.js";
import { SessionManager } from "../../../session/session-manager.js";
import { splitCardTitle } from "../../../utils/title-card.js";
import { StudioOpError } from "../errors.js";
import type {
	SessionTitleCard,
	SessionTitleRow,
	SessionTitlesOperation,
	SessionTitlesResult,
} from "../protocol/contracts/session-titles.js";

function clean(value: string, max: number): string {
	return sanitizeText(value)
		.replace(/[\x00-\x1f]/g, " ")
		.trim()
		.slice(0, max);
}

function isWithin(root: string, candidate: string): boolean {
	const relative = path.relative(root, candidate);
	return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

function card(value: SessionTitleCard | undefined): SessionTitleCard | undefined {
	if (!value || typeof value.code !== "string" || !/^[A-Z0-9]{1,6}$/.test(value.code)) return;
	return {
		code: value.code,
		...(typeof value.emoji === "string" && value.emoji.length <= 32 && clean(value.emoji, 32)
			? { emoji: clean(value.emoji, 32) }
			: {}),
		...(typeof value.nf === "string" && /^nf-[a-z0-9_-]{1,125}$/.test(value.nf) ? { nf: value.nf } : {}),
	};
}

export class StudioSessionTitlesService {
	readonly #cache = new LRUCache<string, { identity: string; row: SessionTitleRow }>({ max: 128 });

	constructor(readonly session: AgentSession) {}

	async execute(operation: SessionTitlesOperation): Promise<SessionTitlesResult> {
		const check = () => {
			if (operation.sessionId !== this.session.sessionId)
				throw new StudioOpError("UNAVAILABLE", "Session changed during title inspection");
		};
		check();
		const manager = this.session.sessionManager;
		let targets: Awaited<ReturnType<typeof SessionManager.list>>;
		try {
			targets =
				operation.targetSessionIds.includes(operation.sessionId) && operation.targetSessionIds.length === 1
					? []
					: await SessionManager.list(manager.getCwd(), manager.getSessionDir());
		} catch {
			check();
			throw new StudioOpError("UNAVAILABLE", "Session transcript storage is unavailable");
		}
		check();
		let transcriptRoot: string | undefined;
		if (targets.length > 0) {
			try {
				transcriptRoot = await fs.realpath(manager.getSessionDir());
			} catch {
				transcriptRoot = undefined;
			}
		}
		const rows: SessionTitleRow[] = [];
		for (const id of operation.targetSessionIds) {
			check();
			if (id === operation.sessionId) {
				const title = manager.getSessionName(),
					nativeCard = card(manager.getSessionTitleCard());
				rows.push({
					sessionId: id,
					state: "available",
					...(title ? { title: clean(splitCardTitle(title)?.title ?? title, 1024) } : {}),
					...(manager.titleSource ? { source: manager.titleSource } : {}),
					...(title && nativeCard ? { card: nativeCard } : {}),
				});
				continue;
			}
			const target = targets.find(row => row.id === id);
			if (!target) {
				rows.push({ sessionId: id, state: "missing" });
				continue;
			}
			try {
				if (transcriptRoot === undefined) throw new Error("Session transcript storage is unavailable");
				const resolved = await fs.realpath(target.path);
				check();
				if (!isWithin(transcriptRoot, resolved)) throw new Error("Session transcript is outside this workspace");
				const stat = await fs.stat(resolved);
				check();
				if (!stat.isFile()) throw new Error("Session transcript is not a file");
				const identity = stat.dev + ":" + stat.ino + ":" + stat.size + ":" + stat.mtimeMs + ":" + stat.ctimeMs,
					cached = this.#cache.get(target.path);
				if (cached?.identity === identity && cached.row.sessionId === id) {
					rows.push(cached.row);
					continue;
				}
				const saved = await SessionManager.peekSessionTitle(resolved);
				check();
				const after = await fs.stat(resolved);
				check();
				if (
					saved.sessionId !== id ||
					after.size !== stat.size ||
					after.mtimeMs !== stat.mtimeMs ||
					after.ctimeMs !== stat.ctimeMs
				)
					throw new Error("Session changed while reading title metadata; refresh to try again");
				const nativeCard = card(saved.card),
					title = saved.title && clean(saved.title, 1024);
				const row: SessionTitleRow = {
					sessionId: id,
					state: "available",
					...(title ? { title } : {}),
					...(saved.source ? { source: saved.source } : {}),
					...(title && nativeCard ? { card: nativeCard } : {}),
				};
				this.#cache.set(target.path, { identity, row });
				rows.push(row);
			} catch (cause) {
				check();
				const message = cause instanceof Error ? cause.message : "";
				const reason = /incomplete or damaged/u.test(message)
					? "Saved session is incomplete or damaged"
					: /changed while reading/u.test(message)
						? "Session changed while reading title metadata; refresh to try again"
						: "Title metadata unavailable";
				rows.push({ sessionId: id, state: "unavailable", reason });
			}
		}
		check();
		return { rows };
	}
}
