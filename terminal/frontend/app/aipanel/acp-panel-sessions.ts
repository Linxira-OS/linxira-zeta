// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Maps the panel session-list RPC payload into the picker state. The RPC
// returns ACP's session/list shape; this module is the only place that needs
// to know its wire fields.

export type AcpSessionInfo = {
    sessionId: string;
    cwd: string;
    title: string | null;
    updatedAt: string | null;
    messageCount: number | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
    if (value == null || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}

function parseMessageCount(meta: unknown): number | null {
    const record = asRecord(meta);
    if (!record) {
        return null;
    }
    const count = record.messageCount;
    return typeof count === "number" && Number.isFinite(count) ? count : null;
}

export function parseAcpSessionList(raw: unknown): AcpSessionInfo[] {
    const payload = asRecord(raw);
    const entries = Array.isArray(raw) ? raw : Array.isArray(payload?.sessions) ? payload.sessions : [];
    const sessions: AcpSessionInfo[] = [];
    const seen = new Set<string>();
    for (const entry of entries) {
        const record = asRecord(entry);
        if (!record || typeof record.sessionId !== "string" || record.sessionId === "") {
            continue;
        }
        if (seen.has(record.sessionId)) {
            continue;
        }
        seen.add(record.sessionId);
        sessions.push({
            sessionId: record.sessionId,
            cwd: typeof record.cwd === "string" ? record.cwd : "",
            title: typeof record.title === "string" && record.title.trim() !== "" ? record.title.trim() : null,
            updatedAt: typeof record.updatedAt === "string" && record.updatedAt !== "" ? record.updatedAt : null,
            messageCount: parseMessageCount(record._meta),
        });
    }
    return sessions;
}

export function shortSessionId(sessionId: string | null | undefined): string {
    if (!sessionId) {
        return "";
    }
    return sessionId.length <= 8 ? sessionId : sessionId.slice(0, 8);
}

export function sessionDisplayTitle(session: AcpSessionInfo | null, fallback: string): string {
    return session?.title ?? (shortSessionId(session?.sessionId) || fallback);
}

export function sessionUpdatedLabel(updatedAt: string | null): string {
    if (!updatedAt) {
        return "";
    }
    const date = new Date(updatedAt);
    if (Number.isNaN(date.getTime())) {
        return "";
    }
    return date.toISOString().slice(0, 10);
}
