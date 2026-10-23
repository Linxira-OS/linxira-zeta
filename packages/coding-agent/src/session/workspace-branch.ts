import { git } from "@linxiraos/pi-natives/vcs";

/**
 * The branch a workspace currently sits on, or null outside git / on a
 * detached HEAD. Sessions record it once at creation so a checkout that later
 * switches branches still knows which branch its transcript belongs to.
 */
export function workspaceBranch(cwd: string): string | null {
	try {
		const branch = git(cwd)?.headSync()?.branch;
		return branch && branch !== "HEAD" ? branch : null;
	} catch {
		return null;
	}
}
