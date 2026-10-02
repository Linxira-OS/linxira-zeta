import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const homedirMock = vi.hoisted(() => vi.fn());

vi.mock("node:os", async importOriginal => {
	const actual = await importOriginal<typeof import("node:os")>();
	return {
		...actual,
		homedir: homedirMock,
	};
});

// The migration targets resolve through getAgentDir(), whose resolver
// snapshots os.homedir at import time — re-import per test.
async function loadModule() {
	vi.resetModules();
	return import("../../../crew/utils/migrations.ts");
}

const roots: string[] = [];

function createTempRoot(): string {
	const root = fs.mkdtempSync(path.join(tmpdir(), "pi-messenger-migrations-test-"));
	roots.push(root);
	return root;
}

function writeJson(filePath: string, data: unknown): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, JSON.stringify(data));
}

describe("crew/utils/migrations", () => {
	let root: string;
	let home: string;

	beforeEach(() => {
		root = createTempRoot();
		home = path.join(root, "home");
		fs.mkdirSync(home, { recursive: true });
		homedirMock.mockReset();
		homedirMock.mockReturnValue(home);
	});

	afterEach(() => {
		for (const dir of roots) {
			try {
				fs.rmSync(dir, { recursive: true, force: true });
			} catch {}
		}
		roots.length = 0;
	});

	it("moves legacy global messenger state and config into the zeta tree", async () => {
		writeJson(path.join(home, ".pi", "agent", "messenger", "registry", "a.json"), { name: "a" });
		writeJson(path.join(home, ".pi", "agent", "pi-messenger.json"), { autoRegister: true });

		const { runStateDirMigrations } = await loadModule();
		const result = runStateDirMigrations({ homeDir: home });

		expect(result.ran).toBe(true);
		expect(result.errors).toEqual([]);
		expect(fs.existsSync(path.join(home, ".zeta", "agent", "messenger", "registry", "a.json"))).toBe(true);
		expect(fs.existsSync(path.join(home, ".zeta", "agent", "pi-messenger.json"))).toBe(true);
		expect(fs.existsSync(path.join(home, ".pi", "agent", "messenger"))).toBe(false);
		// The marker lives in the migrated tree so repeat loads are no-ops.
		expect(fs.existsSync(path.join(home, ".zeta", "agent", "messenger", "migrations", "zeta-state-dirs-v1.json"))).toBe(
			true,
		);
	});

	it("does not run twice and does not clobber an existing target", async () => {
		writeJson(path.join(home, ".pi", "agent", "pi-messenger.json"), { autoRegister: true });
		writeJson(path.join(home, ".zeta", "agent", "pi-messenger.json"), { feedRetention: 7 });

		const { runStateDirMigrations } = await loadModule();
		const first = runStateDirMigrations({ homeDir: home });

		// Target existed: legacy source stays put, nothing is overwritten.
		expect(first.moved).toEqual([]);
		expect(JSON.parse(fs.readFileSync(path.join(home, ".zeta", "agent", "pi-messenger.json"), "utf-8"))).toEqual({
			feedRetention: 7,
		});
		expect(fs.existsSync(path.join(home, ".pi", "agent", "pi-messenger.json"))).toBe(true);

		const second = runStateDirMigrations({ homeDir: home });
		expect(second.ran).toBe(false);
	});

	it("lazily moves project state on first touch", async () => {
		writeJson(path.join(root, "proj", ".pi", "messenger", "crew", "plan.json"), { prd: "docs/PRD.md" });
		writeJson(path.join(root, "proj", ".pi", "pi-messenger.json"), { trustProjectAgents: true });

		const { ensureProjectStateMigrated } = await loadModule();
		ensureProjectStateMigrated(path.join(root, "proj"));
		ensureProjectStateMigrated(path.join(root, "proj"));

		expect(fs.existsSync(path.join(root, "proj", ".zeta", "messenger", "crew", "plan.json"))).toBe(true);
		expect(fs.existsSync(path.join(root, "proj", ".zeta", "pi-messenger.json"))).toBe(true);
		expect(fs.existsSync(path.join(root, "proj", ".pi", "messenger"))).toBe(false);
		expect(fs.existsSync(path.join(root, "proj", ".pi", "pi-messenger.json"))).toBe(false);
	});

	it("leaves projects without legacy state untouched", async () => {
		const { ensureProjectStateMigrated } = await loadModule();
		ensureProjectStateMigrated(root);

		expect(fs.existsSync(path.join(root, ".zeta"))).toBe(false);
		expect(fs.existsSync(path.join(root, ".pi"))).toBe(false);
	});
});
