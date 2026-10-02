/**
 * Pi Messenger - State Directory Migrations
 *
 * One-time migrations that move plugin state out of the legacy ~/.pi tree into
 * the zeta tree (see ./paths.ts). Follows the marker-file framework of
 * runLegacyAgentCleanupMigration (crew/utils/install.ts): each migration runs
 * at most once per machine, tracked by a marker file under the NEW messenger
 * directory.
 *
 * Project-level state cannot be migrated at load time (the extension only
 * knows about the current project), so ensureProjectStateMigrated runs lazily
 * on the first touch of a project's state per process and is naturally
 * idempotent: after a successful move the legacy directory is gone.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
	getGlobalConfigPath,
	getGlobalMessengerDir,
	getLegacyGlobalConfigPath,
	getLegacyGlobalMessengerDir,
	getLegacyProjectConfigPath,
	getLegacyProjectMessengerDir,
	getProjectConfigPath,
	getProjectMessengerDir,
} from "../../paths.ts";

const STATE_DIR_MIGRATION_MARKER = "zeta-state-dirs-v1.json";

export interface MigrationOptions {
	homeDir?: string;
	marker?: string;
}

export interface MigrationResult {
	ran: boolean;
	moved: string[];
	errors: string[];
}

function migrationMarkerDir(): string {
	return path.join(getGlobalMessengerDir(), "migrations");
}

/** Move a directory/file when the source exists and the target does not. */
function moveIfAbsent(src: string, dest: string, moved: string[], errors: string[]): void {
	if (!fs.existsSync(src) || fs.existsSync(dest)) return;
	try {
		fs.mkdirSync(path.dirname(dest), { recursive: true });
		fs.renameSync(src, dest);
		moved.push(dest);
	} catch (err) {
		errors.push(`Failed to move ${src} -> ${dest}: ${err instanceof Error ? err.message : String(err)}`);
	}
}

/**
 * One-time migration: relocate global messenger state and config from
 * ~/.pi/agent to the zeta agent directory. Safe to call on every extension
 * load; the marker file makes repeat calls no-ops.
 */
export function runStateDirMigrations(options: MigrationOptions = {}): MigrationResult {
	const markerPath = path.join(migrationMarkerDir(), options.marker ?? STATE_DIR_MIGRATION_MARKER);
	if (fs.existsSync(markerPath)) {
		return { ran: false, moved: [], errors: [] };
	}

	const moved: string[] = [];
	const errors: string[] = [];
	moveIfAbsent(
		getLegacyGlobalMessengerDir(options.homeDir),
		getGlobalMessengerDir(),
		moved,
		errors,
	);
	moveIfAbsent(
		getLegacyGlobalConfigPath(options.homeDir),
		getGlobalConfigPath(),
		moved,
		errors,
	);

	try {
		fs.mkdirSync(path.dirname(markerPath), { recursive: true });
		fs.writeFileSync(
			markerPath,
			JSON.stringify({ migratedAt: new Date().toISOString(), moved, errors }, null, 2),
		);
	} catch (err) {
		errors.push(`Failed to persist migration marker: ${err}`);
	}

	return { ran: true, moved, errors };
}

// Project migrations are keyed per cwd and run once per process. The rename is
// itself one-shot on disk (the legacy directory disappears), so this guard
// only avoids re-stat'ing on every call.
const migratedProjects = new Set<string>();

/**
 * Lazy per-project counterpart of runStateDirMigrations: moves
 * <project>/.pi/messenger and <project>/.pi/pi-messenger.json into the .zeta
 * tree. Never throws — callers are state helpers that must keep working even
 * if the rename fails (e.g. file lock); the legacy tree is simply left in
 * place and the new one is used from then on.
 */
export function ensureProjectStateMigrated(cwd: string): void {
	const projectRoot = path.resolve(cwd);
	if (migratedProjects.has(projectRoot)) return;
	migratedProjects.add(projectRoot);

	const moved: string[] = [];
	const errors: string[] = [];
	moveIfAbsent(getLegacyProjectMessengerDir(projectRoot), getProjectMessengerDir(projectRoot), moved, errors);
	moveIfAbsent(getLegacyProjectConfigPath(projectRoot), getProjectConfigPath(projectRoot), moved, errors);
	if (errors.length > 0 && process.env.PI_MESSENGER_DEBUG) {
		console.error("[pi-messenger] project state migration failed:", errors.join("; "));
	}
}

/** Test seam: forget migrated projects so a test can exercise the move again. */
export function __resetProjectMigrationsForTests(): void {
	migratedProjects.clear();
}
