import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { isEnoent, withFileLock } from "@linxiraos/pi-utils";
import { writeFileAtomically } from "../utils/atomic-file";
import type { MemoryLearningWindow } from "./window-types";

export interface QueuedLearningWindow extends MemoryLearningWindow {
	entryIds: string[];
	memory: boolean;
	taste: boolean;
	memoryDone?: boolean;
	tasteDone?: boolean;
	attempts: number;
	error?: string;
}

interface LearningJournal {
	version: 1;
	processed: string[];
	entries: string[];
	pending: QueuedLearningWindow[];
}

function digest(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

/** Session journal: the cursor and queued source bytes publish in the same atomic write. */
export class WindowLearningQueue {
	readonly file: string;

	constructor(agentDir: string, namespace: string, sessionId: string) {
		if (!namespace) throw new Error("Window learning requires an SDK-resolved namespace");
		this.file = path.join(agentDir, "memories", "window-learning", digest(namespace), `${digest(sessionId)}.json`);
	}

	async #read(): Promise<LearningJournal> {
		try {
			const value = await Bun.file(this.file).json() as LearningJournal;
			if (value.version !== 1 || !Array.isArray(value.pending) || !Array.isArray(value.entries) || !Array.isArray(value.processed)) {
				throw new Error(`Invalid window learning journal: ${this.file}`);
			}
			return value;
		} catch (error) {
			if (isEnoent(error)) return { version: 1, processed: [], entries: [], pending: [] };
			throw error;
		}
	}

	async #mutate<T>(fn: (state: LearningJournal) => T): Promise<T> {
		await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
		return withFileLock(this.file, async () => {
			const state = await this.#read();
			const result = fn(state);
			await writeFileAtomically(this.file, `${JSON.stringify(state)}\n`);
			return result;
		});
	}

	/** `messages` are already detached copies captured before the compaction hook returns. */
	async capture(input: Omit<QueuedLearningWindow, "attempts">): Promise<void> {
		await this.#mutate(state => {
			if (state.processed.includes(input.id) || state.pending.some(item => item.id === input.id)) return;
			const seen = new Set(state.entries);
			const messages = input.messages.filter((_message, index) => !seen.has(input.entryIds[index]!));
			const entryIds = input.entryIds.filter(id => !seen.has(id));
			state.entries.push(...entryIds);
			if (messages.length === 0) state.processed.push(input.id);
			else state.pending.push({ ...input, messages, entryIds, attempts: 0 });
		});
	}

	async pending(): Promise<QueuedLearningWindow[]> {
		return (await this.#read()).pending;
	}

	/** Serial across processes as well as lifecycle retries; never called inside a commit listener. */
	async process(run: (window: QueuedLearningWindow, checkpoint: () => Promise<void>) => Promise<void>): Promise<void> {
		await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
		await withFileLock(`${this.file}.processing`, async () => {
			for (const window of await this.pending()) {
				const checkpoint = () => this.#mutate(state => {
					const index = state.pending.findIndex(item => item.id === window.id);
					if (index >= 0) state.pending[index] = window;
				});
				window.attempts++;
				try {
					await run(window, checkpoint);
					await this.#mutate(state => {
						state.pending = state.pending.filter(item => item.id !== window.id);
						state.processed.push(window.id);
					});
				} catch (error) {
					window.error = error instanceof Error ? error.message : String(error);
					await checkpoint();
					throw error;
				}
			}
		}, { retries: 1, retryDelayMs: 1 });
	}
}
