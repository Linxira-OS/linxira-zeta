import { type ComposerStyle, registerComposerStyle } from "../index";
import { tuiText } from "../i18n";
import type { SubmenuOption } from "./settings-defs";

/** Composer shape id; extensions may register additional values at runtime. */
export type ComposerShape = string;

/**
 * Built-in composer choices and their shared settings/setup copy. Labels and
 * descriptions resolve through `tuiText` on every read (getter, not cached
 * field) so a runtime language switch applies to the next rendered selector.
 */
export const BUILTIN_COMPOSER_SHAPES = [
	{
		value: "band",
		get label() {
			return tuiText("composerShapeBandLabel", "Status Band (Default)");
		},
		get description() {
			return tuiText("composerShapeBandDesc", "Flush soft-capped status band above a curved prompt, no frame");
		},
	},
	{
		value: "box",
		get label() {
			return tuiText("composerShapeBoxLabel", "Rounded Box");
		},
		get description() {
			return tuiText("composerShapeBoxDesc", "Status line embedded in top border, compact 2-line prompt");
		},
	},
	{
		value: "claude",
		get label() {
			return tuiText("composerShapeClaudeLabel", "Claude Code");
		},
		get description() {
			return tuiText(
				"composerShapeClaudeDesc",
				"Full-width horizontal rules above and below, status line at bottom",
			);
		},
	},
	{
		value: "pi",
		get label() {
			return tuiText("composerShapePiLabel", "Pi");
		},
		get description() {
			return tuiText("composerShapePiDesc", "Framed horizontal rules with status line at bottom");
		},
	},
	{
		value: "borderless",
		get label() {
			return tuiText("composerShapeBorderlessLabel", "Borderless");
		},
		get description() {
			return tuiText("composerShapeBorderlessDesc", "Clean prompt glyph with status line at bottom, no box borders");
		},
	},
	{
		value: "rule",
		get label() {
			return tuiText("composerShapeRuleLabel", "Top Rule Dock");
		},
		get description() {
			return tuiText("composerShapeRuleDesc", "Single top rule with status docked onto it and below");
		},
	},
	{
		value: "field",
		get label() {
			return tuiText("composerShapeFieldLabel", "Compact Field");
		},
		get description() {
			return tuiText("composerShapeFieldDesc", "Filled one-row field with accent end caps");
		},
	},
	{
		value: "rail",
		get label() {
			return tuiText("composerShapeRailLabel", "Accent Rail");
		},
		get description() {
			return tuiText("composerShapeRailDesc", "Filled one-row field anchored by a single accent rail");
		},
	},
];

/** Built-in composer ids used by tests and non-runtime consumers. */
export const COMPOSER_SHAPE_VALUES = BUILTIN_COMPOSER_SHAPES.map(shape => shape.value);

/** Visual composer style and selector copy registered by an extension. */
export interface ComposerShapeDefinition {
	label: string;
	description?: string;
	style: ComposerStyle;
}

const extensionComposerShapes = new Map<string, SubmenuOption>();

/** Install one extension composer shape into rendering and selector registries. */
export function installExtensionComposerShape(definition: ComposerShapeDefinition): () => void {
	const unregisterStyle = registerComposerStyle(definition.style);
	const id = definition.style.id;
	const option: SubmenuOption = {
		value: id,
		label: definition.label,
		description: definition.description,
	};
	extensionComposerShapes.set(id, option);
	return () => {
		if (extensionComposerShapes.get(id) === option) extensionComposerShapes.delete(id);
		unregisterStyle();
	};
}

/** Available built-in and extension composer choices in selector order. */
export function getComposerShapeOptions(): readonly SubmenuOption[] {
	return [...BUILTIN_COMPOSER_SHAPES, ...extensionComposerShapes.values()];
}
