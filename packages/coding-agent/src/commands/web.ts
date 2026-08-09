/**
 * `zeta web` — 启动 Web UI 服务器
 *
 * 使用 ZetaServer 统一 HTTP 反向代理启动 Web UI。作为 `zeta serve --web-only` 的快捷方式。
 */

import { APP_NAME, logger } from "@zeta/pi-utils";
import { Command, Flags } from "@zeta/pi-utils/cli";
import chalk from "chalk";
import { startZetaServer } from "../server/zeta-server";

export default class Web extends Command {
	static description = "Start the Web UI server (no browser)";

	static flags = {
		port: Flags.integer({
			char: "p",
			description: "Port for the Web UI server",
			default: 30141,
		}),
		"no-browser": Flags.boolean({
			description: "Don't open the browser automatically (default)",
			default: true,
		}),
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(Web);

		const port = flags.port;
		const noBrowser = flags["no-browser"];

		console.log(chalk.bold(`\n  ${APP_NAME} Web UI\n`));

		let instance: Awaited<ReturnType<typeof startZetaServer>> | null = null;
		try {
			instance = await startZetaServer({
				port,
				noBrowser,
				webOnly: true,
			});

			console.log(chalk.green(`  Web UI:  ${instance.url}`));

			console.log(chalk.dim(`\n  Press Ctrl+C to stop\n`));

			const shutdown = () => {
				console.log(chalk.dim("\n  Shutting down..."));
				if (instance) {
					instance.shutdown().catch(() => {});
				}
				process.exit(0);
			};

			process.on("SIGINT", shutdown);
			process.on("SIGTERM", shutdown);

			await new Promise(() => {});
		} catch (err) {
			logger.error("Failed to start Web UI", {
				error: err instanceof Error ? err.message : String(err),
			});
			console.log(chalk.red(`  Failed to start Web UI: ${err instanceof Error ? err.message : err}`));
			console.log(chalk.dim(`  Install with: npm install -g zeta-web`));
			if (instance) {
				await instance.shutdown().catch(() => {});
			}
			process.exit(1);
		}
	}
}
