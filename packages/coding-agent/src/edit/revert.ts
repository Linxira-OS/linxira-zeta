import * as fs from "node:fs";
import { logger } from "@linxiraos/pi-utils";
import { editBlackboxPath, readEditBlackbox, type EditBlackboxEntry } from "./blackbox";

/** Why a revert did or did not happen. */
export type RevertOutcome =
	| { status: "reverted"; entry: EditBlackboxEntry; path: string }
	| { status: "unrecorded"; path: string }
	| { status: "missing"; path: string }
	| { status: "diverged"; path: string; entry: EditBlackboxEntry }
	| { status: "read-failed"; path: string; reason: string };

/**
 * Restore one file to the content it held before its most recent recorded edit.
 *
 * The revert is refused when the file on disk no longer matches the `new` side of
 * the newest entry for that path. That single check is what makes this safe to
 * offer at all: everything the log does not know about — an edit made through
 * `bash`, a hand edit, a second agent — would be silently destroyed by a blind
 * write-back, and "restore my file" is exactly the request under which a
 * surprise overwrite does the most damage.
 *
 * On success a new entry is appended recording the revert itself, so the log
 * stays a truthful sequence rather than one that claims a state that never
 * existed.
 */
export async function revertLastEdit(
	agentDir: string,
	targetPath: string,
	absolutePath: string,
): Promise<RevertOutcome> {
	const entries = await readEditBlackbox(agentDir, { path: targetPath });
	const entry = entries.at(-1);
	if (!entry) return { status: "unrecorded", path: targetPath };

	let current: string;
	try {
		current = await fs.promises.readFile(absolutePath, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return { status: "missing", path: targetPath };
		}
		return { status: "read-failed", path: targetPath, reason: (error as Error).message };
	}

	if (current !== entry.new) {
		return { status: "diverged", path: targetPath, entry };
	}

	try {
		await Bun.write(absolutePath, entry.prev);
		await fs.promises.appendFile(
			editBlackboxPath(agentDir),
			`${JSON.stringify({
				path: targetPath,
				prev: current,
				new: entry.prev,
				model: "revert",
				variant: entry.variant,
				arg: { revertedEntry: entries.length },
			})}\n`,
		);
	} catch (error) {
		logger.debug("Revert write failed", { path: absolutePath, error: (error as Error).message });
		return { status: "read-failed", path: targetPath, reason: (error as Error).message };
	}
	return { status: "reverted", entry, path: targetPath };
}
