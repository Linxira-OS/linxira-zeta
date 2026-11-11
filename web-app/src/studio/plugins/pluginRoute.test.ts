import { describe, expect, test } from "bun:test";

import { parsePluginViewRoute } from "./pluginRoute";

describe("plugin page deep links", () => {
  test("decodes one plugin and page, with or without a trailing slash", () => {
    expect(parsePluginViewRoute("/plugins/view/notes/index")).toEqual({ plugin: "notes", page: "index" });
    expect(parsePluginViewRoute("/plugins/view/notes/index/")).toEqual({ plugin: "notes", page: "index" });
    expect(parsePluginViewRoute("/plugins/view/%E6%97%A5%E8%AE%B0/today")).toEqual({ plugin: "日记", page: "today" });
  });

  test("any other path is not a plugin page", () => {
    for (const pathname of ["/", "/plugins", "/plugins/view/notes", "/plugins/view/notes/a/b", "/settings"]) {
      expect(parsePluginViewRoute(pathname)).toBeUndefined();
    }
  });

  test("malformed escapes do not throw", () => {
    expect(parsePluginViewRoute("/plugins/view/%E0%A4%A/page")).toBeUndefined();
  });
});
