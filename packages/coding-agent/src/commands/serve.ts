/**
 * `zeta serve` — 一键启动 Stats Dashboard + Web UI
 *
 * 启动后自动打开浏览器访问 Web UI。适用于开发环境（源码运行）和
 * 编译后的二进制分发。
 */

import { APP_NAME, logger } from "@zeta/pi-utils";
import { Command, Flags } from "@zeta/pi-utils/cli";
import chalk from "chalk";
import { openPath } from "../utils/open";
import { spawnWebUi } from "./web-ui-launcher";

export default class Serve extends Command {
	static description = "Start the Stats Dashboard and Web UI, then open the browser";

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
		"no-browser": Flags.boolean({
			description: "Don't open the browser automatically",
			default: false,
		}),
		"stats-only": Flags.boolean({
			description: "Start only the Stats Dashboard (no Web UI)",
			default: false,
		}),
		"web-only": Flags.boolean({
			description: "Start only the Web UI (no Stats Dashboard)",
			default: false,
		}),
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(Serve);

		const statsPort = flags["stats-port"];
		const webPort = flags["web-port"];
		const noBrowser = flags["no-browser"];
		const statsOnly = flags["stats-only"];
		const webOnly = flags["web-only"];

		const webUrl = `http://localhost:${webPort}`;
		const statsUrl = `http://localhost:${statsPort}`;

		console.log(chalk.bold(`\n  ${APP_NAME} Serve\n`));

		const cleanupFns: Array<() => void | Promise<void>> = [];

		// Start Stats Dashboard
		if (!webOnly) {
			try {
				const { startServer } = await import("@zeta/omp-stats");
				await startServer(statsPort);
				console.log(chalk.green(`  Stats Dashboard:  ${statsUrl}`));
				cleanupFns.push(async () => {
					try {
						const { closeDb } = await import("@zeta/omp-stats");
						closeDb();
					} catch {}
				});
			} catch (err) {
				logger.warn("Failed to start Stats Dashboard", {
					error: err instanceof Error ? err.message : String(err),
				});
				console.log(
					chalk.yellow(`  Stats Dashboard:  failed to start (${err instanceof Error ? err.message : err})`),
				);
			}
		}

		// Start Web UI
		let webUiChild: { kill: () => void } | null = null;
		if (!statsOnly) {
			try {
				webUiChild = await spawnWebUi(webPort);
				console.log(chalk.green(`  Web UI:           ${webUrl}`));
			} catch (err) {
				logger.warn("Failed to start Web UI", {
					error: err instanceof Error ? err.message : String(err),
				});
				console.log(
					chalk.yellow(`  Web UI:           not available (${err instanceof Error ? err.message : err})`),
				);
				console.log(chalk.dim(`  Install with: npm install -g zeta-web`));
			}
		}

		// Open browser
		if (!noBrowser && webUiChild) {
			// Wait a moment for the server to be ready
			await Bun.sleep(1500);
			openPath(webUrl);
		} else if (!noBrowser && webOnly && !webUiChild) {
			// Nothing to open
		} else if (!noBrowser && !webUiChild && !webOnly) {
			// Only stats is available
			await Bun.sleep(1000);
			openPath(statsUrl);
		}

		console.log(chalk.dim(`\n  Press Ctrl+C to stop all services\n`));

		// Graceful shutdown
		const shutdown = () => {
			console.log(chalk.dim("\n  Shutting down..."));
			if (webUiChild) {
				webUiChild.kill();
			}
			for (const fn of cleanupFns) {
				try {
					fn();
				} catch {}
			}
			process.exit(0);
		};

		process.on("SIGINT", shutdown);
		process.on("SIGTERM", shutdown);

		// Keep the process alive
		await new Promise(() => {});
	}
}
