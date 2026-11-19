# Browser Eval prelude

The Eval `browser` facade opens, reuses, scripts, and closes named Chromium, Electron, CDP, relay, or cmux tabs. Use [`read`](./read.md) for static URLs; use `browser` for authenticated state, JavaScript execution, or interaction.

## Source

- Host facade: `packages/coding-agent/src/tools/browser.ts`
- JavaScript/Python facades: `packages/coding-agent/src/tools/browser/prelude.{js,py}`
- Model-facing prompt: `packages/coding-agent/src/prompts/tools/browser.md`
- Tab lifecycle: `packages/coding-agent/src/tools/browser/tab-supervisor.ts`
- Browser worker and inner tab API: `packages/coding-agent/src/tools/browser/tab-worker.ts`
- Browser registry and launch modes: `packages/coding-agent/src/tools/browser/{registry,launch,attach}.ts`
- Relay: `packages/coding-agent/src/tools/browser/relay/`
- Cmux backend: `packages/coding-agent/src/tools/browser/cmux/`
- Public helper types and options: `packages/coding-agent/src/tools/browser/declarations.d.ts`
- Browser settings: `packages/coding-agent/src/tools/browser/settings.ts`

The prelude exists only while Eval and `browser.enabled` are enabled (`browser.enabled` defaults to `true`). It is not an AgentTool.
All browser host operations request exec-tier approval, including inspection helpers.

## JavaScript API

```js
const tab = await browser.open({
	name: "main",
	url: "https://example.com",
	wait_until: "load",
});

const observation = await tab.observe();
await tab.id(observation.elements[0].id).click();
const title = await tab.title();

const length = await tab.run(async ({ tab }, suffix) => ((await tab.title()) + suffix).length, {
	args: ["!"],
	timeout: 30,
});

await tab.close();
```

- `browser.open(options?) -> Promise<BrowserTab>` opens or reuses a named tab and returns its handle. Its text is one line naming the tab and its browser, the page it landed on when that differs from the requested `url` (or none was given), and the page title, followed by any notices.
- `browser.tab(name = "main") -> BrowserTab` creates a proxy for that name; it does not open a tab or check that one exists.
- `browser.tabs() -> Promise<ManagedTabInfo[]>` lists live managed tabs with `name`, `url`, `title`, `targetId`, `kind`, and `persist`.
- `browser.close({ name?, all?, kill?, timeout? }) -> Promise<void>` releases one or all managed tabs.
- `tab.close({ kill?, timeout? }) -> Promise<void>` releases that handle's tab.

`close` and `run` resolve `timeout` like `open`: seconds, default 30, capped by positive `tools.maxTimeout`, then clamped to 1–300. A `run` without `timeout`, and every direct helper call (`tab.evaluate(…)`, `tab.click(…)`, …), defaults instead to the Eval cell's `timeout` when that is longer (300 for a cell with `timeout: 0`): the cell's own timer is suspended while a browser call runs. `waitFor*` helpers take `timeout` in milliseconds and cannot outlast the enclosing call's `timeout`.

On Chromium tabs, a call that runs out of time fails and Zeta tries for up to 5 seconds to reattach the tab to a new worker without reloading its page, which resets the tab state set since it was opened (routes, emulation, init scripts, element ids, run globals). A worker that does not stop within 750 ms of the deadline or cancellation is released with its tab. Cancellation stays active during recovery and also stops a stalled replacement worker.

### Open options

