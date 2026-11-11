/**
 * Guard: removed fake surfaces must not come back.
 *
 * The Studio renderer once shipped a static Team/Channels prototype and a
 * `?preview=1` fixture switch that worked in packaged builds. Both are gone;
 * this test fails if either is reintroduced, or if the preview switch loses its
 * development-build gate.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const HERE = import.meta.dir;
const APP = readFileSync(join(HERE, "App.tsx"), "utf8");
const PREVIEW_CONTEXT = readFileSync(join(HERE, "preview", "PreviewContext.tsx"), "utf8");
const EN = readFileSync(join(HERE, "i18n", "locales", "en.ts"), "utf8");
const ZH = readFileSync(join(HERE, "i18n", "locales", "zh.ts"), "utf8");

describe("removed prototype surfaces", () => {
	test("the static prototype Team directory is gone", () => {
		expect(existsSync(join(HERE, "team"))).toBe(false);
	});

	test("the mock messaging adapter block is gone", () => {
		expect(EN.includes('"channels": "Channels"')).toBe(false);
		expect(ZH.includes('"channels": "频道"')).toBe(false);
		expect(APP.includes("TIM adapter")).toBe(false);
		expect(APP.includes("tp-channel")).toBe(false);
	});
});

describe("preview fixture gate", () => {
	test("?preview=1 is routed through the development-build check", () => {
		expect(PREVIEW_CONTEXT.includes("previewForcedByQuery(window.location.search, isDevBuild())")).toBe(true);
		expect(PREVIEW_CONTEXT.includes('get("preview") === "1"')).toBe(false);
	});
});
