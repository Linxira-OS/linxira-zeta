// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AIQueuedPrompts } from "./aiqueuedprompts";

describe("AIQueuedPrompts", () => {
    it("renders every queued prompt with a remove control", () => {
        const markup = renderToStaticMarkup(
            <AIQueuedPrompts
                prompts={[
                    { id: "q1", text: "first queued", parts: [] },
                    { id: "q2", text: "second queued", parts: [] },
                ]}
                onRemove={() => {}}
            />
        );

        expect(markup).toContain("Queued (2)");
        expect(markup).toContain("first queued");
        expect(markup).toContain("second queued");
        expect(markup.match(/aria-label="Remove queued message"/g)).toHaveLength(2);
    });

    it("renders nothing without queued prompts", () => {
        const markup = renderToStaticMarkup(<AIQueuedPrompts prompts={[]} onRemove={() => {}} />);

        expect(markup).toBe("");
    });
});
