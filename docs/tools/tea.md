# tea

> Dispatch `tea` CLI operations against self-hosted Gitea instances (and gitea.com): repositories, issues, pull requests, checkout, merge, and releases.

## Source
- Entry: `packages/coding-agent/src/tools/tea.ts`
- Model-facing prompt: `packages/coding-agent/src/prompts/tools/gitea.md`
- Key collaborators:
  - `packages/coding-agent/src/tools/tea-common.ts` — `[host/]owner/repo` parsing, tea-login (instance) resolution, cwd → Gitea remote resolution with a process-lifetime cache, git worktree helpers, result building.
  - `packages/coding-agent/src/tools/tea-types.ts` — pure types: tool input, result details, Gitea API projections (repo/issue/PR/release/user/run).
  - `packages/coding-agent/src/utils/gitea.ts` — `tea` process wrapper (`gitea.run/json/text()`), non-interactive env, 5-minute deadline, 8 MiB captured-output cap, auth/context failure mapping.
  - `@linxiraos/pi-tui/tools/gh-format` — shared `pushLine`/`formatShortSha` field rendering.
  - `@linxiraos/pi-natives/vcs` — git operations (`requireGit()`: fetch/branch/worktree/config).
  - `packages/coding-agent/src/utils/repo-lock.ts` — per-repo write serialization (`withRepoLock`).

## Availability and approval

- `gitea.enabled` defaults to `false`; enable the tea tool in **Settings → Tools** before use.
- The tool is discoverable and strict-schema, and is created only when `tea` is available on `PATH`. Authentication is per named login: `tea login add` configures instance + token; the CLI is checked when an operation runs.
- `repo_view`, `issue_view`, `issue_list`, `pr_view`, `pr_list`, and `release_list` request read approval. `repo_create`, `issue_create`, `pr_create`, `pr_checkout`, `pr_merge`, and `release_create` request execution approval.

## Inputs

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `op` | `"repo_view" \| "repo_create" \| "issue_view" \| "issue_list" \| "issue_create" \| "pr_view" \| "pr_list" \| "pr_create" \| "pr_checkout" \| "pr_merge" \| "release_list" \| "release_create"` | Yes | Dispatch selector. `TeaTool.execute()` switches only on this field. |
| `repo` | `string` | No | `[host/]owner/repo` override. Unlike `gh`, the host segment is never assumed away: it is matched against configured `tea` logins to pin the instance. Omitted ops resolve the current checkout's Gitea remote (memoized per cwd). |
| `login` | `string` | No | Explicit `tea` login name — the analog of `gh`'s `--hostname`. Wins over host matching; without either, `tea`'s default login is used. |
| `name` | `string` | No | Required by `repo_create`: new repository name. |
| `owner` | `string` | No | `repo_create` owner user/org; defaults to the logged-in user (resolved via `tea api /user`). |
| `description` | `string` | No | `repo_create` repository description. |
| `private` | `boolean` | No | `repo_create` private flag. |
| `init` | `boolean` | No | `repo_create` initialization with README/default branch. Defaults to `true`. |
| `issue` | `string` | No | Required by `issue_view`: issue number or Gitea issue URL. |
| `pr` | `string` | No | Required by `pr_view`, `pr_checkout`, and `pr_merge`: PR number or Gitea PR URL. |
| `title` | `string` | No | Required by `issue_create`/`pr_create`; optional release title for `release_create`. |
| `body` | `string` | No | Issue/PR description (`--description`) or release notes (`--note`). |
| `base` | `string` | No | `pr_create` target branch; defaults to the repository default branch. |
| `head` | `string` | No | `pr_create` source branch; defaults to the current branch on the instance. `<user>:<branch>` names a fork head. |
| `draft` | `boolean` | No | `pr_create`/`release_create` draft marker. |
| `prerelease` | `boolean` | No | `release_create` pre-release marker. |
| `tag` | `string` | No | Required by `release_create`: tag to release (created on the target when missing). |
| `target` | `string` | No | `release_create` target branch or commit; defaults to the default branch. |
| `labels` | `string[]` | No | `issue_create`/`pr_create` labels. |
| `assignees` | `string[]` | No | `issue_create`/`pr_create` assignees. |
| `state` | `"open" \| "closed" \| "all"` | No | `issue_list`/`pr_list` filter; default `open`. |
| `limit` | `number` | No | List page size: floored, clamped to 1–50, default 20. |
| `style` | `"merge" \| "rebase" \| "squash" \| "rebase-merge"` | No | `pr_merge` style; default `merge`. |
| `mergeTitle` | `string` | No | `pr_merge` merge commit title. |
| `mergeMessage` | `string` | No | `pr_merge` merge commit message. |
| `force` | `boolean` | No | `pr_checkout`: reset an existing `pr-<number>` branch to the PR head. |

