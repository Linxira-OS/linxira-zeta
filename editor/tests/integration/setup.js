import { beforeEach } from "vitest";
import * as tui from "./tui.js";

beforeEach(() => {
  tui.kill();
});
