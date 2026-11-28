// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    ACP_CONFIG_MODEL,
    ACP_CONFIG_THINKING,
    EMPTY_ACP_PANEL_CONFIG,
    acpChoiceName,
    acpConfigValueIsKnown,
    acpPanelConfigFrom,
    mergeAcpPanelConfig,
    parseAcpConfigOptions,
} from "./acp-panel-config";

const MODEL_OPTIONS = [
    {
        id: "mode",
        name: "Mode",
        category: "mode",
        type: "select",
        currentValue: "default",
        options: [{ value: "default", name: "Default" }],
    },
    {
        id: ACP_CONFIG_MODEL,
        name: "Model",
        category: "model",
        type: "select",
        currentValue: "fake/advanced",
        options: [
            { value: "fake/basic", name: "Fake Basic" },
            { value: "fake/advanced", name: "Fake Advanced", description: "fake/advanced" },
        ],
    },
    {
        id: ACP_CONFIG_THINKING,
        name: "Thinking",
        category: "thought_level",
        type: "select",
        currentValue: "high",
        options: [
            { value: "off", name: "Off" },
            { value: "auto", name: "Auto" },
            { value: "high", name: "High" },
        ],
    },
];

describe("ACP panel config mapping", () => {
    it("maps model and thinking config options from a PanelConfig payload", () => {
        const config = mergeAcpPanelConfig(EMPTY_ACP_PANEL_CONFIG, {
            sessionid: "session-1",
            configoptions: MODEL_OPTIONS,
        });

        expect(config.sessionId).toBe("session-1");
        expect(config.model?.currentValue).toBe("fake/advanced");
        expect(config.model?.options.map((choice) => choice.value)).toEqual(["fake/basic", "fake/advanced"]);
        expect(config.thinking?.currentValue).toBe("high");
        expect(config.thinking?.options.map((choice) => choice.value)).toEqual(["off", "auto", "high"]);
        expect(config.mode?.currentValue).toBe("default");
        expect(acpChoiceName(config.model, "unknown")).toBe("Fake Advanced");
        expect(acpChoiceName(config.thinking, "unknown")).toBe("High");
    });

    it("keeps the previous option state when an event has no configoptions", () => {
        const previous = acpPanelConfigFrom(MODEL_OPTIONS, "session-1");
        const next = mergeAcpPanelConfig(previous, { sessionid: "session-2" });

        expect(next.sessionId).toBe("session-2");
        expect(next.model).toBe(previous.model);
        expect(next.thinking).toBe(previous.thinking);
    });

    it("replaces option state and drops stale values omitted by the agent", () => {
        const previous = acpPanelConfigFrom(MODEL_OPTIONS, "session-1");
        const next = mergeAcpPanelConfig(previous, {
            sessionid: "session-1",
            configoptions: [
                {
                    id: ACP_CONFIG_THINKING,
                    name: "Thinking",
                    category: "thought_level",
                    type: "select",
                    currentValue: "off",
                    options: [{ value: "off", name: "Off" }],
                },
            ],
        });

        expect(next.thinking?.currentValue).toBe("off");
        expect(next.thinking?.options).toEqual([{ value: "off", name: "Off" }]);
        expect(next.model).toBeNull();
    });

    it("ignores malformed option and choice entries", () => {
        const options = parseAcpConfigOptions([
            null,
            { id: "", name: "Empty", options: [] },
            { id: "broken", name: "Broken", options: "nope" },
            {
                id: "model",
                currentValue: "x",
                options: [null, { value: "", name: "No value" }, { value: "x", name: "" }, { value: "x", name: "X" }],
            },
            { id: "boolean", name: "Boolean", type: "boolean", currentValue: true },
        ]);

        expect(options.map((option) => option.id)).toEqual(["broken", "model", "boolean"]);
        expect(options[0].options).toEqual([]);
        expect(options[1].options).toEqual([{ value: "x", name: "X" }]);
        expect(options[1].currentValue).toBe("x");
        expect(options[2].currentValue).toBeNull();
    });

    it("only accepts advertised config values", () => {
        const config = acpPanelConfigFrom(MODEL_OPTIONS, "session-1");
        expect(acpConfigValueIsKnown(config.thinking, "high")).toBe(true);
        expect(acpConfigValueIsKnown(config.thinking, "max")).toBe(false);
        expect(acpConfigValueIsKnown(config.model, "fake/unknown")).toBe(false);
        expect(acpConfigValueIsKnown(null, "high")).toBe(false);
    });

    it("returns no config fields when the payload is not an option array", () => {
        expect(parseAcpConfigOptions(undefined)).toEqual([]);
        expect(parseAcpConfigOptions({ id: "model" })).toEqual([]);
        expect(mergeAcpPanelConfig(EMPTY_ACP_PANEL_CONFIG, null)).toBe(EMPTY_ACP_PANEL_CONFIG);
        expect(mergeAcpPanelConfig(EMPTY_ACP_PANEL_CONFIG, { configoptions: [] })).toEqual(EMPTY_ACP_PANEL_CONFIG);
    });
});