| Option                | Contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                | Managed-tab name; default `"main"`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `url`                 | Navigate the opened or reused tab to this URL. On Chromium-backed tabs, a navigation that outlasts `timeout` throws an error naming the tab and keeps it on what loaded; reach it with `browser.tab(name)`. A navigation that fails outright (refused connection, blocked domain, certificate error) or an open that is cancelled closes a tab the open created; a reused tab stays open.                                                                                                                                                                                                                                    |
| `app` | One string: `"relay"`, `"chromium"`, `"own"`, `"auto"`, a CDP endpoint URL, or an executable path. `argv` supplies extra CLI args for an executable path. `target` selects an attached page by exact target id or case-insensitive URL/title substring. |
| `viewport`            | `{ width, height, scale? }`; `scale` becomes the device scale factor.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `wait_until`          | `"load"`, `"domcontentloaded"`, `"networkidle0"`, or `"networkidle2"`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `dialogs` | `"accept"` or `"dismiss"` automatic policy. Without one, alerts and beforeunload prompts are accepted; confirms and prompts remain pending. On Chromium tabs a pending dialog stops page script, and calls requiring it fail until `handleDialog` answers it. |
| `allowed_domains` | Exact hostnames or `*.example.com` patterns (including the bare domain). The network manager aborts intercepted HTTP(S)/WS(S) requests to other hosts; an empty list leaves requests unrestricted. This is not a sandbox. |
| `init_scripts`        | Document-start JavaScript sources or cwd-relative source-file paths.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `downloads`           | Absolute or cwd-relative directory for this tab's downloads; defaults to a temporary folder per tab. Tabs in a managed or spawned Chromium keep separate folders while they share a browser, downloads their iframes start included; there a download no tab tracks keeps Chromium's GUID file name. Connected browsers also receive the user's own downloads, so they keep one browser-wide folder (the last tab to set it wins) and real file names. The relay cannot choose Chrome's folder, so a relay tab refuses `downloads`; it tracks its downloads from the moment it opens and reports each where Chrome saved it. |
| `user_agent`          | Per-tab user-agent override.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `insecure` | Ignore invalid HTTPS certificates for the tab.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `headed` | Override `browser.headless` for this open. |
| `persist`             | Default `false`; opt out of settle-freeze and idle-close management. On a tab zeta opened through the relay, also keep it open in the user's Chrome after the session ends. Explicit reuse by the owning session can change it.                                                                                                                                                                                                                                                                                                                                                                                               |
| `timeout`             | Seconds; default 30, capped by positive `tools.maxTimeout`, then clamped to 1–300. First-use Chromium installation is outside the open deadline. An open that runs out names the step it stalled in: launching or connecting to the browser, closing a tab to reopen it, or opening the tab.                                                                                                                                                                                                                                                                                                                                 |

If Chrome detaches the relay during an open's navigation and zeta reattaches to the same page, the open returns that tab with a recovery notice instead of closing it. Check its current page before repeating the navigation; reattachment does not reload it or retry input that may already have landed.
If reattachment uses up the budget before navigation starts, the open still fails but keeps the recovered tab available through `browser.tab(name)`.

Reopening with init scripts, a download directory, a user-agent override, or `insecure: true` recycles an existing tab so those worker-init options can take effect.

### Direct tab helpers

Direct helpers cross the host bridge and return real structured values. The complete option types are in `browser/declarations.d.ts`.