## Outputs

- `content`: one text block per op. List ops render one `# <index> [state] title` entry per item with indented fields; empty lists are marked `useless: true`.
- `sourceUrl`: set whenever the entity has a web URL (`html_url`).
- `details`: `repo`, `issue`, `pr`, `url`, `branch`, `worktreePath`, `remote`, `remoteBranch`, `headSha` (merge commit after `pr_merge`), and `checkouts` for `pr_checkout`.

## Flow
1. `TeaTool.createIf()` exposes the tool only when `gitea.available()` finds `tea` on `PATH`; the `gitea.enabled` setting gates it in `resolveBuiltinToolPlan`.
2. `TeaTool.execute()` wraps dispatch in `untilAborted()` and switches on `params.op`.
3. Every op first resolves a **repo context**: identifier-carried repo (issue/PR URL) → explicit `repo` → the checkout's Gitea remote. Remote resolution parses each git remote URL (`https`, `ssh://`, scp-style) and accepts the first one whose host matches a configured `tea` login; results are memoized per absolute cwd (in-flight lookups shared, caller aborts unwound per caller).
4. The host segment (or explicit `login`) maps to `--login <name>` via a memoized `tea logins list --output json`; an unmatched host leaves `tea` on its default login.
5. CLI execution goes through `gitea.run/json/text()` in `packages/coding-agent/src/utils/gitea.ts`:
   - spawns `tea ...` with `Bun.spawn()` under a non-interactive env, a 5-minute deadline, and an 8 MiB captured-output cap;
   - maps `tea login` / "no gitea login" failures to `Gitea CLI not authenticated. Run \`tea login\`.` and missing checkout context to a pass-`repo` hint;
   - `json()` rejects empty or invalid JSON and appends Gitea API error payloads to failure messages.
6. Read ops call the Gitea REST API through `tea api` (`/repos/{owner}/{repo}[...]`), so results are full API objects rather than `tea`'s table projections; `issue_view` additionally fetches `/issues/{n}/comments` (a failed comments call degrades to the comment count instead of masking the body).
7. Write ops run `tea` subcommands with full flags (never interactive), then **verify by API readback**:
   - `repo_create` re-reads `/repos/{owner}/{name}` and rejects a name mismatch — `tea repo create` has a silent-failure history, so a failed readback is an error;
   - `issue_create`/`pr_create` parse the `#<n>` marker from tea's output (falling back to an exact-title search) and read the entity back;
   - `pr_merge` re-reads the PR and errors unless `merged` is true;
   - `release_create` re-reads `/releases/tags/{tag}`.
8. `pr_checkout` resolves PR metadata first, then enters `withRepoLock()` before any git mutation. It fetches `refs/pull/<N>/head` (falling back to the head branch for remotes without pull refs), refuses to proceed when the fetched commit differs from the API-reported head, creates/resets the `pr-<N>` branch (`force` required to reset), configures branch tracking (fork PRs get no push config), and adds a dedicated worktree — the working tree is never touched. Reused worktrees short-circuit.

## Modes / Variants

### `repo_view` / `repo_create`

