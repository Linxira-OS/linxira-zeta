# omp-web

[中文文档](./README.zh-CN.md) | [日本語](./README.ja.md)

A browser-based UI for the [Oh My Pi](https://github.com/badlogic/pi-mono) coding agent — forked from [pi-web](https://github.com/agegr/pi-web) and adapted to work with the Oh My Pi (omp) harness.

> **Origin**: This project is a fork of [agegr/pi-web](https://github.com/agegr/pi-web). The core architecture, session browsing, real-time chat, and file preview remain as built by the pi-web authors. Changes made here target compatibility and workflow improvements specific to the Oh My Pi environment.

![omp-web showing a session with structured Markdown, tool calls, and project navigation](https://raw.githubusercontent.com/agegr/pi-web/main/docs/screenshot2.png)

## What is Oh My Pi?

Oh My Pi (omp) is a coding harness built on top of the pi coding agent. It adds structured agent sessions, skill management, worktree coordination, and a richer tool protocol on top of pi's core. `omp-web` surfaces the omp session format in the browser: the same `.jsonl` files pi writes, read and rendered by a Next.js server running locally alongside your agent.

## Quick Start

Pi Web requires Node.js 22.19.0 or newer. Check your version with `node --version`.

**Run without installing:**

```bash
npx omp-web@latest
```

**Or install globally:**

```bash
npm install -g omp-web
omp-web
```

**Or run from source (Git clone):**

```bash
git clone https://github.com/17380936778/omp-web.git
cd omp-web
npm install
npm run dev      # run dev server on port 30141
# or build and run production:
npm run build
npm start
```

Then open [http://127.0.0.1:30141](http://127.0.0.1:30141). The server tries to open the browser automatically once it is ready. omp-web listens on `127.0.0.1` by default.

**Options:**

```bash
omp-web --port 8080              # custom port
omp-web --hostname 0.0.0.0       # expose on a trusted network
omp-web -p 8080 -H 0.0.0.0       # combine options
omp-web --no-open                # do not open the browser automatically

PORT=8080 omp-web                # environment variable is also supported
OMP_WEB_HOSTNAME=0.0.0.0 omp-web  # explicit network exposure
OMP_WEB_NO_OPEN=1 omp-web        # useful when running as a background service
```

Pi Web has no application-level authentication and can invoke a high-privilege agent. Do not expose it to the internet; only use non-loopback bindings on a trusted network.

## HTTP Proxy

omp-web reads the standard `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` environment variables for server-side model and API requests.

On macOS or Linux:

```bash
HTTP_PROXY=http://127.0.0.1:7890 \
HTTPS_PROXY=http://127.0.0.1:7890 \
NO_PROXY=localhost,127.0.0.1 \
npx omp-web@latest
```

On Windows PowerShell:

```powershell
$env:HTTP_PROXY = "http://127.0.0.1:7890"
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
$env:NO_PROXY = "localhost,127.0.0.1"
npx omp-web@latest
```

## Features & Enhancements

- **Code Highlighting Theme Selector**: Independent code block theme selector supporting **One Dark Pro**, VS Code Dark+, VS Code Light, and more.
- **Deep Oh My Pi (OMP) Integration**: Fully supports `~/.omp/agent/` directory structure (`models.json`, `models.db`, `config.yml`, `agent.db`), auto-mapping OMP model roles (`defaultModel`, `smallModel`) and SQLite API credentials.
- **Full i18n & Chinese Localization**: Complete bilingual UI, optimized CJK typography, fonts, and search experience.
- **Browse sessions by project**: find previous omp conversations without digging through terminal history or session paths.
- **Fork or branch safely**: continue from any earlier message, or fork a session into a separate route without touching the original.
- **Switch worktrees from the sidebar**: the Explorer and new sessions follow the Git checkout you select.
- **Chat beside the project**: browse files on the left and preview source, docs, images, audio, and PDFs on the right while the agent works.
- **Visible session state**: context usage, cost, compaction state, and system prompt details from the top bar at all times.
- **Manage everything from the UI**: models, login/API keys, model tests, and skill toggles — no need to leave the browser.
## Notes

- **Data directory**: reads `~/.omp/agent/sessions` by default. Set `OMP_CODING_AGENT_DIR` to point at another omp agent directory (falls back to `PI_CODING_AGENT_DIR` for compatibility with pi-web).
- **Session files**: stored as `~/.omp/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`.
- **Model config**: the Models panel reads and writes `models.json` in the omp agent directory.
- **File access**: file browsing and preview are scoped to the selected project directory and working directories that appear in sessions.
- **Git worktrees**: see [Worktrees in omp-web](./docs/worktrees.md) for when the switcher appears, how worktrees are created, and what removal does.
- **Forks vs in-session branches**: Fork creates a new `.jsonl` file. "Edit from here" creates another branch inside the same session file.
- **Skills API**: `SKILLS_API_URL` overrides the default `https://skills.sh` endpoint used for skill search and install.
- **GitHub token**: `GITHUB_TOKEN` or `GH_TOKEN` grants the skills update checker higher GitHub API rate limits (optional; unauthenticated requests are allowed but may hit rate limits).
- **Prerequisites**: Node.js >= 18.3.0 is required. Git must be installed and accessible in system `PATH` for Git worktree and repository integration.
## Relationship to pi-web

omp-web is a direct fork of [pi-web](https://github.com/agegr/pi-web). The table below details the enhancements and changes introduced for the Oh My Pi environment:

| Area | Change |
|---|---|
| Package name & binary | `omp-web` instead of `pi-web` |
| Code Theme Selector | **Added** independent syntax theme selector with support for **One Dark Pro** and others |
| OMP DB & Role Mapping | **Added** support for `models.db`, `config.yml` model roles, and SQLite credentials under `~/.omp/agent/` |
| Chinese & i18n Localization | **Enhanced** full bilingual interface and optimized CJK typography |
| pi SDK dependency | Tracks `@earendil-works/pi-*` packages used by omp |
| Session & Path Compatibility | Works with omp session format, tool protocol, and `~/.omp/agent/` data directory |
| Default port | 30141 (same as omp dev convention) |

Everything else — session reading, AgentSession lifecycle, SSE streaming, fork/branch logic, file access, worktree management — is inherited from pi-web and documented in [AGENTS.md](./AGENTS.md).
## Development

```bash
npm install
npm run dev
```

The local dev server runs at [http://127.0.0.1:30141](http://127.0.0.1:30141).

Common checks:

```bash
node_modules/.bin/tsc --noEmit
npm run lint
```

Avoid running `next build` / `npm run build` during local development. It writes to `.next/` and can interfere with the dev server; leave builds for release work.

## Project Structure

```text
app/
  api/
    agent/          # creates/drives AgentSession and exposes SSE events
    auth/           # OAuth and API key management
    cwd/browse/     # browsable server directory listing
    cwd/validate/   # custom working directory validation
    default-cwd/    # pi default working directory lookup
    files/          # file listing, reading, preview, and watching
    home/           # current user home directory
    models/         # available models, default model, thinking levels
    models-config/  # read/write models.json and test models
    sessions/       # session reads, rename, delete, context, HTML export
    skills/         # skill listing, search, install, enable/disable
components/
  AppShell.tsx        # main layout, URL state, top panels, file tabs
  SessionSidebar.tsx  # project selector, session tree, Explorer
  DirectoryPicker.tsx # browsable and editable working-directory picker
  ChatWindow.tsx      # messages, SSE, image drag/drop, minimap
  ChatInput.tsx       # input bar, model/tools/thinking/compact/slash controls
  MessageView.tsx     # message, thinking, tool call/result rendering
  ModelsConfig.tsx    # model and auth configuration panel
  SkillsConfig.tsx    # skill management panel
  FileExplorer.tsx    # file tree
  FileViewer.tsx      # source, diff, image, audio, PDF, DOCX preview
lib/
  directory-browser.ts # directory normalization and safe listing helpers
  http-dispatcher.ts  # HTTP(S) proxy setup for server-side fetch
  rpc-manager.ts      # AgentSessionWrapper lifecycle and global registry
  session-reader.ts   # parses .jsonl session files and branch contexts
  normalize.ts        # normalizes toolCall field names
  file-access.ts      # file read safety boundary
  file-paths.ts       # path encoding and relative path helpers
  markdown.ts         # Markdown/Mermaid/KaTeX plugin configuration
  pi-types.ts         # pi-related types
hooks/
  useAgentSession.ts  # session loading, command sending, SSE state machine
  useAudio.ts         # completion sound
  useDragDrop.ts      # image drag/drop
  useTheme.ts         # theme switching
bin/
  omp-web.js          # npm CLI entrypoint
instrumentation.ts    # initializes the server HTTP dispatcher
```

## Acknowledgements

This project is built upon [pi-web](https://github.com/agegr/pi-web) and the `@earendil-works/pi-*` ecosystem. Special thanks to the original authors of `pi-web` and the Oh My Pi team for providing the open-source foundation.

## License

MIT — same as the upstream [pi-web](https://github.com/agegr/pi-web) project.
