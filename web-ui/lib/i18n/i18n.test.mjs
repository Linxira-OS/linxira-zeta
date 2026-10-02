import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { enLocale } from "./messages/en.ts";
import { zhCNLocale } from "./messages/zh-CN.ts";
import { formatRelativeTime, interpolateMessage, translateMessage } from "./format.ts";
import { getLocalePlugin, getSupportedLocales, registerLocale, resolveBrowserLocale } from "./registry.ts";

test("interpolates string and numeric parameters", () => {
  assert.equal(interpolateMessage("Hello, {name} ({count})", { name: "Zeta", count: 2 }), "Hello, Zeta (2)");
});

test("leaves unknown placeholders untouched", () => {
  assert.equal(interpolateMessage("Keep {unknown}", {}), "Keep {unknown}");
});

test("translates from a built-in locale", () => {
  const zh = zhCNLocale.messages;
  assert.equal(translateMessage("zh-CN", "send", { en: enLocale.messages, "zh-CN": zh }), zh.send);
});

test("falls back to English and returns the key when both are missing", () => {
  assert.equal(translateMessage("zh-CN", "send", { en: enLocale.messages, "zh-CN": {} }), enLocale.messages.send);
  assert.equal(translateMessage("en", "missing.key", { en: {}, "zh-CN": {} }), "missing.key");
});

test("built-in en and zh-CN packs share the exact same key set", () => {
  const enKeys = new Set(Object.keys(enLocale.messages));
  const zhKeys = new Set(Object.keys(zhCNLocale.messages));
  assert.deepEqual(enKeys, zhKeys);
});

test("registry rejects duplicate locale ids", () => {
  assert.throws(() => registerLocale(enLocale), /already registered/i);
});

test("resolveBrowserLocale maps zh variants and falls back to English", () => {
  assert.equal(resolveBrowserLocale(["zh-CN", "en"]), "zh-CN");
  assert.equal(resolveBrowserLocale(["en-GB"]), "en");
  assert.equal(resolveBrowserLocale(["ja-JP"]), "en");
});

test("resolves locale plugins from the registry", () => {
  assert.equal(getLocalePlugin("en")?.label, "English");
  assert.equal(getLocalePlugin("zh-CN")?.label, "简体中文");
  assert.deepEqual(getSupportedLocales(), ["en", "zh-CN"]);
});

test("formats relative time for both locales", () => {
  const now = new Date("2026-08-09T12:00:00Z");
  const past = "2026-08-09T11:59:30Z";
  const en = formatRelativeTime(past, "en", now);
  const zh = formatRelativeTime(past, "zh-CN", now);
  assert.match(en, /second/);
  assert.ok(zh.length > 0);
});

