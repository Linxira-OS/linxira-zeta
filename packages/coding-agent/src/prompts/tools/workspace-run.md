Delegate a subtask to another workspace's agent session and wait for its final
reply. You are the coordinator for the default workspace: the remote user talks
only to you, and you orchestrate the other repositories with this tool.

- `workspace` is an absolute path or a name registered via `@workspace open/create`.
- `task` is a self-contained instruction for the sub-agent. Include enough
  context that the target session can work without the surrounding conversation.
- The result is the target session's final reply text, prefixed with
  `[<workspace-name>]`. Summarize it for the user — do not forward it verbatim.
- The target session does NOT message the user directly; only you push to the
  user via `channel_send`. Avoid duplicate pushes.
- Only available in web/desktop mode. In a plain CLI session this tool is
  rejected, so guard calls with the result's `isError` flag.
