# GUI settings

`zetawork` (the egui desktop shell in `main/crates/zetawork-gui`) has two
settings surfaces. This page says which one owns what, how a value travels to
disk, and how the UI language reaches both the static strings and the schema
labels. The user-facing counterpart is [Settings](./settings.md); the gateway
contract is in [Web UI API](./web-ui/api.md).

## Two surfaces, one complete one

| Surface | Source of truth | What lives there |
| --- | --- | --- |
| 全部设置 (`Section::All`) | `GET /api/settings` on the running web gateway (`webUrl` in `~/.zeta/serve.json`; `statsUrl` is a different listener) | The complete zetacode/desktop schema: 10 tabs, 64 groups, 356 rows on this tree, of which 319 are visible (37 are hidden by their schema conditions; 393 keys carry UI metadata, and the remaining 37 have no control shape — arrays and numbers without declared choices stay config-file-only, exactly as in the CLI). Bool, enum/submenu, number, string, path-like string, credential, multiselect, provider-limit and model-role controls. |
| The eight native sections | `~/.zeta/zetawork.toml` (`settings.rs`, 14 managed keys) and process state | 常规 (close policy, autostart, notifications, update check, residency), 外观 (theme, density, motion), 编辑器 (font, size, wrap, gutter + the five `zetacode config set` rows), 终端 (shell, font size), 快捷键, 项目 (the shared registry), 管理 (providers, storage), 关于 (scope, fonts, version). |

The native sections stay because they control things the schema does not own:
the window lifecycle, egui's own theme and fonts, the shell to spawn when the
user opens a terminal, the project registry, and the desktop updater. The
schema section is the single place a zetacode setting can be found; a setting
that has UI metadata in `settings-schema.ts` is rendered here, so no setting is
reachable only from `web-ui`.

Rows whose schema condition is false arrive with `visible: false` and are not
drawn. Rows without UI metadata (for example arrays with no declared choices)
are not in the payload at all — the gateway and the CLI agree on that set, and
the section reports the counts it actually received in its header line.

## Reading and writing

```
GET /api/settings?lang=zh|en      → tabs[] · groups{tab: [heading]} · settings[]
PUT /api/settings {path, value}   → 200 {ok:true}
```

`Settings schema` section state lives in `settings_schema.rs`:

- `parse_catalog` turns the response into `Catalog { tabs, groups, entries }`.
  It is strict about the envelope and tolerant about one entry's optional
  fields: a missing label falls back to the path, a missing group is
  ungrouped, an unknown `type` falls back to a text field.
- `Catalog::tree(query)` builds tab → group → row. Ungrouped rows sort first,
  then groups in the gateway's declared order; a group the gateway emitted
  without listing is appended in first-seen order. Invisible rows never enter
  the tree.
- A write is `PUT` followed by a fresh `GET`. The controls redraw from the
  gateway's answer, never from an optimistic local edit. A failed write or
  read leaves the old catalog in place and shows the gateway's `error` text.
- A finished request is polled once per frame in `Shell::tick`. A failed
  language is remembered, so an unreachable gateway is not retried on every
  frame; the section's 重试 button forces a new attempt.

### Control mapping

| Gateway `type` | Control | Value written |
| --- | --- | --- |
| `boolean` | switch | JSON boolean |
| `enum` / `submenu` with options | combo box of localized labels | the option's raw `value` |
| `enum` with `values` only | combo box of raw values | the value |
| `submenu` with no options (runtime list) | current value, read-only | — |
| `number` | text field, integer shape kept unless a fraction is typed | JSON number |
| `text` | text field, committed on Enter/blur | JSON string |
| `text` + `secret: true` | masked value + empty password field + 保存 | the newly typed string only |
| `multiselect` | one checkbox per option | JSON array of selected values |
| `providerLimits` | monospace JSON object editor | parsed JSON object |
| `modelRoles` | monospace JSON object editor | parsed JSON object |

