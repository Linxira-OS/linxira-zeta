// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Maps the ACP session config options published by AgentService (PanelConfig
// and the agent:config event) into the panel's control state. ACP sends config
// options as a raw JSON array; this module is the only place that needs to know
// that shape, so the hook and components stay protocol-agnostic.

export type AcpConfigChoice = {
    value: string;
    name: string;
    description?: string;
};

export type AcpConfigOption = {
    id: string;
    name: string;
    category: string;
    type: string;
    currentValue: string | null;
    options: AcpConfigChoice[];
};

export type AcpPanelConfig = {
    sessionId: string | null;
    model: AcpConfigOption | null;
    thinking: AcpConfigOption | null;
    mode: AcpConfigOption | null;
};

export const EMPTY_ACP_PANEL_CONFIG: AcpPanelConfig = {
    sessionId: null,
    model: null,
    thinking: null,
    mode: null,
};

// Config ids advertised by zetacode's ACP server (pkg/acp/types.go).
export const ACP_CONFIG_MODEL = "model";
export const ACP_CONFIG_THINKING = "thinking";

type ConfigDataLike = {
    sessionid?: unknown;
    configoptions?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
    if (value == null || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}

function parseChoice(value: unknown): AcpConfigChoice | null {
    const record = asRecord(value);
    if (!record || typeof record.value !== "string" || record.value === "") {
        return null;
    }
    if (typeof record.name !== "string" || record.name === "") {
        return null;
    }
    const choice: AcpConfigChoice = { value: record.value, name: record.name };
    if (typeof record.description === "string" && record.description !== "") {
        choice.description = record.description;
    }
    return choice;
}

export function parseAcpConfigOptions(raw: unknown): AcpConfigOption[] {
    if (!Array.isArray(raw)) {
        return [];
    }
    const options: AcpConfigOption[] = [];
    for (const item of raw) {
        const record = asRecord(item);
        if (!record || typeof record.id !== "string" || record.id === "") {
            continue;
        }
        const choices = Array.isArray(record.options)
            ? record.options.map(parseChoice).filter((choice): choice is AcpConfigChoice => choice != null)
            : [];
        options.push({
            id: record.id,
            name: typeof record.name === "string" && record.name !== "" ? record.name : record.id,
            category: typeof record.category === "string" ? record.category : "",
            type: typeof record.type === "string" ? record.type : "select",
            currentValue: typeof record.currentValue === "string" ? record.currentValue : null,
            options: choices,
        });
    }
    return options;
}

export function findAcpConfigOption(options: AcpConfigOption[], id: string): AcpConfigOption | null {
    return options.find((option) => option.id === id) ?? null;
}

export function acpPanelConfigFrom(options: AcpConfigOption[], sessionId: string | null | undefined): AcpPanelConfig {
    return {
        sessionId: sessionId || null,
        model: findAcpConfigOption(options, ACP_CONFIG_MODEL),
        thinking: findAcpConfigOption(options, ACP_CONFIG_THINKING),
        mode: findAcpConfigOption(options, "mode"),
    };
}

/**
 * Applies a PanelConfig snapshot or agent:config payload. A payload without a
 * `configoptions` array (for example a status-only refresh) keeps the previous
 * option state but may still carry a session id.
 */
export function mergeAcpPanelConfig(previous: AcpPanelConfig, data: ConfigDataLike | null | undefined): AcpPanelConfig {
    if (data == null || typeof data !== "object") {
        return previous;
    }
    const sessionId = typeof data.sessionid === "string" && data.sessionid !== "" ? data.sessionid : previous.sessionId;
    if (!Array.isArray(data.configoptions)) {
        return sessionId === previous.sessionId ? previous : { ...previous, sessionId };
    }
    return acpPanelConfigFrom(parseAcpConfigOptions(data.configoptions), sessionId);
}

export function acpChoiceName(option: AcpConfigOption | null, fallback: string): string {
    if (!option?.currentValue) {
        return fallback;
    }
    const choice = option.options.find((candidate) => candidate.value === option.currentValue);
    return choice?.name ?? option.currentValue;
}

/**
 * ACP select options carry the wire value the agent expects back in
 * session/set_config_option. Returns null when the value is not advertised so a
 * stale menu can never send an unknown level.
 */
export function acpConfigValueIsKnown(option: AcpConfigOption | null, value: string): boolean {
    return option != null && option.options.some((choice) => choice.value === value);
}
