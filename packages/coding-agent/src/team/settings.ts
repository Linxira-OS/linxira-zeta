/**
 * Settings declared by this domain (see `config/registry.ts`). Declaration
 * order is the settings-panel order; `config/all-settings.ts` registers every
 * domain.
 */
import { register } from "../config/registry";

const EMPTY_STRING_ARRAY: string[] = [];

/**
 * Operator-approved high-risk skills for Team PM → engineer assignment.
 *
 * Only plugin/registry-sourced skills (which can ship hooks or tools) need an
 * entry. Entries match a bare skill name, `<provider>:<name>`, a provider id,
 * `provider:*`, `*`, or a glob over the name/qualified form.
 */
export const cfgTeamSkillAllowlist = register({
	id: "team.skillAllowlist",
	type: "array",
	default: EMPTY_STRING_ARRAY,
	ui: {
		tab: "interaction",
		group: "Team",
		label: "Team Skill Allowlist",
		description:
			"High-risk plugin/registry skills a PM may assign to its engineers (name, provider:name, provider, or glob)",
	},
});