Strings are plain `text` rows (the gateway does not distinguish a path); a
`text` row whose current value is an object or array — the fallback-chain and
approval-rule settings — is edited as JSON so the value keeps its shape.
Paths render as a monospace field with the full value, not a truncated one.

### Search

The search box filters the whole tree before a tab is drawn. Lowercase
substring matching runs against the row label, description, dot path, group
heading, tab label and option labels. A tab-name match keeps all of that tab's
visible rows; a group-heading match keeps that group; otherwise only matching
rows survive and empty groups/tabs disappear. An empty result shows 没有匹配的设置,
not the full list.

### Secrets

The gateway masks credentials (`"••••"`, `secret: true`). `Entry::display_value`
is the only function that turns a value into display text, and for
`ControlKind::Secret` it returns the mask regardless of what arrived. The
password field starts empty and is seeded with nothing; the old value is never
read, so it cannot be revealed by the GUI. Typing a value and pressing 保存
sends only the new string.

## Language switching

Static text uses the content-keyed catalogue in `i18n.rs`: the Chinese literal
is the key, the English column is the translation, and `t!` is the identity in
Chinese. Schema content is localized by the **gateway**, so the GUI cannot
translate it locally:

1. `Lang` lives in `settings.lang` (persisted as `lang = zh|en` in
   `~/.zeta/zetawork.toml`).
2. `SchemaCache` records the language its catalog was fetched in.
3. `SchemaCache::ensure` runs while 全部设置 is open. When the language
   selected in the modal differs from `loaded_lang`, it fetches
   `GET /api/settings?lang=<new>` (and sends the matching `Accept-Language`
   header); tab names, group headings, labels, descriptions and option text
   all come back localized. The same exchange is what the web UI's settings
   window uses, so the two surfaces cannot disagree on a label.
4. Switching back is the same path in reverse; a stale response is never shown
   as the new language because the cache keeps the language each catalog was
   read in.

### The i18n guard

`i18n.rs::tests::every_cjk_t_key_has_an_english_row` walks every `.rs` file
under `src/`, extracts each `t!("…")` literal whose text contains a CJK
codepoint, and fails when the literal has no row in `EN`. The rules are
content-based, not an allowlist:

- `t` must not be the tail of an identifier, so `format!("…")`/`assert!("…")`
  are not mistaken for translation calls;
- only literals containing CJK are keys; ASCII literals are identifiers,
  paths or format fragments and are never looked up;
- escapes are decoded before the lookup, so the compared string is exactly
  what `tr` receives;
- the scan must find at least 100 keys, so a broken scan fails instead of
  reporting a green zero-key run.

On this tree the guard sees 513 distinct CJK keys against 518 rows, with zero
missing. Add a new `t!("…")` string and the test fails until the English row
exists.

## Native settings file

`settings.rs` still owns `~/.zeta/zetawork.toml`, a header-less preamble of
`key = value` lines. The writer keeps every line it does not own, preserves a
managed key's line, position and inline comment, appends missing keys, and
falls back per key, so a half-edited file loses only what it lost. The 14
managed keys are listed in `MANAGED`; `lang` is one of them, which is why a
language change survives a restart and is applied before the first frame.

## Verifying

```bash
cd main
PATH="/c/Rust/msys64/ucrt64/bin:$PATH" cargo +1.97.1-x86_64-pc-windows-gnu test -p zetawork-gui
PATH="/c/Rust/msys64/ucrt64/bin:$PATH" cargo +1.97.1 fmt --all -- --check
```

The ignored screenshot cases render both languages:

```bash
ZETA_SHOTS_DIR=<outside-the-tree> cargo +1.97.1 test -p zetawork-gui --test shots -- --ignored settings_all_schema_screenshots
```

`settings_all_schema_screenshots` writes `16-settings-all-en.png` and
`17-settings-all-zh.png` from the committed gateway fixture
(`tests/fixtures/settings-catalog-{en,zh}.json`). It asserts ten tabs and more
than 300 rows before drawing, so the shots are evidence of the schema surface,
not of a hand-made mock.
