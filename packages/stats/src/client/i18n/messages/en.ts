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

/** Every English message: the source of truth for the key set. */
export const enMessages = {
	...nav.en,
	...common.en,
	...overview.en,
	...models.en,
	...providers.en,
	...costs.en,
	...requests.en,
	...errors.en,
	...traces.en,
	...tools.en,
	...frustration.en,
	...projects.en,
	...gain.en,
	...ui.en,
	...charts.en,
} as const;

/** Keys the dashboard may translate. A `t("…")` call with an unknown key is a type error. */
export type MessageKey = keyof typeof enMessages;

/** The English locale pack, as the registry consumes it. */
export const enLocale = { id: "en", messages: enMessages } as const;