- Navigation: `url`, `title`, `goto`, `back`, `forward`, `reload`, `pushState` (SPA navigation without a document load).
- Inspection: `observe({ includeAll?, viewportOnly?, selector?, compact? })`, `ariaSnapshot(selector?, { depth?, boxes?, interactive?, compact?, urls?, diff? })`, `a11y`, `screenshot`, `diffScreenshot`, `pdf`, `extract(format?, { selector?, outline?, filter? })`, `text`, `html`, `value`, `attr`, `count`, `box`, `styles`, `isVisible`, `isEnabled`, `isChecked`.
- Interaction: `click`, `dblclick`, `hover`, `focus`, `check`, `uncheck`, `type`, `fill`, `press`, `keyDown`, `keyUp`, `mouseMove`, `mouseDown`, `mouseUp`, `clickAt`, `wheel`, `scroll`, `drag`, `highlight`, `scrollIntoView`, `select`, `uploadFile`. `click(selector, { button?, count? })`, on a tab or a frame, presses another mouse button or clicks more than once, like `BrowserElement.click` below. `clickAt(x, y, { button?, count?, css? })`, `mouseMove(x, y, { steps?, css? })` and `drag` `{ x, y, css? }` points take positions as read off the tab's latest viewport screenshot: viewport CSS pixels, unless that screenshot was scaled (see the capture text below).
- Waiting: `waitFor(selector, { timeout? })`, `waitForSelector(selector, { timeout?, state?: "attached" | "detached" | "visible" | "hidden", visible?: boolean, hidden?: boolean })`, `waitForUrl(stringOrRegExp, { timeout? })`, `waitForText(text, { timeout?, selector?, exact? })`. URL strings containing `*` are globs; other strings are substrings. Chromium tabs reject unknown or contradictory selector-wait options; cmux supports only `timeout`.
- Frames: `frames()` lists the frame tree; `frame(selectorOrNameOrUrl)` returns a scoped proxy with `click`, `fill`, `type`, `press`, `text`, `html`, `value`, `attr`, `count`, `isVisible`, `ariaSnapshot`, `evaluate`, `waitFor`, `waitForSelector`, and `screenshot`.
- Dialogs: `dialog`, `handleDialog`, `setDialogs`.
- Emulation: `emulate`, `devices`.
- Clipboard: `clipboardRead`, `clipboardWrite`, `clipboardCopy`, `clipboardPaste`.
- Storage: `cookies`, `setCookies`, `clearCookies`, `storage`, `setStorage`, `clearStorage`, `saveState`, `loadState`.
- Initialization/downloads: `addInitScript`, `removeInitScript`, `initScripts`, `waitForDownload`, `downloads`. `waitForDownload` holds the tab until a download finishes, so another call on the tab fails as busy while it waits, and on a tab opened without `downloads` a download started before the first wait is not tracked. Start the wait and the step that downloads in one run: `tab.run("const download = tab.waitForDownload(); await tab.click('#export'); return await download;")`. A finished download whose file is not on zeta's machine, as with a browser reached through `app.cdp_url` that runs on another one, fails the wait with the path it looked for and is left out of `downloads()`.
- Diagnostics: `console`, `errors`, `clearConsole`, `traceStart`, `traceStop`, `profileStart`, `profileStop`, `metrics`.
- `console({ level?, since?, limit?, clear? })` and `errors({ since?, limit?, clear? })` return `{ entries, nextSeq, dropped }`: `entries` in capture order, `nextSeq` to pass as `since` for later entries, and `dropped` counting entries the bounded buffer evicted. Called directly from a JavaScript cell, array methods, `length` and iteration on the result throw a `TypeError` that says to read `.entries`.
- Recording: `recordStart`, `recordStop`, `recordRestart`, `recording`.
- Web Vitals/React: `vitals`, `reactEnable`, `reactTree`, `reactInspect`, `reactRenders`, `reactSuspense`; call `reactEnable` before other `react*` helpers (it installs the hook and reloads).
- Network: `route`, `unroute`, `routes`, `requests`, `request`, `clearRequests`, `harStart`, `harStop`, `allowedDomains`.
- Experimental page tools: `webmcpList`, `webmcpInvoke`, `webmcpEvents`, on Chromium tabs only. They read the tools a page registers with Chrome's native WebMCP through the DevTools `WebMCP` domain, including cross-origin iframes; zeta injects no page script for them. Nothing runs until the first call. When Chrome offers the page no WebMCP (Chrome before 147, an insecure context, or a page without the WebMCP origin trial in a Chrome started without `--enable-features=WebMCP`), `webmcpList` returns `status: "unavailable"` with a `reason` naming what enables it, and `webmcpInvoke` throws it; invoking needs Chrome 149 or newer. Page-provided tool metadata and results are untrusted; discovery never authorizes invocation.
- Page execution: `evaluate(fnOrSource, ...args)`. A source string is a page-global expression, not a function body; top-level `return` is invalid. Use a function or an invoked IIFE string when needed.

Direct `waitFor` and `waitForSelector` return booleans for the resolved handle, but timeouts can throw. `tab.id(number)` and `tab.ref("e5")` return `BrowserElement` proxies. They support `click`, `dblclick`, `check`, `uncheck`, `highlight`, `type`, `fill`, `press`, `hover`, `focus`, `select`, `uploadFile`, `scrollIntoView`, `boundingBox`, `isVisible`, `isHidden`, `text`, `html`, `value`, `attr`, `styles`, `isEnabled`, `isChecked`, and `evaluate`. `click({ button, count })` presses another mouse button or clicks more than once; cmux tabs press the left button once and refuse other buttons and counts (use `dblclick()`). A string passed to `BrowserElement.evaluate` is a function expression invoked with the element as its first argument.

On Chromium-backed tabs, a successful hidden/detached wait can return `null` inside `tab.run`, or `false` through the direct helper; timeouts throw. A present invisible element can return a handle with `hidden`, and a frame wait returns `true` on completion. A `role/` selector never matches a hidden element, so its `detached` wait also completes once the match is hidden.

Chromium snapshot-ref waits check the live element, not just whether the ref remains in the last snapshot: a hidden element is still attached, and a removed element satisfies hidden/detached.

