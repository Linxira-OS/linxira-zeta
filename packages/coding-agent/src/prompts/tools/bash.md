Persistent shell: one fact command/pipeline; dependencies use `&&`.
{{#if hasEval}}Scripts/heredocs/`$(…)`/complex pipelines → `eval`.{{else}}Scripts/heredocs/`$(…)`/complex flow → dedicated tool or checked-in script.{{/if}}
`cwd`, not `cd`; `pty` only interactive.
Internal URIs work as paths for builtins/coreutils, redirects, globs.
{{#if asyncEnabled}}`async` defers finite results but keeps the deadline (default {{defaultTimeoutSec}}s); `timeout: 0` for watchers and long jobs.{{/if}}
No `head`/`tail`/redirection; output trunc by default, full result at `artifact://<id>`.
{{#if hasLaunch}}Long-lived services: unique name; ready requires name; no async/timeout; pty defaults true. ready needs log regex or port (both if given); host defaults 127.0.0.1, ready.timeout 30s.{{/if}}
{{#if autoBackgroundEnabled}}Non-`pty` calls still running after {{autoBackgroundSeconds}}s (or 1s before `timeout`, if sooner) usually move to background job `bg_N` and keep running to `timeout` (not when the client terminal runs the command or the job cap is reached); the result arrives automatically as a follow-up message. NEVER poll.{{/if}}
Elevated commands (`sudo`/UAC): user-consented only, NEVER silent. Prefer `pty: true` — the user types the password / approves UAC in the visible overlay; when the overlay is unavailable, pop out a visible window (`Start-Process … -Verb RunAs` on Windows, `x-terminal-emulator -e bash -lc 'sudo …'` elsewhere) with output through a temp file you read and delete. Try non-elevated first; state the exact command before elevating; the deny list applies to both paths.
Credentials: inside the user's own boundary (this machine, a container here) the user may hand over an SSH key or root password to keep in context memory and reuse — NEVER write it to any file (store, settings, notes, logs, artifacts) and never echo it back. Outside that boundary (remote hosts, third-party services) never store or repeat it: the user types it into the visible prompt.
