"use client";

/**
 * GitPage — Studio's status/diff/branch/log/worktree panel over `/api/git/*`.
 *
 * Reads: `status` + `diff` (Next-owned file handlers), `branches`/`branch`/
 * `checkout`/`stage`/`unstage`/`commit`/`fetch`/`pull`/`push` (gateway, pi-vcs
 * addon) and `/api/worktrees` (Next-owned).
 *
 * Studio's GitHub, stash, merge/rebase, tag and remote panes are absent: the
 * gateway has no route for them, so their menu entries and code paths were
 * removed rather than left silently failing.
 */

import { useI18n } from "@/components/studio/i18n";
import { GitStatusPanel } from "./git/GitStatusPanel";
import { PageFrame } from "./page-frame";
import { usePagesStudioClient } from "./studio-client";

export function GitPage({ cwd, title }: { cwd: string | null; title?: string }) {
	const { t } = useI18n();
	const client = usePagesStudioClient(cwd);
	return (
		<PageFrame title={title ?? t("studio.route.git")} subtitle={cwd}>
			<GitStatusPanel client={client} {...(cwd ? { workspaceId: cwd as never } : {})} />
		</PageFrame>
	);
}
