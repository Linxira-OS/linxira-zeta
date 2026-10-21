import { logger } from "@linxiraos/pi-utils";
import {
	type ResumeSourceLike,
	SessionSelectorComponent,
	type SessionHistoryMatcher,
	type SessionSelectorEntry,
	type SessionSelectorOptions,
} from "../overlays/session-selector";
import type { ResumeTreeSource } from "../overlays/resume-tree";
import { runStandaloneTui } from "./standalone-picker";

/** Persistence and history capabilities supplied by the session-owning host. */
export interface SessionPickerHost<T extends SessionSelectorEntry = SessionSelectorEntry> {
	loadPinnedIds?(): Promise<ReadonlySet<string>>;
	loadHistoryMatcher?(): SessionHistoryMatcher;
	deleteSession?(session: T): Promise<boolean>;
	loadAllSessions?(): Promise<T[]>;
	/** Builds the three-level resume source for the standalone `--resume` tree. */
	loadResumeSource?(deleteMode: "trash" | "permanent", workspacePath?: string): Promise<ResumeTreeSource | undefined>;
}

/** Presentation and capability controls for the standalone session picker. */
export interface SessionPickerOptions<T extends SessionSelectorEntry = SessionSelectorEntry> {
	allSessions?: T[];
	title?: string;
	scopeLabel?: string | false;
	showCwd?: boolean;
	allowDelete?: boolean;
	allowGlobalScope?: boolean;
	historySearch?: boolean;
	pinnedIds?: ReadonlySet<string>;
	/** Opt into the three-level resume tree; `deleteMode` words the confirm step. */
	resume?: { deleteMode: "trash" | "permanent"; workspacePath?: string };
	/** The host's resume model; when set, the native picker renders the project tree. */
	resumeSource?: ResumeSourceLike;
	/** Delete wording: in-session moves to trash, `--resume` deletes permanently. */
	deleteMode?: "trash" | "permanent";
}

/**
 * Show the TUI session selector and return the selected session, or null if
 * cancelled. The default OMP picker supports deletion, transcript-history
 * search, and an all-projects scope; foreign import pickers disable those
 * source-owned capabilities.
 */
export async function selectSession<T extends SessionSelectorEntry>(
	sessions: T[],
	options: SessionPickerOptions<T> = {},
	host: SessionPickerHost<T> = {},
): Promise<T | null> {
	// Rank sessions with prompt-history matches too, recovering prompts the 4KB
	// session-list prefix never sees. Best-effort: a missing/locked history.db
	// must not break the picker.
	const pinnedIds = options.pinnedIds ?? (await host.loadPinnedIds?.());

	let historyMatcher: ((query: string) => string[]) | undefined;
	if (options.historySearch !== false) {
		try {
			historyMatcher = host.loadHistoryMatcher?.();
		} catch (error) {
			logger.warn("History storage unavailable for session ranking", { error: String(error) });
		}
	}

	const resumeMode = options.resume?.deleteMode;
	const resumeSource = resumeMode
		? await host.loadResumeSource?.(resumeMode, options.resume?.workspacePath)
		: undefined;

	return runStandaloneTui<T | null>(
		({ ui, finish }) => {
			const selector = new SessionSelectorComponent(
				sessions,
				(session: T) => finish(session),
				() => finish(null),
				() => {
					ui.stop();
					process.exit(0);
				},
				{
					onDelete: options.allowDelete === false ? undefined : host.deleteSession,
					historyMatcher,
					loadAllSessions: options.allowGlobalScope === false ? undefined : host.loadAllSessions,
					allSessions: options.allSessions,
					getTerminalRows: () => ui.terminal.rows,
					fillHeight: true,
					standalone: true,
					title: options.title,
					scopeLabel: options.scopeLabel,
					showCwd: options.showCwd,
					pinnedIds,
					resumeSource: resumeSource ?? options.resumeSource,
					deleteMode: resumeMode ?? options.deleteMode,
				} as SessionSelectorOptions<T> & { resumeSource?: ResumeTreeSource; deleteMode?: "trash" | "permanent" },
			);
			selector.setOnRequestRender(() => ui.requestRender());
			return selector;
		},
		// Present as a fullscreen overlay so the picker borrows the terminal's
		// alternate screen buffer (vim/less idiom): the list scrolls and rows are
		// clickable via the mouse tracking the overlay enables for its lifetime.
		// Anchored top-left at full size so a mouse row maps directly to a rendered
		// line (the overlay paints from screen row 0).
		{
			overlay: {
				anchor: "top-left",
				width: "100%",
				maxHeight: "100%",
				margin: 0,
				fullscreen: true,
			},
		},
	);
}
