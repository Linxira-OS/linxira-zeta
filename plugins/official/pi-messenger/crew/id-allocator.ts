/**
 * Crew - ID Allocator
 *
 * Simple task ID allocation: task-1, task-2, ...
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getProjectCrewDir } from "../paths.ts";

/**
 * Scans existing tasks to determine the next sequence number.
 * Returns task ID in format: task-N
 */
export function allocateTaskId(cwd: string): string {
	const tasksDir = path.join(getProjectCrewDir(cwd), "tasks");

	let maxN = 0;
	if (fs.existsSync(tasksDir)) {
		for (const file of fs.readdirSync(tasksDir)) {
			const match = file.match(/^task-(\d+)\.json$/);
			if (match) {
				const n = parseInt(match[1], 10);
				if (n > maxN) maxN = n;
			}
		}
	}

	return `task-${maxN + 1}`;
}
