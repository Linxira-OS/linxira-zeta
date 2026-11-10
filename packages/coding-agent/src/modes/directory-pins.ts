/**
 * Pinned directories for the `/cd` picker (`<agent dir>/directory-pins.json`).
 *
 * Pins are absolute paths the user navigates to often. They live in the config
 * root beside the other picker state, never in the home directory, and the
 * read-modify-write runs under the shared cross-process lock with an atomic
 * replace so two zetacode instances cannot drop each other's pin.
 */
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getAgentDir, isEnoent, logger } from "@linxiraos/pi-utils";
import { withFileLock } from "@linxiraos/pi-utils/file-lock";

import { replaceFileAtomically } from "../utils/atomic-file";

export const DIRECTORY_PINS_FILENAME = "directory-pins.json";

/** Absolute path of the pins file. */
export function directoryPinsPath(agentDir: string = getAgentDir()): string {
	return path.join(agentDir, DIRECTORY_PINS_FILENAME);
}

/** Pinned directories, most recently pinned first. A corrupt file degrades to empty. */
export async function loadDirectoryPins(agentDir: string = getAgentDir()): Promise<string[]> {
	try {
		const content: unknown = JSON.parse(await fs.readFile(directoryPinsPath(agentDir), "utf-8"));
		const pins = Array.isArray(content) ? content : (content as { pins?: unknown } | null)?.pins;
		if (!Array.isArray(pins)) return [];
		return pins.filter((entry): entry is string => typeof entry === "string" && path.isAbsolute(entry));
	} catch (error) {
		if (!isEnoent(error)) logger.debug("Ignoring an unreadable directory-pins file", { error: String(error) });
		return [];
	}
}

async function writeDirectoryPins(pins: readonly string[], agentDir: string): Promise<void> {
	const filePath = directoryPinsPath(agentDir);
	await fs.mkdir(agentDir, { recursive: true });
	const tmpPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
	try {
		await fs.writeFile(tmpPath, JSON.stringify({ version: 1, pins }, null, "\t"), { encoding: "utf-8", mode: 0o600 });
		await replaceFileAtomically(tmpPath, filePath);
	} catch (error) {
		await fs.rm(tmpPath, { force: true }).catch(() => {});
		throw error;
	}
}

/** Pin or unpin `directory`; returns whether it is pinned afterwards. */
export async function toggleDirectoryPin(directory: string, agentDir: string = getAgentDir()): Promise<boolean> {
	const target = path.resolve(directory);
	const filePath = directoryPinsPath(agentDir);
	return withFileLock(filePath, async () => {
		const pins = await loadDirectoryPins(agentDir);
		const alreadyPinned = pins.some(pin => pin === target);
		const next = alreadyPinned ? pins.filter(pin => pin !== target) : [target, ...pins];
		await writeDirectoryPins(next, agentDir);
		return !alreadyPinned;
	});
}
