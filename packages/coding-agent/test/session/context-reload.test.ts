/**
 * REQ057 — context-reload service behaviour.
 *
 * Meaningful prompt-cache semantics (byte change re-keys, unchanged bytes do not) are
 * asserted through the provider request in the integration test; these cases pin the
 * trigger: atomic replace, no-change stability, the 65th-file rotation, stopped refreshes,
 * and watcher disposal.
 */
import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	createContextReloadService,
	type ContextReloadService,
	type WatchHandle,
} from "@linxiraos/zeta/session/context-reload";

const tempDirs: string[] = [];

function makeDir(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-context-reload-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A watched file whose path stays fixed while its bytes are atomically replaced. */
function atomicReplace(filePath: string, content: string): void {
	const next = `${filePath}.${process.pid}.tmp`;
	fs.writeFileSync(next, content);
	fs.renameSync(next, filePath);
}

function serviceFor(
	paths: () => readonly string[],
	options: {
		refreshes?: { count: number };
		maxFiles?: number;
		watchDirectory?: (directory: string, onChange: () => void) => WatchHandle | undefined;
	} = {},
): ContextReloadService {
	const refreshes = options.refreshes ?? { count: 0 };
	return createContextReloadService({
		readWatchPaths: paths,
		refresh: async isCurrent => {
			if (!isCurrent()) return;
			refreshes.count++;
		},
		// Directory events are exercised through the injected seam; no real watchers here.
		watch: true,
		maxFiles: options.maxFiles,
		watchDirectory: options.watchDirectory ?? (() => ({ close: () => {} })),
	});
}

describe("context-reload service", () => {
	it("treats an atomic replace as a change exactly once", async () => {
		const dir = makeDir();
		const file = path.join(dir, "AGENTS.md");
		fs.writeFileSync(file, "first version\n");
		const counters = { count: 0 };
		const service = serviceFor(() => [file], { refreshes: counters });

		expect(await service.beforeRequest()).toBe(false); // seed only
		expect(counters.count).toBe(0);

		atomicReplace(file, "second version, longer\n");
		expect(await service.beforeRequest()).toBe(true);
		expect(counters.count).toBe(1);
		// Nothing moved since: no second rebuild, so the prompt cache key can stay.
		expect(await service.beforeRequest()).toBe(false);
		expect(counters.count).toBe(1);
	});

	it("a byte-identical rewrite rebuilds once and then stays quiet", async () => {
		const dir = makeDir();
		const file = path.join(dir, "AGENTS.md");
		fs.writeFileSync(file, "same bytes\n");
		const counters = { count: 0 };
		const service = serviceFor(() => [file], { refreshes: counters });
		await service.beforeRequest();

		// The mtime moves even though the bytes did not: one rebuild is requested, and
		// `samePromptBlocks` in the refresh keeps the cache key unchanged.
		atomicReplace(file, "same bytes\n");
		expect(await service.beforeRequest()).toBe(true);
		expect(await service.beforeRequest()).toBe(false);
		expect(counters.count).toBe(1);
	});

	it("covers the 65th file on the next turn instead of starving it", async () => {
		const dir = makeDir();
		const files = Array.from({ length: 65 }, (_, index) => path.join(dir, `f${index}.md`));
		for (const file of files) fs.writeFileSync(file, "v1\n");
		const counters = { count: 0 };
		const service = serviceFor(() => files, { refreshes: counters, maxFiles: 64 });
		await service.beforeRequest();

		// The seed consumed the first window (0..63); the rotation continues at 64, so the
		// file outside that window is stat'ed before any blind spot can persist.
		atomicReplace(files[64]!, "v2\n");
		expect(await service.beforeRequest()).toBe(true);
		expect(counters.count).toBe(1);
		expect(await service.beforeRequest()).toBe(false);
	});

	it("treats a changed watch set (added or removed path) as a change", async () => {
		const dir = makeDir();
		const first = path.join(dir, "a.md");
		fs.writeFileSync(first, "a\n");
		let paths = [first];
		const counters = { count: 0 };
		const service = serviceFor(() => paths, { refreshes: counters });
		await service.beforeRequest();

		const second = path.join(dir, "b.md");
		fs.writeFileSync(second, "b\n");
		paths = [first, second];
		expect(await service.beforeRequest()).toBe(true);
		expect(counters.count).toBe(1);
	});

	it("keeps the service dirty when a newer change lands during a rebuild", async () => {
		const dir = makeDir();
		const file = path.join(dir, "AGENTS.md");
		fs.writeFileSync(file, "v1\n");
		const counters = { count: 0 };
		let bumpDuringRefresh = true;
		const service = createContextReloadService({
			readWatchPaths: () => [file],
			watch: false,
			refresh: async isCurrent => {
				if (!isCurrent()) return;
				counters.count++;
				if (bumpDuringRefresh) {
					bumpDuringRefresh = false;
					// A watcher event while the rebuild runs must survive into the next boundary.
					service.markDirty();
				}
			},
		});
		await service.beforeRequest(); // seed
		atomicReplace(file, "v2\n");

		expect(await service.beforeRequest()).toBe(true);
		expect(service.dirty).toBe(true);
		expect(await service.beforeRequest()).toBe(true); // still dirty: rebuild again, then settle
		expect(service.dirty).toBe(false);
		expect(counters.count).toBe(2);
	});

	it("drops a refresh whose generation was superseded before it commits", async () => {
		const dir = makeDir();
		const file = path.join(dir, "AGENTS.md");
		fs.writeFileSync(file, "v1\n");
		let committed = 0;
		let service: ContextReloadService;
		service = createContextReloadService({
			readWatchPaths: () => [file],
			watch: false,
			refresh: async isCurrent => {
				// Supersede this reload mid-flight; the service must not commit its observation.
				service.markDirty();
				if (isCurrent()) committed++;
			},
		});
		await service.beforeRequest(); // seed
		atomicReplace(file, "v2\n");
		await service.beforeRequest();
		expect(committed).toBe(0);
		expect(service.dirty).toBe(true);
	});

	it("stops its watchers on dispose and ignores later signals", async () => {
		const dir = makeDir();
		const file = path.join(dir, "AGENTS.md");
		fs.writeFileSync(file, "v1\n");
		const closed: string[] = [];
		const service = serviceFor(() => [file], {
			watchDirectory: directory => ({ close: () => closed.push(directory) }),
		});
		await service.beforeRequest();
		service.dispose();
		expect(closed).toContain(dir);
		expect(service.dirty).toBe(false);
		// A disposed service neither refreshes nor re-arms: the session is gone.
		expect(await service.beforeRequest()).toBe(false);
		service.markDirty();
		expect(service.dirty).toBe(false);
		expect(closed).toEqual([dir]);
		service.dispose(); // idempotent
	});

	it("a fresh service seeds without replaying changes from the previous one", async () => {
		const dir = makeDir();
		const file = path.join(dir, "AGENTS.md");
		fs.writeFileSync(file, "v1\n");
		const counters = { count: 0 };
		const first = serviceFor(() => [file], { refreshes: counters });
		await first.beforeRequest();
		atomicReplace(file, "v2\n");
		first.dispose();

		const second = serviceFor(() => [file], { refreshes: counters });
		expect(await second.beforeRequest()).toBe(false); // baseline, not a change
		expect(counters.count).toBe(0);
	});
});