Selectors accept CSS and Puppeteer `aria/…`, `text/…`, `xpath/…`, `pierce/…`, plus `label/…`, `placeholder/…`, `testid/…`, `alt/…`, `title/…`, and `role/<role>[name="…"]` query handlers. Add ` exact` inside the role name filter for exact matching; names otherwise match case-insensitively. Chromium `role/` uses Chrome's accessibility tree, reaches open shadow roots, and skips hidden and `aria-hidden` elements. Text-only `StaticText` entries have no `role/` selector. Playwright-only pseudos such as `:has-text()` and `:visible` are rejected. Use `tab.select` for `<select>` elements; `tab.fill` does not support them.

`observe()` lists interactive elements and assigns numeric ids consumed by `tab.id`; `includeAll: true` adds non-interactive accessibility nodes, and `viewportOnly: true` keeps only elements intersecting the viewport (ignored on cmux). In JavaScript Eval, printing a `tab.observe()` result, or leaving it as a cell's last value, shows every element on its own line (`[id] role "name" value=… states`); `.elements` keeps the data for code. `ariaSnapshot()` assigns `[ref=eN]` ids consumed by `tab.ref`; `diff: true` returns a revisioned full, unchanged, or delta object. Navigation and re-rendering invalidate handles; re-observe and act in the same Eval cell.

The same print form applies to an observation returned by `tab.run(async ({ tab }) => tab.observe())`. An observation changed after it returned (a field assigned, an element added, a getter defined, or a prototype edited in place) prints as plain `util.inspect` output instead, with every element still shown.

On Chromium-backed tabs, a page read, a selector action, `evaluate`, or a wait for page content (`waitFor`, `waitForSelector`, `waitForText`, `waitForUrl`) issued while a navigation the page asked for is on its way (a link or submit button just clicked, a script setting `location`) first waits for the new document to commit and finish parsing, so a click and the read of, or the next step on, the page it loads can share one cell. Raw pointer input (`clickAt`, `wheel`, `mouse*`) and waits for events (`waitForNavigation`, `waitForResponse`, `waitForDownload`) run at once. A request that never starts loading holds a call at most 5 s. A built-in read that loses its document to a navigation mid-call runs once more on the new one; `evaluate` never runs your code twice.

### `tab.run(fnOrCode, options?)`

A run accepts either a serialized function or a JavaScript function-body string, plus `{ args?, timeout? }`:

```js
const hrefs = await tab.run(async ({ page }) => {
	return await page.$$eval("a", links => links.map(link => link.href));
});

const title = await tab.run("return await tab.title();", { timeout: 10 });
```

Functions receive `{ tab, page, browser, wait, assert }` as their first argument. Additional `args` follow it. `args` that is neither an array nor `null`, or a non-empty `args` with a code string, throws before the run starts; `null` passes no arguments. Plain data, functions, and `RegExp` values are serialized; the function cannot capture Eval-cell closures. Code strings use the same names as globals and allow top-level `await`. A code string returns its trailing expression or top-level `return`, as an Eval cell prints them; one ending in an assignment or a block returns nothing.

The inner `tab` is the full worker helper API. In addition to the direct surface it includes handle-returning `waitFor`/`waitForSelector` and run-scoped `waitForNavigation`/`waitForResponse`. Start a navigation/response wait before the action that triggers it.

Runs use a persistent, per-tab JavaScript runtime with ordinary Eval helpers and full Bun/Node and tool-bridge access. This is API isolation, not a security sandbox. Raw `page.setRequestInterception` and run-added request listeners are cleaned up at run end; `tab.route` handlers persist until `unroute` or tab close.

Code a run hands to `page.evaluate`, `page.evaluateHandle`, `page.$eval`, `page.$$eval`, and `page.waitForFunction` runs in the page's main world, where `tab.evaluate` runs and page globals and custom-element members live; element handles passed as arguments are adopted into it. On Chromium tabs omp's stealth patch runs every other Puppeteer evaluation in an isolated world that shares the DOM but not page scripts: `frame.evaluate`, `elementHandle.evaluate`, and any other `Page` object (`tab.page`, `frame.page()`, `browser.pages()`). Selectors resolve there too, so pass a handle to `page.evaluate(fn, handle)` to read what page scripts attached to it. A handle to a non-element value works only in the world that made it, so create one for `page.evaluate` with `page.evaluateHandle`.

