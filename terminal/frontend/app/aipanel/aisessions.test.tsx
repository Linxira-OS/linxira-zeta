// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    PanelConfig: vi.fn(async () => ({
        blockid: "",
        sessionid: "panel-session-123456",
        configoptions: [] as unknown[],
    })),
    PanelPendingPermissions: vi.fn(async () => [] as unknown[]),
    PanelStart: vi.fn(async (_cwd: string) => {}),
}));

vi.mock("@/app/store/services", () => ({ AgentService: mocks }));
vi.mock("@/app/store/wps", () => ({
    waveEventSubscribeSingle: () => () => {},
}));

import { AISessionPicker } from "./aisessions";
import { AcpPanelChat } from "./useacpchat";

describe("AISessionPicker render", () => {
    beforeEach(() => {
        AcpPanelChat.resetInstance();
        mocks.PanelConfig.mockClear();
        mocks.PanelPendingPermissions.mockClear();
        mocks.PanelStart.mockClear();
        mocks.PanelConfig.mockResolvedValue({
            blockid: "",
            sessionid: "panel-session-123456",
            configoptions: [],
        });
    });

    it("shows the current session id", async () => {
        await AcpPanelChat.getInstance().init();

        const markup = renderToStaticMarkup(<AISessionPicker />);

        expect(markup).toContain('title="panel-session-123456"');
        expect(markup).toContain("panel-se");
    });

    it("renders the no-session state before the panel starts", () => {
        const markup = renderToStaticMarkup(<AISessionPicker />);

        expect(markup).toContain("No session");
    });
});
