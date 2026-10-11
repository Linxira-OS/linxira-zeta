import type { MessageKey } from "./en";
import { nav } from "./nav";
import { common } from "./common";
import { overview } from "./overview";
import { models } from "./models";
import { providers } from "./providers";
import { costs } from "./costs";
import { requests } from "./requests";
import { errors } from "./errors";
import { traces } from "./traces";
import { tools } from "./tools";
import { frustration } from "./frustration";
import { projects } from "./projects";
import { gain } from "./gain";
import { ui } from "./ui";
import { charts } from "./charts";

/**
 * Simplified Chinese overrides. Incomplete on purpose in source: the coverage
 * test (`packages/stats/test/i18n-coverage.test.ts`) fails on any missing key,
 * which keeps a half-translated page out of a release without breaking builds
 * mid-flight.
 */
export const zhCNMessages: Partial<Record<MessageKey, string>> = {
	...nav["zh-CN"],
	...common["zh-CN"],
	...overview["zh-CN"],
	...models["zh-CN"],
	...providers["zh-CN"],
	...costs["zh-CN"],
	...requests["zh-CN"],
	...errors["zh-CN"],
	...traces["zh-CN"],
	...tools["zh-CN"],
	...frustration["zh-CN"],
	...projects["zh-CN"],
	...gain["zh-CN"],
	...ui["zh-CN"],
	...charts["zh-CN"],
};

/** The Simplified Chinese locale pack. */
export const zhCNLocale = { id: "zh-CN", messages: zhCNMessages } as const;