The return value stays structured. Only a value matching the full observation shape receives observation printing; other structured returns, including objects with an `elements` array, keep native inspection. Nonempty text printed inside the run (`print`, `console.*`) prints in the outer Eval cell, printed images remain Eval output, and a run with no printed text emits no placeholder.

## Python API

Python exposes the same handles and direct method names, including `browser.tabs()`. `open` and `close` use keyword arguments, while `browser.tab` and `tab.id`/`tab.ref` synchronously create proxies. Keyword arguments on direct helpers become a trailing JavaScript options object.

```python
tab = await browser.open(name="main", url="https://example.com")
observation = await tab.observe(viewportOnly=True)
await tab.id(observation["elements"][0]["id"]).click()
title = await tab.run("return await tab.title();", timeout=30)
await tab.close()
```

Python `tab.run` accepts a JavaScript string only; it does not accept a Python callable.

## Browser modes

`browser.open` first uses an explicit `app`: a CDP URL, executable path, `"relay"`, `"chromium"`, or `"own"`. Otherwise it considers the configured relay (`browser.relay`, overridden by `PI_BROWSER_RELAY=1|0`), configured CDP (`browser.cdpUrl`), cmux, then project-shared managed Chromium. `app: "auto"` skips the relay; `app: "own"` and `app: "chromium"` select managed Chromium directly. Retired `"tern"` and `"webkit"` keywords fail explicitly.

- **Managed Chromium:** creates an zeta-owned page in project-shared Chromium and applies stealth patches. Installation happens automatically on first use. `headed` overrides the default hidden mode.
- **Spawned (`app` executable path):** starts or reuses a CDP-enabled browser/Electron executable. `argv` applies only here; Chromium-family processes use an zeta-owned profile unless args specify `--user-data-dir`.
- **Connected (`app` CDP URL):** attaches to an existing HTTP CDP discovery endpoint.
- **Relay (`app: "relay"`):** drives the user's real Chrome. Opening a new name without `target` creates zeta's own background tab, leaving the user's selected tab and window focus alone (an extension installed before this release selects the new tab instead; reinstall it with `zetacode browser-relay install`); `url` navigates that tab, and screenshots capture it without raising it. With several browsers on one relay, a new tab opens in the browser of the tab zeta used last on that relay (for a page `tab.run` opens, the browser of its own tab), else the browser showing the first selected tab in the relay's tab list (whether or not its window is minimized), else the browser whose extension connected last. `target` borrows an existing tab by exact CDP target id or URL/title substring. Reopening a name that is already open keeps its tab, borrowed or owned.
- **Retired backends:** Zeta does not ship Tern or a WebKit host. No engine is installed or launched for these backends.
- **Cmux:** drives an available cmux WKWebView surface.

Automatic cmux belongs to the interactive Zeta process in that terminal. Child commands inherit `PI_TERMINAL_OWNER_PID`, so a separate CLI process does not adopt its parent's pane automatically.


Reusing one tab name across browser kinds is rejected until the existing tab is closed. Closing Zeta-owned Chromium pages, tabs Zeta opened in the relay, and owned cmux surfaces closes them. Connected pages and borrowed relay tabs remain open. Spawned browser processes remain open unless `kill: true` releases their last managed tab and terminates an application owned by this process; reused processes are never killed.

Managed Chromium has printing turned off, so a page's `window.print()` returns at once and opens no print preview; `tab.pdf()` still makes PDFs. In a browser zeta attaches to (the relay, an `app` CDP URL or executable path) the preview still opens and holds the page until the user cancels it or the tab navigates away.

On Linux under X11, Chrome 150 and later activates its window when a mouse button or touch goes down in the tab that window shows while the window is inactive, zeta's CDP input included (`ContentsWebView::DidGetUserInteraction` requests focus for the page's view on such a press). In the relay, a connected browser or any other headed Chrome, `click`, `dblclick`, `tap`, `drag`, `mouseDown`, `clickAt`, a `check` or `uncheck` unless the element already has the requested state (one that refuses the change still presses; unchecking a native radio does not press), and `uploadFile` on anything but an `<input type=file>` therefore bring Chrome to the front when they target a shown tab while the user is in another window, and what the user types next goes to the page; zeta does not put their app back. A control that opens a new tab or popup may still bring Chrome forward, however it is activated. The agent's browser guide carries this note on Linux hosts, and elsewhere when `browser.cdpUrl` or `browser.relayUrl` points at another machine. Keys (`type`, `fill`, `press`), `focus`, `select`, `hover`, wheel scrolling and screenshots leave the user's app in front, as does input to a tab its window is not showing; native-Wayland Chrome under GNOME does not activate either.