// Keys whose callsites build the key at runtime (template literal, variable,
// ternary, or lookup table) cannot be found by the literal `t("key")` scan
// below. Each entry needs the key prefix plus the reason the callsite is
// dynamic. Keys NOT listed here and not found literally are dead and must be
// removed from the message packs.
const DYNAMIC_KEY_PREFIXES = [
	// SearchDialog renders result headers via t(`search.bucket.${bucket}`)
	// where bucket ranges over BUCKET_ORDER (today|yesterday|prev7|prev30|earlier).
	{ prefix: "search.bucket.", reason: "SearchDialog t(`search.bucket.${bucket}`) over BUCKET_ORDER" },
	// SessionSidebar sort menus render t(`sidebar.sort.${mode}`) for the
	// recent|created|oldest|name|manual mode union.
	{ prefix: "sidebar.sort.", reason: "SessionSidebar t(`sidebar.sort.${mode}`) sort menus" },
	// SidebarHeader display-menu options are data tuples
	// (["manual", "sidebar.display.sort.manual"]) whose key element is fed to
	// t() at render time.
	{ prefix: "sidebar.display.sort.", reason: "SidebarHeader option tuples rendered via t(label)" },
	{ prefix: "sidebar.display.grouping.", reason: "SidebarHeader option tuples rendered via t(label)" },
	// ChatInput BUILTIN_COMMANDS carries descriptions as key strings rendered
	// via t(cmd.description); chat.command/chat.commands are picked through a
	// ternary first argument.
	{ prefix: "chat.command", reason: "ChatInput BUILTIN_COMMANDS description lookup and ternary" },
	// ChatInput THINKING_LEVEL_DESC_KEYS maps thinking levels to keys.
	{ prefix: "chat.thinking-", reason: "ChatInput THINKING_LEVEL_DESC_KEYS lookup" },
	// ChatWindow pluralizes via t(count === 1 ? "chat.message" : "chat.messages")
	// and t(count === 1 ? "chat.tool-call" : "chat.tool-calls").
	{ prefix: "chat.message", reason: "ChatWindow plural ternary" },
	{ prefix: "chat.tool-call", reason: "ChatWindow plural ternary" },
	// ChatInput SLASH_SOURCE_GROUP_LABEL_KEYS maps command sources to keys.
	{ prefix: "chat.built-in", reason: "ChatInput SLASH_SOURCE_GROUP_LABEL_KEYS lookup" },
	{ prefix: "chat.extensions", reason: "ChatInput SLASH_SOURCE_GROUP_LABEL_KEYS lookup" },
	{ prefix: "chat.prompts", reason: "ChatInput SLASH_SOURCE_GROUP_LABEL_KEYS lookup" },
	{ prefix: "chat.skills", reason: "ChatInput SLASH_SOURCE_GROUP_LABEL_KEYS lookup" },
	// FileExplorer maps git status codes to label keys in a lookup table.
	{ prefix: "files.modified", reason: "FileExplorer git-status label lookup" },
	{ prefix: "files.added", reason: "FileExplorer git-status label lookup" },
	{ prefix: "files.renamed", reason: "FileExplorer git-status label lookup" },
	{ prefix: "files.untracked", reason: "FileExplorer git-status label lookup" },
	{ prefix: "files.conflict", reason: "FileExplorer git-status label lookup" },
	// TrackingPanel tab definitions carry labelKey rendered via t(entry.labelKey).
	{ prefix: "tracking.tab.", reason: "TrackingPanel labelKey tab definitions" },
	// DocsPanel docs-tab entries carry labelKey rendered via t(entry.labelKey).
	{ prefix: "web-docs-", reason: "DocsPanel labelKey tab definitions" },
	// settings/shared.tsx CHANNEL_LABEL_KEY and SettingsWindow WEB_SEARCH_KEYS
	// carry these keys as data rendered via t(labelKey).
	{ prefix: "web-channel-wechat", reason: "CHANNEL_LABEL_KEY / WEB_SEARCH_KEYS data" },
	{ prefix: "web-channel-feishu", reason: "CHANNEL_LABEL_KEY / WEB_SEARCH_KEYS data" },
	{ prefix: "web-channel-telegram", reason: "CHANNEL_LABEL_KEY / WEB_SEARCH_KEYS data" },
];

test("every message key is referenced by a literal t() call in product source", () => {
  const webUiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const sourceRoots = ["components", "hooks", "lib", "app"].map(dir => path.join(webUiRoot, dir));
  const usedKeys = new Set();
  // \bt\( only matches the standalone `t` identifier (no word char before it),
  // so calls like `.split("...")` or `format("...")` cannot produce matches.
  const literalCall = /\bt\(\s*(['"])([^'"\n]+)\1/g;
  const walk = dir => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx|mjs)$/.test(entry.name)) {
        const text = fs.readFileSync(full, "utf8");
        for (const match of text.matchAll(literalCall)) usedKeys.add(match[2]);
      }
    }
  };
  for (const root of sourceRoots) walk(root);

  const dead = Object.keys(enLocale.messages).filter(
    key => !usedKeys.has(key) && !DYNAMIC_KEY_PREFIXES.some(({ prefix }) => key.startsWith(prefix)),
  );
  assert.deepEqual(
    dead,
    [],
    `Dead i18n keys (defined in en.ts but never used via a literal t() call in components/ hooks/ lib/ app/): ${dead.join(", ")}`,
  );
});