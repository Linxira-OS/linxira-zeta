/**
 * Pi Messenger - Path Resolution
 *
 * Single source of truth for every directory this extension owns. State lives
 * in the zeta tree (getAgentDir() = ~/.zeta/agent), never in the legacy ~/.pi
 * tree — one-time migrations for pre-existing state live in
 * ./crew/utils/migrations.ts.
 */

import * as os from "node:os";
import * as path from "node:path";
import { getAgentDir } from "@linxiraos/pi-utils/dirs";

/**
 * Global messenger state (~/.zeta/agent/messenger by default).
 * PI_MESSENGER_DIR overrides — kept for test isolation and exotic setups.
 */
export function getGlobalMessengerDir(): string {
	return process.env.PI_MESSENGER_DIR || path.join(getAgentDir(), "messenger");
}

/** Global extension config (~/.zeta/agent/pi-messenger.json). */
export function getGlobalConfigPath(): string {
	return path.join(getAgentDir(), "pi-messenger.json");
}

/** Project messenger state (<project>/.zeta/messenger). */
export function getProjectMessengerDir(cwd: string): string {
	return path.join(cwd, ".zeta", "messenger");
}

/** Project crew state (<project>/.zeta/messenger/crew). */
export function getProjectCrewDir(cwd: string): string {
	return path.join(getProjectMessengerDir(cwd), "crew");
}

/** Project extension config (<project>/.zeta/pi-messenger.json). */
export function getProjectConfigPath(cwd: string): string {
	return path.join(cwd, ".zeta", "pi-messenger.json");
}

/**
 * Legacy trees this extension owned before the zeta migration. Read only by
 * crew/utils/migrations.ts to move pre-existing state out of them.
 */
export function getLegacyGlobalMessengerDir(homeDir = os.homedir()): string {
	return path.join(homeDir, ".pi", "agent", "messenger");
}

export function getLegacyGlobalConfigPath(homeDir = os.homedir()): string {
	return path.join(homeDir, ".pi", "agent", "pi-messenger.json");
}

export function getLegacyProjectMessengerDir(cwd: string): string {
	return path.join(cwd, ".pi", "messenger");
}

export function getLegacyProjectConfigPath(cwd: string): string {
	return path.join(cwd, ".pi", "pi-messenger.json");
}
