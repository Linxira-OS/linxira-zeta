/** @jsxImportSource @linxiraos/pi-tui */
/**
 * The welcome card (`zeta.welcome`): the lockup — the zetacode mark beside the
 * `zetacode` wordmark with the version (and any self-update activity) under it —
 * and the session's tip.
 *
 * Terminal look (`src/ui/styles/welcome/welcome.ts`): the gradient logo and
 * half-block wordmark centered, the tip under it. The intro sweeps the
 * logo's gradient on the terminal clock for {@link INTRO_MS} from
 * `introStart`; a native terminal animates its own builtin mark.
 */
import { type Accessor, computed, type JSXNode, Show, type Signal, signal } from "@linxiraos/pi-tui";
import { registerBlob } from "@linxiraos/pi-tui/native";
import type { TspSpan, TspText } from "@linxiraos/pi-wire";
import type { VersionUpdate } from "../../modes/view-model/prompt/welcome";
import "../styles/welcome";
import { INTRO_MS } from "./logo";
import { isNewTip, type TipKeyStyle, tipText } from "./tips";

/** The real brand mark as a TSP blob; the OMP-only builtin image is not recognized upstream. */
const ZETA_LOGO_BLOB = registerBlob(
	Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAACXBIWXMAAAsTAAALEwEAmpwYAAADgUlEQVR4nO2Zz08TQRTH5y/YaO1SSQxr2IJQAxWj9ITbhq0WOBA0kWIwGC8aTPDqQavgyUSDUUAicpUL3BTEHzE9GsXD/gseRE8a/oBn3sbFdtttl+6ub4b28E2aZnb6vp+ZefvmlUnhCNSzGHUA1GLUAVCLUQdALUYdALUYdQDUYtQBUItRByAkADmdBmUmB+1rK9CZfwuxT/mKwjFtqyugTOdATuviAgjFe0BdXqxquJrUF88g1H1CLAByMgkdH9Y9m7eEc8maJgaAULzHV/O7EN6/hlBXnH8A6tJC8RZenIPI8LAp/OzpOCwv8g1ATqdLzEtNzf/GNDV7hiDrOr8AlPt3i4LFVbePwe+8AFCm7/ALoH1tpXi1UqnSXZJKeQKAr0huAXTmNwMHgL/BLYCY/bwGAADVABBu7ABoHIFwIweAkEnwwNFW85ZXTm6rRaFzgFRNLqrF/Q0gXL1aFKYQipQphb0C6Py4IU4prNovQz4cgbbVl/wCUGZyJQFb12GnxLfXJKjcu80vADmtey5zq0nu7+cXgIQNkefzgZnH/iCVecktgIPHu6Dj3av6bYlJeBQ0zQzYT/PCNEWlv8JWNm5Zz9t+acFx5RNRFR5nNPgyMQI/b1yCnZuXKwrH4NjZjAa9UTVYAJK1G3TdbGPh68teJ5R9z+c3zbH4jFPCk5uaYX4gCb+nxquadtKvqXF4mklCOHI4WACSz0Lzm9mhmo3b9WZ0yDUERm0etTCY3A3+2/WsuRMe6H17Ej6Dz1rzPMkkxQCQiKq72x4NxBSl5rnwWQsCHofTLnICowaACc9atbkBd6tWSTiHNd+jc2f4B7B15XxgAD5PjPAP4EfBq87rEegoOAKo7ckx/gHs2DK4lQRvaYkSZXu6Hec51qKAcfVCyXzCAdhxEJpDk+XmiB5pga8FR2nfATBqNL8vABgezAsPwPBoXmgAhg/mhQVg+GReSABGBfOoa4mTru4CwgDYnhwrqgGwmPHjLoD6LkIhtFXvpfBsgJehh2f7+AfQG1XNq2sQ1+FTaiv/AKRwxGxjubkLVJI9CeI1281vM2rzKGxfbYz61xJbvzgIh1z+fceozRdCwDaWdRxqET6LK+/WvMQTAEvYxsJODmbwwl6Bk3AMjsWE5+bMcw9A+s9i1AFQi1EHQC1GHQC1GHUA1GLUAVCLUQdALUYdALX+ANqgIA+17wgVAAAAAElFTkSuQmCC",
		"base64",
	),
	"image/png",
);

export type { VersionUpdate };

/** Terminal look facts of the card. */
export type WelcomeLook = {
	readonly version: string;
	readonly update: VersionUpdate | null;
	/** Terminal-clock ms the intro started; null at rest. */
	readonly introStart: number | null;
	/** The tip body (keys formatted, links as `link` spans). */
	readonly tip?: TspText;
	/** The tip is a `[NEW]` one (a rainbow tag follows it). */
	readonly isNew?: boolean;
};

/** Download percent, floored so 100% means every byte arrived. */
export function updatePercent(fraction: number): string {
	return `${Math.floor(Math.min(1, Math.max(0, fraction)) * 100)}%`;
}

