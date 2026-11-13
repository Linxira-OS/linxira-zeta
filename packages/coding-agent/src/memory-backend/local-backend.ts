import {
	buildMemoryToolDeveloperInstructions,
	clearMemoryData,
	clearMemoryToolDeveloperInstructionsCache,
	enqueueLocalMemory,
	learnMemoryWindow,
	saveLearnedLesson,
	startMemoryStartupTask,
} from "../memories";
import type { MemoryBackend } from "./types";

/**
 * Wraps the existing `memories/` module as a `MemoryBackend`.
 *
 * The rollout-summarisation pipeline (rollouts → SQLite → memory_summary.md) is
 * delegated unchanged. On top of it, `save()` persists `learn`-tool lessons to
 * `learned.md` (so `status()` reports `writable: true`); structured search is
 * still unavailable.
 */
export const localBackend: MemoryBackend = {
	id: "local",
	start(options) {
		startMemoryStartupTask(options);
	},
	learnWindow: learnMemoryWindow,
	async buildDeveloperInstructions(agentDir, cwd, settings, session) {
		return buildMemoryToolDeveloperInstructions(agentDir, cwd, settings, session);
	},
	async clear(agentDir, cwd, session) {
		clearMemoryToolDeveloperInstructionsCache(session);
		await clearMemoryData(agentDir, cwd);
	},
	async enqueue(agentDir, cwd, session) {
		await enqueueLocalMemory(agentDir, cwd, session);
	},
	async save(context, input) {
		return saveLearnedLesson(
			context.agentDir,
			context.cwd,
			input,
			context.session?.sessionManager?.getMemoryNamespace?.(),
		);
	},
	async status() {
		return {
			backend: "local" as const,
			active: true,
			writable: true,
			searchable: false,
			message:
				"Local rollout-summary memory is active; lessons from the `learn` tool are saved to learned.md. Structured search is not available.",
		};
	},
};
