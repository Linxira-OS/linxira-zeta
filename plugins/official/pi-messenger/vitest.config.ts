import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["tests/**/*.test.ts"],
		clearMocks: true,
		restoreMocks: true,
		// The crew tests dynamically re-import modules and replace them with mocks;
		// running files in parallel lets one worker observe another's real module.
		fileParallelism: false,
		isolate: true,
		pool: "forks",
		// One fork, one file at a time: a second worker must never load the real
		// module graph while another file's `vi.mock` factories are installed.
		poolOptions: { forks: { singleFork: true } },
		sequence: { shuffle: false },
	},
});
