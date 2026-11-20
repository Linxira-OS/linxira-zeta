Persistent bash 5.3.
cwd will reset after each turn, don't rely on cd{{#if hasPty}}; `pty` = interactive{{/if}}.
Internal URIs work as paths for builtins/coreutils, redirects, globs.
In-process builtins, ahead of PATH: {{join builtins ", "}}.
{{#if asyncEnabled}}
`async` defers finite results but keeps the deadline (default {{defaultTimeoutSec}}s); `timeout: 0` for watchers and long jobs.
`notify` (regex; implies `async`) sends each matching output line as a follow-up while the job runs, ahead of its result. Match only lines you'd act on: too many matches switch it off.
{{/if}}
Don't trunc output by habit, result will be summarized and saved as an artifact.
{{#if hasLaunch}}
Long-lived services:
- unique name; ready requires name; no async/timeout; pty defaults true.
- ready needs log regex or port (both if given); host defaults localhost, ready.timeout 30s.
- `notify` (regex) sends each matching output line as a follow-up while the service runs.
{{/if}}
{{#if autoBackgroundEnabled}}
Non-`pty` calls still running after {{autoBackgroundSeconds}}s (or 1s before `timeout`, if sooner) usually move to background job `bg_N` and keep running to `timeout`.
No backgrounding when the client terminal runs the command or the job cap is reached.
The result arrives automatically as a follow-up message. NEVER poll.
{{/if}}
Elevated commands (`sudo`/UAC): user-consented only, NEVER silent. Prefer `pty: true` — the user types the password / approves UAC in the visible overlay; when the overlay is unavailable, pop out a visible window (`Start-Process … -Verb RunAs` on Windows, `x-terminal-emulator -e bash -lc 'sudo …'` elsewhere) with output through a temp file you read and delete. Try non-elevated first; state the exact command before elevating; the deny list applies to both paths.
Processes: NEVER stop, kill, or restart a process you did not start, and NEVER target your own host chain (this shell, `bun`/`node`, the terminal) — no name/recency/pattern sweeps (`Get-Process X | Stop-Process`, `Stop-Process -Name`, `taskkill /IM`, `pkill`, `killall`, `kill -1`/`kill 0`). Record the pid when you spawn it (`$!`, `Start-Process … -PassThru`) and stop only that pid; the shell tool refuses the rest.
Credentials: default is that a secret never reaches a file — inside the user's own boundary (this machine, a container here) the user may hand over an SSH key or root password to keep in context memory and reuse; NEVER write it to any file (store, settings, notes, logs, artifacts) and never echo it back. Outside that boundary (remote hosts, third-party services) never store or repeat it: the user types it into the visible prompt. When the user explicitly asks for a secret to be remembered in context, or for its usage to be written into a document, do exactly that for that target — their instruction overrides this default.
