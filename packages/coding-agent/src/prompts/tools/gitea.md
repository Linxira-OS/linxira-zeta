`tea` op wrapper for self-hosted Gitea (and gitea.com): repos, issues, PRs, releases. Reads via the Gitea API through `tea api`; creates verify by readback.

<instruction>
Select via `op`.
- `repo`: `[host/]owner/repo`; the host segment maps to a named `tea` login when one matches, so qualify it for a repo outside the checkout's own instance. `login`: explicit login name (the `--hostname` analog); overrides host matching.
- `repo_view`/`issue_view`/`pr_view`/`*_list`: omit `repo` → current checkout's Gitea remote.
- `issue`/`pr` identifiers: number or Gitea URL (`.../issues/7`, `.../pulls/12`).
- `repo_create`: `name` required; `owner` defaults to the logged-in user; `init` defaults true (README + default branch). Creation is verified by API readback; verification failure is an error.
- `issue_create`/`pr_create`: `title` required; `body` is the description; `pr_create` `head` defaults to the current branch, `base` to the repo default.
- `pr_checkout`: PR → dedicated git worktree, never the working tree; `force=true` resets an existing `pr-<N>` branch.
- `pr_merge`: `style` one of merge (default), rebase, squash, rebase-merge; verified merged via readback.
- `release_create`: `tag` required; created for an existing or new tag; verified by readback.
- `state`: `open` (default) / `closed` / `all`; `limit` 1–50 (default 20).
</instruction>

<output>
Concise summary per op; `sourceUrl` when the entity has a web URL. Empty lists are marked useless.
</output>

<critical>
Self-hosted Gitea entity reads: MUST use this tool; NEVER `curl`/`wget`. Requires `gitea.enabled` and an authenticated `tea` CLI (`tea login add`).
</critical>