## Screenshots and output

`tab.screenshot({ selector?, fullPage?, silent?, annotate?, format?, quality?, ifChanged?, threshold? })` returns a saved path, or `{ path?, changed, revision, pixelChangeRatio }` when change detection is enabled. `format` is `png` or `jpeg`; integer `quality` (0–100) requires JPEG. `threshold` is a changed-pixel ratio from 0–1 and implies change detection. An unchanged tracked capture saves/emits nothing.

Chromium-backed captures never activate the tab or raise its window: a background tab, a minimized window, or a window behind other apps is captured where it is, with its current content, so the user's frontmost app keeps focus. On relay and CDP-attached browsers this includes an adopted tab the user has since switched away from.

Images are saved beneath `browser.screenshotDir`, or the OS temporary directory when unset. Chromium saves full resolution when that directory or an explicit format is supplied; otherwise it saves the resized image. Captures are resampled to CSS pixels and reduced further only to fit the active model's image limits. Capture text reports delivered dimensions and any coordinate mapping. After a scaled viewport screenshot, `clickAt`, `mouseMove`, and drag points use that image's coordinates until the next viewport capture; `css: true` supplies viewport CSS pixels instead. Wheel/scroll deltas and raw `page.mouse` input remain CSS pixels. A known viewport resize invalidates the mapping and requires a fresh screenshot. `silent: true` suppresses image emission. `annotate: true` overlays interactive-element labels and refreshes `tab.id` mappings. Screenshot options accept no output path; `diffScreenshot` and `pdf` have their own output options.

Host result details preserve structured `value` separately from displayed content. Printed text is capped by the shared inline-output policy; over-cap text is stored as a session artifact and the capped text is printed.

## Safety and lifecycle

Relay and attached modes operate on real logged-in sessions; sites attribute actions to the user. Name a target or create a dedicated tab. Never navigate the user's visible tab or take a consequential action without direct authorization.

On macOS, when zeta's input to a relay tab opens a new tab or popup while the user is in another app, Chrome makes itself the active app; the relay puts the user's app back in front for the next half second, unless the user clicks, holds ⌘/⌃, picks an app from Spotlight or a launcher, or switches to another app, or the computer tool owns the desktop. `PI_BROWSER_RELAY_KEEP_FRONT=0` in the relay's environment turns this off.

Each named tab permits one active run; Chromium-backed tabs have one worker, while cmux uses its own backend. A timed-out or aborted run can recycle the worker and invalidate handles. Renderer crashes fail the current call and trigger worker recovery; errors say when the page was reloaded. Tabs belong to the agent that opened them, across `/new`, `/resume`, fork, and branch; `browser.close({ all: true })` releases only that agent's tabs. `kill` never terminates relay or CDP-attached browsers.

By default, Zeta-owned managed Chromium tabs freeze at turn settle and unfreeze on next use (`browser.freezeOnTurnEnd = true`). Owned Chromium tabs idle for 1,800 seconds close (`browser.idleCloseSec`; `0` disables this). `persist: true` opts out of both policies. Relay, connected, spawned, and cmux tabs are not auto-frozen or idle-closed. When a session ends, relay tabs Zeta opened close, except `persist` ones, which stay open in the user's Chrome.

## Common recovery

- Missing/dead tab: call `browser.open` again.
- Stale id/ref: call `observe` or `ariaSnapshot` again, then reacquire the handle. A click through a handle or an `aria-ref` whose element the page replaced fails at once; `tab.click`, `dblclick`, `check`, `uncheck`, `uploadFile` and `frame.click` given a selector look it up again instead.
- Busy tab: await the active helper/run before issuing another.
- Selector timeout: re-observe and use a supported selector.
- Relay unavailable: install/start the relay and verify its Chrome extension connection.
- Attached target missing: inspect available pages and use a precise `target`.

`tab.run` and direct helpers execute against live browser state. Verify the actual page after every UI-changing action.
