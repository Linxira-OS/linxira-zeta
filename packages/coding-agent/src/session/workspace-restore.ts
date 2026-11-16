import { resumePathKey } from "../resume/paths";

const restoring = new Set<string>();
/** Existing and newly created native sessions share one canonical workspace fence. */
export function lockWorkspaceRestore(workspace: string): Disposable {
	const key = resumePathKey(workspace);
	if (!key || restoring.has(key)) throw new Error("Workspace restore is already active");
	restoring.add(key);
	return {
		[Symbol.dispose]: () => {
			restoring.delete(key);
		},
	};
}
export function assertWorkspaceNotRestoring(workspace: string): void {
	if (restoring.has(resumePathKey(workspace)))
		throw new Error("Workspace restore is active; retry after it completes");
}
