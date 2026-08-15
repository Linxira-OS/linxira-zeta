import { afterEach, describe, expect, it, vi } from "bun:test";
import { type } from "@linxiraos/pi-omptype";
import type * as TypeBox from "@linxiraos/pi-omptype/typebox";
import * as zod from "@linxiraos/pi-omptype/zod";
import * as piCodingAgent from "@linxiraos/zeta";
import { GreenCommand } from "@linxiraos/zeta/extensibility/custom-commands/bundled/ci-green";
import type { CustomCommandAPI } from "@linxiraos/zeta/extensibility/custom-commands/types";
import type { HookCommandContext } from "@linxiraos/zeta/extensibility/hooks/types";
import * as git from "@linxiraos/zeta/utils/git";

afterEach(() => {
	vi.restoreAllMocks();
});

function createApi(): CustomCommandAPI {
	return {
		cwd: "/tmp/test",
		exec: async () => ({
			stdout: "",
			stderr: "",
			code: 0,
			killed: false,
		}),
		typebox: {} as unknown as typeof TypeBox,
		arktype: type,
		zod,
		pi: piCodingAgent,
	};
}

describe("GreenCommand", () => {
	it("includes tag instructions when HEAD has a tag", async () => {
		vi.spyOn(git.ref, "tags").mockResolvedValue(["v0.1.0-alpha2"]);
		const command = new GreenCommand(createApi());

		const result = await command.execute([], {} as HookCommandContext);

		expect(result).toContain("v0.1.0-alpha2");
		expect(result).not.toContain("timeouts due to the harnesses");
	});

	it("omits tag instructions when HEAD is not tagged", async () => {
		vi.spyOn(git.ref, "tags").mockResolvedValue([]);
		const command = new GreenCommand(createApi());

		const result = await command.execute([], {} as HookCommandContext);

		expect(result).not.toContain("v0.1.0-alpha2");
	});
});