/** Tone of an update: accent while running, success when ready, warning when failed. */
export function updateTone(update: VersionUpdate): "accent" | "success" | "warning" {
	return update.phase === "ready" ? "success" : update.phase === "failed" ? "warning" : "accent";
}

/** Native spans of an update after the version. */
function updateSpans(update: VersionUpdate): TspSpan[] {
	const tone = updateTone(update);
	const head: TspSpan = { t: ` → v${update.version}`, s: `${tone} mono` };
	if (update.phase === "ready") return [head, { t: " next launch", s: tone }];
	if (update.phase === "failed") return [head, { t: " update failed", s: tone }];
	if (update.fraction === undefined) return [head, { t: " updating…", s: "muted" }];
	return [head, { t: ` ${updatePercent(update.fraction)}`, s: `${tone} mono` }];
}

export interface WelcomeProps {
	readonly version: Accessor<string>;
	readonly update: Accessor<VersionUpdate | null>;
	/** The tips.txt line of the session (see `welcomeTip`); undefined shows none. */
	readonly tip: Accessor<string | undefined>;
	/** How the tip's keys read. */
	readonly keys: Accessor<TipKeyStyle>;
	/** Terminal-clock ms the intro started; null at rest. */
	readonly introStart: Accessor<number | null>;
}

export function Welcome(props: WelcomeProps): JSXNode {
	const body = computed(() => {
		const tip = props.tip();
		return tip === undefined ? undefined : tipText(tip, props.keys());
	});
	const look = (): WelcomeLook => {
		const tip = props.tip();
		const text = body();
		return {
			version: props.version(),
			update: props.update(),
			introStart: props.introStart(),
			...(tip !== undefined && text !== undefined ? { tip: text, isNew: isNewTip(tip) } : {}),
		};
	};
	return (
		<card role="zeta.welcome" term={look}>
			<row key="lockup" role="zeta.welcome.lockup" align="center" gap="md">
				<image key="logo" role="zeta.welcome.logo" blob={ZETA_LOGO_BLOB} alt="Zeta" w={28} />
				<col key="mark" role="zeta.welcome.mark">
					<text
						key="zeta.welcome.wordmark"
						role="zeta.welcome.wordmark"
						spans={[{ t: "zeta", s: "strong" }]}
						wrap="none"
					/>
					<text
						key="zeta.welcome.version"
						role="zeta.welcome.version"
						spans={() => {
							const update = props.update();
							const version: TspSpan = { t: `v${props.version()}`, s: "dim mono" };
							return update ? [version, ...updateSpans(update)] : [version];
						}}
						wrap="none"
					/>
				</col>
			</row>
			<Show when={() => props.tip() !== undefined}>
				<row key="tip" role="zeta.welcome.tip" align="start" gap="sm">
					<icon role="zeta.welcome.tip-icon" name="lightbulb" />
					<text
						role="zeta.welcome.tip-text"
						text={() => {
							const text = body();
							return typeof text === "string" ? text : undefined;
						}}
						spans={() => {
							const text = body();
							return typeof text === "string" ? undefined : text;
						}}
						wrap="word"
					/>
					<Show when={() => isNewTip(props.tip() ?? "")}>
						<shimmer role="zeta.welcome.new" text="New" />
					</Show>
				</row>
			</Show>
		</card>
	);
}

/**
 * The welcome card's state: version, update activity, the latched tip and the
 * intro. `playIntro` starts the sweep on the terminal clock and settles it
 * after {@link INTRO_MS}; a card built with an intro due stays {@link live}
 * until the intro played or was skipped.
 */
export class WelcomeModel {
	readonly version: Signal<string>;
	readonly update = signal<VersionUpdate | null>(null);
	readonly introStart = signal<number | null>(null);
	/** An intro is due: whoever owns startup will {@link playIntro} or {@link skipIntro}. */
	readonly #introDue: Signal<boolean>;
	#timer: Timer | undefined;

	/**
	 * Whether the card may still change: an intro is due or playing. Its transcript block holds
	 * its settle meanwhile, so a terminal keeps repainting it instead of retiring it to history.
	 */
	readonly live: Accessor<boolean> = () => this.#introDue() || this.introStart() !== null;

	constructor(version: string, options?: { readonly intro?: boolean }) {
		this.version = signal(version);
		this.#introDue = signal(options?.intro === true);
	}

	/** Play the intro from `now` (terminal clock); replays when already playing. */
	playIntro(now = Date.now()): void {
		clearTimeout(this.#timer);
		// Start before clearing the due mark: the card never reads as still in between.
		this.introStart.set(now);
		this.#introDue.set(false);
		this.#timer = setTimeout(() => this.stopIntro(), INTRO_MS);
	}

	/** Settle on the resting logo now. */
	stopIntro(): void {
		clearTimeout(this.#timer);
		this.#timer = undefined;
		this.#introDue.set(false);
		this.introStart.set(null);
	}

	/** No intro this launch (a resumed session, a native terminal): the card is final as it is. */
	skipIntro(): void {
		this.#introDue.set(false);
	}
}
