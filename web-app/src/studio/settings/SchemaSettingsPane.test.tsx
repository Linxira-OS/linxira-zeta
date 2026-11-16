import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SchemaSettingRow } from "./SchemaSettingsPane";
import type { SchemaSettingEntry } from "./schemaSettings";
import { selectOption } from "../test/selectOption";

const base = { tab: "general", visible: true, value: undefined } as const;
afterEach(cleanup);
function row(entry: SchemaSettingEntry) {
  const write = vi.fn().mockResolvedValue(undefined);
  render(<SchemaSettingRow entry={entry} pending={false} disabled={false} write={write} />);
  return write;
}

describe("gateway settings schema row", () => {
  test("commits boolean, enum and edited text values", () => {
    const boolean = row({ ...base, path: "startup.quiet", type: "boolean", label: "Quiet startup", value: true });
    fireEvent.click(screen.getByRole("switch", { name: "Quiet startup" }));
    expect(boolean).toHaveBeenCalledWith("startup.quiet", false);
    const choices = row({ ...base, path: "theme.mode", type: "enum", label: "Theme", value: "auto", options: [{ value: "auto", label: "Auto" }, { value: "dark", label: "Dark" }] });
    selectOption(screen.getByRole("combobox", { name: "Theme" }), "Dark");
    expect(choices).toHaveBeenCalledWith("theme.mode", "dark");
    const text = row({ ...base, path: "editor.font", type: "text", label: "Editor font", value: "Maple Mono" });
    const input = screen.getByRole("textbox", { name: "Editor font" });
    fireEvent.change(input, { target: { value: "Consolas" } });
    fireEvent.blur(input);
    expect(text).toHaveBeenCalledWith("editor.font", "Consolas");
  });

  test("validates a JSON edit before committing provider limits", () => {
    const write = row({ ...base, path: "providers.maxInFlightRequests", type: "providerLimits", label: "Provider limits", value: { openai: 4 } });
    const input = screen.getByRole("textbox", { name: "Provider limits" });
    fireEvent.change(input, { target: { value: "{" } });
    fireEvent.click(input.parentElement!.querySelector("button")!);
    expect(write).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.change(input, { target: { value: '{"openai":2}' } });
    fireEvent.click(input.parentElement!.querySelector("button")!);
    expect(write).toHaveBeenCalledWith("providers.maxInFlightRequests", { openai: 2 });
  });

  test("preserves the other selected provider when toggling one option", () => {
    const write = row({ ...base, path: "enabledProviders", type: "multiselect", label: "Providers", value: ["openai"], options: [{ value: "openai", label: "OpenAI" }, { value: "anthropic", label: "Anthropic" }] });
    fireEvent.click(screen.getByRole("checkbox", { name: "Anthropic" }));
    expect(write).toHaveBeenCalledWith("enabledProviders", ["openai", "anthropic"]);
  });

  test("does not disclose or submit the stored secret until a replacement is entered", () => {
    const write = row({ ...base, path: "secrets.token", type: "text", label: "Token", value: "••••", secret: true });
    const input = screen.getByLabelText<HTMLInputElement>("Token");
    expect(input.type).toBe("password");
    expect(input.value).toBe("");
    fireEvent.blur(input);
    expect(write).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "replacement" } });
    fireEvent.blur(input);
    expect(write).toHaveBeenCalledWith("secrets.token", "replacement");
  });
});
