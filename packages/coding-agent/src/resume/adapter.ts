/**
 * Thin bridge for the current `SessionSelectorComponent`, which still consumes
 * a flat `SessionInfo[]`. The next picker slice should render
 * {@link buildResumeView} rows directly; until then this adapter keeps existing
 * callers compiling and preserves the view's ordering.
 */

import type { SessionInfo } from "../session/session-listing";
import type { ResumeDirectory, ResumeView } from "./types";

/** Sessions in view order (pinned-first, then relevance/recency). */
export function pickerSessionsFromView(view: ResumeView): SessionInfo[] {
	return view.conversations.map(row => row.conversation.session);
}

/** Every conversation in directory order. */
export function pickerSessionsFromDirectory(directory: ResumeDirectory): SessionInfo[] {
	return directory.conversations.map(conversation => conversation.session);
}
