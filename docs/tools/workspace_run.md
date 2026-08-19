# workspace_run

> Delegate a subtask to another workspace's agent session and wait for its final reply. The default-workspace coordinator uses this to orchestrate other repositories; the remote user talks only to the coordinator.

## Source
- Entry: `packages/coding-agent/src/tools/workspace-run.ts`
- Model-facing prompt: `packages/coding-agent/src/prompts/tools/workspace-run.md`

## Registration / Visibility
- Web/desktop mode only: available when the session runs under `zeta serve` with a workspace router (`SessionRouter`) and `channels.enabled` is not `false`.
- Rejected in plain CLI sessions (`isToolAllowed` returns `false` when `ToolSession.workspaceRun` is undefined).

## Inputs

| Field | Type | Required | Description |
|---|---|---:|---|
| `workspace` | `string` | Yes | Absolute directory path or a name registered via `@workspace open/create`. |
| `task` | `string` | Yes | Self-contained instruction for the target session. |

## Outputs
- `content[0].type = "text"` — the target session's final reply, prefixed `[<workspace-name>]`.
- `isError: true` with an explanatory message when the router is unavailable, the workspace is unknown, or delegation throws.

## Side Effects
- Runs a full agent turn in the target workspace session (may read/write files and spawn processes there).
- Registers the workspace path in `web.yml` (`remote.workspaces`) when opened via `@workspace open/create`.

## Errors
- `workspace_run is not available in this session (CLI mode or no workspace router).`
- `workspace_run: unknown workspace "<name>"` — the workspace was never opened via `@workspace open/create`.
- `workspace_run: another delegation is already in flight; wait for it to finish` — delegations are serialized per coordinator.
- `workspace_run: delegation to "<name>" failed: <reason>` — the target session's IRC delivery threw.
