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

/** Canonical stored form: absolute, normalized separators/`..`. */
export function canonicalDirectoryPin(pin: string): string {
	return path.resolve(pin);
}

/** Comparison key for a pin; Windows drive-letter case is not a distinct pin. */
export function directoryPinKey(pin: string): string {
	const canonical = canonicalDirectoryPin(pin);
	return process.platform === "win32" ? canonical.toLowerCase() : canonical;
}

function normalizePins(values: readonly string[]): string[] {
	const pins: string[] = [];
	const seen = new Set<string>();
	for (const value of values) {
		if (!path.isAbsolute(value)) continue;
		const canonical = canonicalDirectoryPin(value);
		const key = directoryPinKey(canonical);
		if (seen.has(key)) continue;
		seen.add(key);
		pins.push(canonical);
	}
	return pins;
}

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
		return normalizePins(pins.filter((entry): entry is string => typeof entry === "string"));
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
	const target = canonicalDirectoryPin(directory);
	const targetKey = directoryPinKey(target);
	const filePath = directoryPinsPath(agentDir);
	return withFileLock(filePath, async () => {
		const pins = await loadDirectoryPins(agentDir);
		const alreadyPinned = pins.some(pin => directoryPinKey(pin) === targetKey);
		const next = alreadyPinned ? pins.filter(pin => directoryPinKey(pin) !== targetKey) : [target, ...pins];
		await writeDirectoryPins(normalizePins(next), agentDir);
		return !alreadyPinned;
	});
}
