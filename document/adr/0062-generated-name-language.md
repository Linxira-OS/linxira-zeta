# 0062. Automatically generated names follow the selected language without translating identity

- **Status:** Proposed
- **Date:** 2026-11-16
- **Deciders:** Zeta maintainers
- **Links:** [REQ-111](../requirements-ledger.md), [Session titles](../../docs/session.md), [Title prompt override](../../docs/config-usage.md#session-title-prompt-override), [Task labels](../../docs/tools/task.md)

## Context

Automatic session names come from three model paths that share one policy surface: the bundled tiny title model (`src/prompts/system/title-system.md`), the side-turn fork of the first reply plus its card request (`title-fork.md`, `title-card.md`), and refreshes through `/rename` or the title-refresh policy. Spawned subagents get a generated label from the same title model with `src/prompts/system/task-label.md`. All bundled prompts are currently English and the generated names are English regardless of the interface language.

Two language stores exist today and they are not the same thing. `cfgLanguage` (`packages/coding-agent/src/zeta-settings.ts`) is the effective native `language` setting used by the CLI/TUI, read through a session's `Settings` instance. Work Studio's `resolvedLanguage` is renderer-local state (Studio i18n in `web-ui` and `web-app`). The renderer does not currently convey that choice to the native process. Writing the renderer's choice into the global `language` setting would make one view's language change every other view's native text and could change the CLI's language, which violates the existing single-authority boundary for settings and per-session policy.

Automatic names also coexist with identity data that must never be translated: explicitly typed session names, names with `titleSource: "user"`, agent spawn handles, immutable session and agent ids, and caller-supplied naming policies such as the plan-save filename topic and a `TITLE_SYSTEM.md` override. Card-form titles carry an ASCII-only 1–6 character code beside an icon (`src/utils/title-card.ts`); that parse contract does not change.

## Decision

The selected language is a generation policy, not a translated copy of another name. When the effective selected language is `zh`, automatically generated session titles and task labels are written in Simplified Chinese; when it is `en`, they keep the current English policy. The language is carried by each naming-bearing prompt, steer, or follow-up invocation and by the turn it starts; it is never a process-global native setting mutation or a durable session field.

- **CLI, headless, ACP, task, and eval callers** read the effective native `language` setting from the `Settings` instance they already own. The English default and all existing configuration behavior remain unchanged.
- **Work Studio renderers** pass their resolved UI language with naming-bearing commands (prompt, steer, follow-up, and any Host equivalent). The Host forwards that value in the native command options. The runtime resolves it synchronously when the message is admitted: an explicit value is used as sent, and an omitted value captures the effective `language` setting at that same admission before any await. The captured value is attached to the exact prompt message and to the turn it starts, so a later settings switch, a concurrent prompt from another view, or a queued steer/follow-up that has not been admitted cannot change an already-issued title, card, or task-label generation. There is no session-wide language override and no write to `config.yml`; omitted values therefore never inherit a prior view's choice.
- **Prompt policy stays static.** The bundled markdown prompts carry an explicit Chinese branch that asks for a concise title or label in Simplified Chinese even when the assignment text is English. No second model request, retry, sample, or post-generation dictionary translation is introduced. A caller-supplied system prompt (`TITLE_SYSTEM.md`, plan-save filename topic) is used exactly as supplied; the language branch is not appended to it.
- **Identity is copied, not translated.** Chinese titles and labels keep code identifiers, API and product names, file paths, CLI flags, version numbers, and proper nouns exactly as written. Card codes remain 1–6 ASCII capitals or digits; under Chinese they may use a Latin technical term or pinyin initials, but never Chinese characters. Icon and code parsing, card retention, and formatting are unchanged.
- **Explicit names and history are outside the policy.** Typed names, names whose source is `user`, existing auto names from before a language change, agent handles, and immutable session/agent ids are never translated, regenerated, or overwritten by language selection. A language change affects only names generated afterwards; the existing refresh policy still decides whether an automatically named session may be renamed later.
- **Mobile remote development remains deferred** under ADR 0034; this decision adds no mobile surface.

## Consequences

Users who work in Chinese get readable Chinese names for new sessions and spawned tasks instead of English names extracted from English assignments, while technical terms stay searchable and stable. English users see no prompt-policy change. Explicit names and ids stay byte-for-byte stable, so scripts, resume-by-id, `/rename`, and handle-based agent references keep working.

The prompt command contracts gain one optional language value each; no persisted setting or session state is added. An invocation that omits it captures the effective `language` setting at admission, so behavior is unchanged unless a renderer sends the value. Tests must inspect captured provider requests for the tiny, fork/card, deferred-retitle, refresh, and queued task-label paths, plus absence of translation for a caller-supplied prompt and preservation of a typed name. No external provider call is required: fixtures capture the request and return a Chinese title.

Because each generation owns its captured value, a title or label already in flight is unaffected by a later language switch, and reopening a session in a different language does not rewrite its existing name; the next eligible generation captures the new value. A process that only uses `language: en` and never sends a per-command value behaves exactly as before. The choice does not change the card icon/code grammar, the `title.generator`/`title.icons` settings, or existing title refresh gates.

## Alternatives

- **Persist the Work Studio language as the global `language` setting.** Rejected: it makes one view's choice drive every view and the CLI, contradicts the per-message/turn policy boundary, and creates cross-view language bleed.
- **Store the last language on the live session.** Rejected: a concurrent or queued prompt from another view could change an already-issued generation, and an omitted command would wrongly inherit the previous view's choice.
- **Translate generated names after generation with a fixed dictionary.** Rejected: it cannot preserve identifiers reliably, adds a second processing stage, and would translate proper nouns.
- **Infer the language from the user's message on every request.** Rejected: an English assignment under a Chinese interface must still produce a Chinese name per the user's selected language, and inference adds an unrequested model decision.
- **Only localize renderer labels while leaving native names English.** Rejected: the persisted session title and task label would still be English after reload or in other clients.
- **Do nothing.** Rejected by the selected-language requirement; it leaves mixed-language UI and assignments producing English persisted names.

## Links

- Source: `packages/coding-agent/src/utils/title-generator.ts`, `packages/coding-agent/src/task/label.ts`, `packages/coding-agent/src/session/agent-session.ts`
- Prompts: `packages/coding-agent/src/prompts/system/title-system.md`, `title-fork.md`, `title-card.md`, `task-label.md`
- Card grammar: `packages/coding-agent/src/utils/title-card.ts`
- Docs: `docs/session.md`, `docs/config-usage.md`, `docs/system-prompt-customization.md`, `docs/settings.md`
- Requirements: REQ-111
