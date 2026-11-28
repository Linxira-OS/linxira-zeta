// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { parseAcpSessionList, sessionDisplayTitle, sessionUpdatedLabel, shortSessionId } from "./acp-panel-sessions";

describe("ACP panel session list mapping", () => {
    it("maps session/list metadata into picker entries", () => {
        const sessions = parseAcpSessionList({
            sessions: [
                {
                    sessionId: "session-1234567890",
                    cwd: "/work/project",
                    title: "  Fix the parser  ",
                    updatedAt: "2026-11-01T10:00:00Z",
                    _meta: { messageCount: 4 },
                },
                { sessionId: "untitled-session", cwd: "/work/project" },
            ],
            nextCursor: "50",
        });

        expect(sessions).toEqual([
            {
                sessionId: "session-1234567890",
                cwd: "/work/project",
                title: "Fix the parser",
                updatedAt: "2026-11-01T10:00:00Z",
                messageCount: 4,
            },
            {
                sessionId: "untitled-session",
                cwd: "/work/project",
                title: null,
                updatedAt: null,
                messageCount: null,
            },
        ]);
    });

    it("accepts a bare array and ignores malformed or duplicate entries", () => {
        const sessions = parseAcpSessionList([
            null,
            { sessionId: "" },
            { sessionId: 42 },
            { sessionId: "dup", title: "First" },
            { sessionId: "dup", title: "Second" },
            { sessionId: "meta", _meta: { messageCount: "3" } },
        ]);

        expect(sessions.map((session) => session.sessionId)).toEqual(["dup", "meta"]);
        expect(sessions[0].title).toBe("First");
        expect(sessions[1].messageCount).toBeNull();
    });

    it("returns no entries for an unusable payload", () => {
        expect(parseAcpSessionList(undefined)).toEqual([]);
        expect(parseAcpSessionList({ sessions: "nope" })).toEqual([]);
    });

    it("formats compact titles, ids, and dates", () => {
        const session = {
            sessionId: "abcdef1234567890",
            cwd: "/work",
            title: null,
            updatedAt: "2026-11-01T23:30:00Z",
            messageCount: null,
        };

        expect(shortSessionId(session.sessionId)).toBe("abcdef12");
        expect(shortSessionId("short")).toBe("short");
        expect(shortSessionId(null)).toBe("");
        expect(sessionDisplayTitle(session, "No session")).toBe("abcdef12");
        expect(sessionDisplayTitle({ ...session, title: "Named" }, "No session")).toBe("Named");
        expect(sessionDisplayTitle(null, "No session")).toBe("No session");
        expect(sessionUpdatedLabel(session.updatedAt)).toBe("2026-11-01");
        expect(sessionUpdatedLabel("not-a-date")).toBe("");
        expect(sessionUpdatedLabel(null)).toBe("");
    });
});
