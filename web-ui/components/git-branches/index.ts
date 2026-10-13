/**
 * Git-branch panel (right-dock "git"): the active workspace's local branches,
 * the current one flagged, and an explicit switch behind a confirmation.
 *
 * Data comes from the existing gateway pair `GET /api/git/branches?cwd=` and
 * `POST /api/git/checkout`, reached through the Next-side request-time proxies in
 * `app/api/git/{branches,checkout}` — no new endpoint and no new protocol.
 *
 * Import leaves directly in tests: `GitBranchesPanel` pulls in
 * `GitBranches.css`, which the node test runner cannot load. `GitBranchesView`,
 * `git-branches-model` and `panel-entry` are stylesheet-free.
 */
export { GitBranchesPanel, type GitBranchesPanelProps } from "./GitBranchesPanel";
export { GitBranchesView, type GitBranchesViewProps } from "./GitBranchesView";
export { GitBranchesIcon, gitBranchesPanelEntry, type GitBranchesPanelEntry } from "./panel-entry";
export {
	branchListState,
	loadBranches,
	orderBranches,
	switchBranch,
	type BranchListState,
	type CheckoutResult,
	type FetchLike,
	type GitBranch,
} from "./git-branches-model";
