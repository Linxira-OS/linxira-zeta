/**
 * Embedded workflow command templates.
 *
 * Kept in a leaf module (no `discovery`/`capability` imports) so the
 * command-description guard in `src/i18n/command-descriptions.test.ts` can read
 * the command list without pulling the whole CLI graph at test time.
 */
import { prompt } from "@linxiraos/pi-utils";
import { M } from "../i18n";
import initMd from "../prompts/agents/init.md" with { type: "text" };

export const EMBEDDED_COMMANDS: ReadonlyArray<{ name: string; content: string }> = [
	{ name: "init.md", content: prompt.render(initMd) },
];

/**
 * Catalogue-backed descriptions for embedded workflow commands, keyed by the
 * command name (file name without `.md`).
 *
 * Every embedded command MUST have an entry here so its picker copy follows
 * `/language`; the guard fails if an embedded command is missing, or if an
 * entry is not a thunk.
 */
export const EMBEDDED_COMMAND_DESCRIPTION_KEYS: Readonly<Record<string, () => string>> = {
	init: () => M.cmdInitGenerateAgentsMd,
};
