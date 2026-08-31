/**
 * `zeta serve` — 一键启动 Stats Dashboard + Web UI
 *
 * 使用 ZetaServer 统一 HTTP 反向代理，将 Web UI（Next.js）和 Stats Dashboard
 * 作为内部后端，用户只需访问一个端口。
 */

import { APP_NAME, logger } from "@linxiraos/pi-utils";
import { Command, Flags } from "@linxiraos/pi-utils/cli";
import chalk from "chalk";
import { ensureAgentDirEnv } from "../server/web-gateway";
import { startZetaServer } from "../server/zeta-server";

export default class Serve extends Command {
	static description = "Start the Stats Dashboard and Web UI services (no browser)";

	static flags = {
		"stats-port": Flags.integer({
			char: "s",
			description: "Port for the Stats Dashboard",
			default: 3847,
		}),
		"web-port": Flags.integer({
			char: "w",
			description: "Port for the Web UI",
			default: 30141,
		}),
		host: Flags.string({
			description: "Public bind hostname (non-loopback requires remote.token)",
		}),
		"gateway-port": Flags.integer({
			char: "g",
			description: "Port for the Web Gateway (127.0.0.1 only)",
			default: 30142,
		}),
		"no-browser": Flags.boolean({
			description: "Don't open the browser automatically (default)",
			default: true,
		}),
		"stats-only": Flags.boolean({
			description: "Start only the Stats Dashboard (no Web UI)",
			default: false,
		}),
		"web-only": Flags.boolean({
			description: "Start only the Web UI (no Stats Dashboard)",
			default: false,
		}),
		channels: Flags.boolean({
			description: "Start IM channels (WeChat/Feishu/Telegram); also enabled when any channel is enabled in web.yml",
			default: false,
		}),
	};

	async run(): Promise<void> {
		ensureAgentDirEnv();

		const { flags } = await this.parse(Serve);

		const statsPort = flags["stats-port"];
		const webPort = flags["web-port"];
		const gatewayPort = flags["gateway-port"];
		const noBrowser = flags["no-browser"];
		const statsOnly = flags["stats-only"];
		const webOnly = flags["web-only"];

		console.log(chalk.bold(`\n  ${APP_NAME} Serve\n`));

		let instance: Awaited<ReturnType<typeof startZetaServer>> | null = null;
		try {
			instance = await startZetaServer({
				port: webPort,
				host: flags.host,
				statsPort,
				gatewayPort,
				noBrowser,
				statsOnly,
				webOnly,
				channels: flags.channels,
			});

			if (!webOnly && instance.statsUrl) {
				console.log(chalk.green(`  Stats Dashboard:  ${instance.statsUrl}`));
			}
			if (!statsOnly && instance.url) {
				console.log(chalk.green(`  Web UI:           ${instance.url}`));
			}
			if (!statsOnly && instance.gatewayUrl) {
				console.log(chalk.green(`  Web Gateway:      ${instance.gatewayUrl}`));
			}

			console.log(chalk.dim(`\n  Press Ctrl+C to stop all services\n`));

			// Graceful shutdown
			const shutdown = () => {
				console.log(chalk.dim("\n  Shutting down..."));
				if (instance) {
					instance.shutdown().catch(() => {});
				}
				process.exit(0);
			};

			process.on("SIGINT", shutdown);
			process.on("SIGTERM", shutdown);

			// Keep the process alive
			await new Promise(() => {});
		} catch (err) {
			logger.error("Failed to start Zeta Server", {
				error: err instanceof Error ? err.message : String(err),
			});
			console.log(chalk.red(`  Failed to start: ${err instanceof Error ? err.message : err}`));
			if (instance) {
				await instance.shutdown().catch(() => {});
			}
			process.exit(1);
		}
	}
}
