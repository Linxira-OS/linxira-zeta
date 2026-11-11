import { describe, expect, test } from "bun:test";

import { parsePluginViewRoute } from "./pluginRoute";

describe("plugin page deep links", () => {
  test("decodes one plugin and page entry, with or without a trailing slash", () => {
    expect(parsePluginViewRoute("/plugins/view/notes/index")).toEqual({ plugin: "notes", page: "index" });
    expect(parsePluginViewRoute("/plugins/view/notes/index/")).toEqual({ plugin: "notes", page: "index" });
    expect(parsePluginViewRoute("/plugins/view/notes/ui/board.html")).toEqual({ plugin: "notes", page: "ui/board.html" });
    expect(parsePluginViewRoute("/plugins/view/%E6%97%A5%E8%AE%B0/today")).toEqual({ plugin: "日记", page: "today" });
    expect(parsePluginViewRoute("/plugins/view/notes/ui/my%20board.html")).toEqual({ plugin: "notes", page: "ui/my board.html" });
  });

  test("any other path is not a plugin page", () => {
    for (const pathname of ["/", "/plugins", "/plugins/view/notes", "/plugins/view/notes/ui/%2E%2E/secret", "/plugins/view/a%2Fb/page", "/settings"]) {
      expect(parsePluginViewRoute(pathname)).toBeUndefined();
    }
  });

  test("malformed escapes do not throw", () => {
    expect(parsePluginViewRoute("/plugins/view/%E0%A4%A/page")).toBeUndefined();
  });
});
