/**
 * `zeta web` — 启动 Web UI 服务器
 *
 * 启动 Web UI 服务器并自动打开浏览器。作为 `zeta serve --web-only` 的快捷方式。
 */

import { APP_NAME, logger } from "@zeta/pi-utils";
import { Command, Flags } from "@zeta/pi-utils/cli";
import chalk from "chalk";
import { openPath } from "../utils/open";
import { spawnWebUi } from "./web-ui-launcher";

export default class Web extends Command {
	static description = "Start the Web UI server and open the browser";

	static flags = {
		port: Flags.integer({
			char: "p",
			description: "Port for the Web UI server",
			default: 30141,
		}),
		"no-browser": Flags.boolean({
			description: "Don't open the browser automatically",
			default: false,
		}),
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(Web);

		const port = flags.port;
		const noBrowser = flags["no-browser"];
		const webUrl = `http://localhost:${port}`;

		console.log(chalk.bold(`\n  ${APP_NAME} Web UI\n`));

		let webUiChild: { kill: () => void } | null = null;
		try {
			webUiChild = await spawnWebUi(port);
			console.log(chalk.green(`  Web UI:  ${webUrl}`));
		} catch (err) {
			logger.warn("Failed to start Web UI", {
				error: err instanceof Error ? err.message : String(err),
			});
			console.log(chalk.red(`  Failed to start Web UI: ${err instanceof Error ? err.message : err}`));
			console.log(chalk.dim(`  Install with: npm install -g zeta-web`));
			process.exit(1);
		}

		if (!noBrowser) {
			await Bun.sleep(1500);
			openPath(webUrl);
		}

		console.log(chalk.dim(`\n  Press Ctrl+C to stop\n`));

		const shutdown = () => {
			console.log(chalk.dim("\n  Shutting down..."));
			if (webUiChild) {
				webUiChild.kill();
			}
			process.exit(0);
		};

		process.on("SIGINT", shutdown);
		process.on("SIGTERM", shutdown);

		await new Promise(() => {});
	}
}