| Aspect | Value |
| --- | --- |
| Required fields | `op`; `name` for `repo_create` |
| Optional fields | `repo`, `login`; `owner`, `description`, `private`, `init` for `repo_create` |
| `tea` command | view: `tea api /repos/<owner/repo>`; create: `tea repos create --name <name> [--owner] [--description] [--private] [--init]` + API readback |
| Output | `# <owner/repo>` header, description, URL, owner, default branch, privacy/archive/fork flags, stars/forks/issues/pulls counters, SSH + clone URLs, website, timestamps. `sourceUrl = html_url`. |

### `issue_view` / `issue_list` / `issue_create`

| Aspect | Value |
| --- | --- |
| Required fields | view: `issue`; create: `title` |
| Optional fields | `repo`, `login`; list: `state`, `limit`; create: `body`, `labels`, `assignees` |
| `tea` command | view: `tea api /repos/<slug>/issues/<n>` (+ `/comments`); list: `tea api /repos/<slug>/issues?state=&limit=&type=issues`; create: `tea issues create --title … [--description] [--labels] [--assignees] --repo <slug>` + readback |
| Output | View: header, state/author/timestamps/labels/milestone, body, `## Comments` section. List: numbered entries. Create: `# Created Issue #<n>` summary. `sourceUrl = html_url`. |

### `pr_view` / `pr_list` / `pr_create` / `pr_checkout` / `pr_merge`

| Aspect | Value |
| --- | --- |
| Required fields | view/checkout/merge: `pr`; create: `title` |
| Optional fields | `repo`, `login`; create: `body`, `base`, `head`, `draft`, `labels`, `assignees`; checkout: `force`; merge: `style`, `mergeTitle`, `mergeMessage` |
| `tea` command | view: `tea api /repos/<slug>/pulls/<n>`; list: `tea api /repos/<slug>/pulls?state=&limit=`; create: `tea pulls create --title … [--head] [--base] [--draft] --repo <slug>` + readback; checkout: API metadata + git fetch/worktree under repo lock; merge: `tea pulls merge <n> --style <style>` + merged-true readback |
| Output | View: header, state/draft/author/base/head/head-SHA/mergeable/merged, body. List: numbered entries with base/head. Create: `# Created Pull Request #<n>`. Checkout: worktree path, local branch `pr-<n>`, remote, reuse status. Merge: merge timestamp, merge commit SHA, merger. |

`pr_checkout` errors when no local git remote points at the resolved slug, when the fetched commit does not match the API-reported head, or when `pr-<n>` exists at a different commit without `force`.

### `release_list` / `release_create`

| Aspect | Value |
| --- | --- |
| Required fields | create: `tag` |
| Optional fields | `repo`, `login`; list: `limit`; create: `title`, `body` (notes), `target`, `draft`, `prerelease` |
| `tea` command | list: `tea api /repos/<slug>/releases?limit=`; create: `tea releases create <tag> [--title] [--note] [--target] [--draft] [--prerelease] --repo <slug>` + tags readback |
| Output | List: tag/name entries with draft/prerelease/target/author/published/asset counts. Create: `# Created Release <tag>` summary. |

## Limits

- One Gitea instance per call: instance selection is `login` → ref host → `tea` default login.
- List results cap at 50 per call; use `state` filters rather than deep paging.
- The token each `tea` login carries must cover the op's scopes (e.g. `read:issue` for issue reads); Gitea scope errors surface verbatim.
- No caching layer: every read hits the instance (unlike `github`'s issue/PR cache).

## Errors

- `Gitea CLI not authenticated. Run \`tea login\`.` — mapped from tea's login failures.
- `Gitea repository context is unavailable. Pass \`repo\` explicitly or run the tool inside a Gitea checkout.` — no `repo` input and the cwd has no Gitea remote.
- `Gitea CLI (tea) is not installed. …` — `tea` missing from `PATH` (tool would not be constructed unless `tea` was available at session start).
- Readback failures after creates name the entity and instruct verification instead of assuming success.
- Everything else surfaces tea's own stderr text unchanged.
