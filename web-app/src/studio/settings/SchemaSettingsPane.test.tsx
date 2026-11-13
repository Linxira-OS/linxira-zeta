import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { SchemaSettingRow } from "./SchemaSettingsPane";
import type { SchemaSettingEntry } from "./schemaSettings";

const write = async () => undefined;

const base = { tab: "general", visible: true, value: undefined } as const;

function render(entry: SchemaSettingEntry, pending = false) {
  return renderToStaticMarkup(
    <SchemaSettingRow entry={entry} pending={pending} disabled={false} write={write} />,
  );
}

describe("gateway settings schema row", () => {
  test("renders boolean, enum and text controls", () => {
    const boolean = render({ ...base, path: "startup.quiet", type: "boolean", label: "Quiet startup", value: true });
    expect(boolean).toContain('role="switch"');
    expect(boolean).toContain('aria-checked="true"');

    const enumRow = render({
      ...base,
      path: "theme.mode",
      type: "enum",
      label: "Theme",
      value: "auto",
      options: [{ value: "auto", label: "Auto" }, { value: "dark", label: "Dark" }],
    });
    expect(enumRow).toContain("Theme");

    const textRow = render({ ...base, path: "editor.font", type: "text", label: "Editor font", value: "Maple Mono" });
    expect(textRow).toContain('value="Maple Mono"');
  });

  test("renders a JSON editor for provider limits and model roles", () => {
    const limits = render({
      ...base,
      path: "providers.maxInFlightRequests",
      type: "providerLimits",
      label: "Provider limits",
      value: { openai: 4 },
    });
    expect(limits).toContain("<textarea");
    expect(limits).toContain("Apply");
    expect(limits).toContain('&quot;openai&quot;: 4');
  });

  test("renders one checkbox per multiselect option", () => {
    const html = render({
      ...base,
      path: "enabledProviders",
      type: "multiselect",
      label: "Providers",
      value: ["openai"],
      options: [{ value: "openai", label: "OpenAI" }, { value: "anthropic", label: "Anthropic" }],
    });
    expect(html.match(/type="checkbox"/g)?.length).toBe(2);
    expect(html).toContain("OpenAI");
    expect(html).toContain("Anthropic");
  });

  test("shows a write-only secret field with no stored value", () => {
    const html = render({
      ...base,
      path: "secrets.token",
      type: "text",
      label: "Token",
      value: "••••",
      secret: true,
    });
    expect(html).toContain('type="password"');
    expect(html).not.toContain("••••");
  });
});
