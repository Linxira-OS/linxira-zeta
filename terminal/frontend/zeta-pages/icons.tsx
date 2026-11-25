/**
 * Inline SVG subset used by the Team/Rooms pages.
 *
 * Ported from the Studio stroke icon set (16×16, CSS owns size/stroke). Only
 * the seven names these pages render are carried; `Icon` keeps the same
 * `name`/`extra` API so the moved markup is unchanged.
 */
const PATHS = {
	network:
		'<circle cx="8" cy="3.5" r="1.8"/><circle cx="3.5" cy="12" r="1.8"/><circle cx="12.5" cy="12" r="1.8"/><path d="M7 4.8 4.3 10.5M9 4.8l2.7 5.7M5.3 12h5.4"/>',
	refresh: '<path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2v3h-3"/>',
	alert: '<path d="M8 2 14.5 13.5h-13z"/><path d="M8 6.5v3.5M8 11.8v.2"/>',
	x: '<path d="M4 4l8 8M12 4l-8 8"/>',
	plus: '<path d="M8 3v10M3 8h10"/>',
	fork: '<circle cx="4" cy="3.5" r="1.8"/><circle cx="4" cy="12.5" r="1.8"/><circle cx="12" cy="12.5" r="1.8"/><path d="M4 5.3v5.4M4 8.5c4 0 8-1 8 4"/>',
	message: '<path d="M2.5 3.5h11v8h-7l-4 3v-11z"/>',
	box: '<rect x="2" y="2" width="12" height="12" rx="1.5"/>',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, extra }: { name: IconName; extra?: string }) {
	return (
		<svg
			className={extra ? `icon ${extra}` : "icon"}
			viewBox="0 0 16 16"
			aria-hidden="true"
			dangerouslySetInnerHTML={{ __html: PATHS[name] ?? PATHS.box }}
		/>
	);
}
