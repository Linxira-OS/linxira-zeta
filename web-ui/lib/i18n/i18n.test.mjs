import assert from "node:assert/strict";
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