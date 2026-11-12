import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach } from "vitest";

const roots = new Set<string>();

export interface TempCrewDirs {
	root: string;
	cwd: string;
	crewDir: string;
	tasksDir: string;
	blocksDir: string;
}

export function createTempCrewDirs(): TempCrewDirs {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-messenger-test-"));
	roots.add(root);

	const cwd = root;
	const messengerDir = path.join(cwd, ".zeta", "messenger");
	const crewDir = path.join(messengerDir, "crew");
	const tasksDir = path.join(crewDir, "tasks");
	const blocksDir = path.join(crewDir, "blocks");

	fs.mkdirSync(tasksDir, { recursive: true });
	fs.mkdirSync(blocksDir, { recursive: true });

	return { root, cwd, crewDir, tasksDir, blocksDir };
}

/** Windows refuses directory symlinks without Developer Mode/admin; a junction
 *  is the privilege-free reparse point that gives the same canonical-path alias.
 *  POSIX keeps the plain directory symlink. */
export function linkDirectory(target: string, alias: string): void {
	fs.symlinkSync(target, alias, process.platform === "win32" ? "junction" : "dir");
}

afterEach(() => {
	for (const root of roots) {
		try {
			fs.rmSync(root, { recursive: true, force: true });
		} catch {}
	}
	roots.clear();
});
