# Old web-ui settings / model-config gap (2026-11-12)

Source: frozen `web-ui/` at `e528e6c18de` (archive `web-ui-zetawork-gui-2026-11-12`).
Current: `web-app/src/studio/`. Status values: implemented, partial, missing.
This table is the audit for the `feat/webui-model-config` lane; it is not a
release-facing feature document.

| Old feature / path | Current path | Status |
| --- | --- | --- |
| `components/settings/SettingsWindow.tsx` window chrome, left group nav, in-page search | `SettingsPage.tsx` group tabs via `SlidingTabs`; no schema-wide search box | partial: groups and tabs are equivalent, schema-wide search is missing |
| `components/settings/shared.tsx` `useSettingsData` / `SettingsTabBody` generic `GET /api/settings` catalog | `settings/SchemaSettingsPane.tsx` + `settings/schemaSettings.ts` + `settings/schemaSettingsClient.ts` (added this lane) | implemented: tabs, groups, visible conditions, query filter, load/retry |
| Generic boolean rows | `settings/Runtime1844Rows.tsx` (`GUI_SETTING_DEFINITIONS`) + `settings/FeatureSettingsPane.tsx` + `SettingRow`; new schema pane | partial in hand-coded panes (only declared keys); implemented for the full schema in `SchemaSettingsPane` |
| Generic enum rows | `AppSelect` in `Runtime1844Rows` / `FeatureSettingsPane`; new schema pane | partial in hand-coded panes; implemented in schema pane |
| Generic number rows | Gateway maps numbers with options to `submenu`; new schema pane renders the select | partial: numbers without options stay config-file-only by design |
| Generic text rows | `Runtime1844Rows` text field; `FeatureSettingsPane` text/list fields; new schema pane | partial in hand-coded panes; implemented in schema pane |
| Generic text + `secret` | `SecuritySettingsPane`, `ImChannelsPane` own their credentials; new schema pane renders an empty password field and never shows `••••` | implemented in schema pane; pane-specific secrets remain pane-specific |
| Generic `submenu` with options | `FeatureSettingsPane` option selects; new schema pane select | implemented |
| Generic `submenu` with no options (runtime theme list) | new schema pane read-only current value | implemented |
| Generic `providerLimits` JSON object editor | `settings/SchemaSettingsPane.tsx` textarea + Apply | implemented (was missing) |
| Generic `modelRoles` JSON object editor | `ModelConfigPage` role editor handles assignments; `SchemaSettingsPane` can edit the raw map | implemented in model page; generic row added here |
| Generic `multiselect` checkbox row | new schema pane one checkbox per option; `FeatureSettingsPane` list rows use newline textareas | implemented in schema pane; partial in hand-coded panes |
| `WebTabContent` / web/bot config + WeChat QR login | `settings/ImChannelsPane.tsx` + `imChannelsApi.ts` | implemented |
| `components/settings/RemotePairing.tsx` | `settings/SecuritySettingsPane.tsx` + `securityApi.ts` | implemented/remapped |
| `SettingsWindow` appearance tab (theme/density/radius/fonts) | `GeneralTab`, `NativePreferencesPane`, `FontSettings`, `ConversationWidthSettings` | implemented |
| Docs tab (`DocsPanel`) | none in `SettingsPage` | missing; docs are available outside the settings page |
| Schema condition `visible: false` | `SchemaSettingsPane` filters `visible` | implemented |
| Project-override badge after write | `SettingRow` source badge; schema pane cannot know the winning layer from `GET /api/settings` | partial |
| `components/ModelsConfig.tsx` provider CRUD, auth/OAuth/API key, discovery, custom models, roles | `ModelConfigPage.tsx` + `models/*` | implemented |
| `ModelsConfig.tsx` full provider/model `compat` JSON editor (`CompatEditor`) | only `requiresThinkingPresence`, `extendedCacheTtlBeta` and `bedrockMessagesApi` toggles | missing |
| `ModelsConfig.tsx` OpenAI-compatible URL import (`handleImport`) | `models.provider.probe` / `models.discovery.refresh` + fetched candidates in the editor | partial: probe + form import, no one-shot URL write |
| `ModelsConfig.tsx` role matrix | `ModelConfigPage` roles tab / `PurposeCategoryCards` | implemented |
| `components/studio/pages/SettingsPage.tsx` (hosts `SettingsWindow` + `ModelsConfig`) | `SettingsPage.tsx` custom panes + separate `ModelConfigPage` route | implemented/remapped |
| `app/settings/page.tsx` deep link redirect | settings intent/session storage in `SettingsPage.tsx` | implemented |
| `studio/ModelConfigPage.tsx` YAML source editors | same path; whole-document Import Config accepts block YAML or standard JSON | implemented in this lane |

Selected slice: **generic schema rows** (`Settings → All Settings`), because it
restores hundreds of schema keys without backend/contract churn. A provider/model
`compat` JSON editor remains a follow-up: it needs read-model and writer changes
in both contract copies plus the Host.
