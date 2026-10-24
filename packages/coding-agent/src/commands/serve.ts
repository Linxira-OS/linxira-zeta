/**
 * `zetacode serve` — 一键启动 Stats Dashboard + Web UI
 *
 * 使用 ZetaServer 统一 HTTP 反向代理，将 Web UI（Next.js）和 Stats Dashboard
 * 作为内部后端，用户只需访问一个端口。
 *
 * 启动前先做实例发现（见 `../server/serve-registry.ts`）：本机已有健康且
 * **同版本**的实例占着目标端口时，复用而不重复监听；版本不符时明确拒绝并
 * 给出选项，绝不静默抢占。
 */

import { CLI_BIN_NAME, logger, VERSION, ZETA_GATEWAY_PORT, ZETA_STATS_PORT, ZETA_WEB_PORT } from "@linxiraos/pi-utils";
import { Command, Flags } from "@linxiraos/pi-utils/cli";
import chalk from "chalk";
import { WebConfig } from "../config/web-config";
import { readBackendAutostartSetting } from "../autostart/setting";
import { formatAccessUrl, resolveServeAccess } from "../server/serve-access";
import { discoverServeInstance, planServeStart, serveRegistryPath } from "../server/serve-registry";
import { registerServeRestartHandler } from "../server/serve-control";
import { ensureAgentDirEnv } from "../server/web-gateway";
import type { ServeIdentity } from "../server/web-gateway/identity";
import { startZetaServer, type ZetaServerInstance } from "../server/zeta-server";

/** Identity lines shared by the reuse / mismatch reports. */
function reportInstance(identity: ServeIdentity): void {
	const detail = [
		`pid ${identity.pid}`,
		`version ${identity.version}`,
		identity.startedAt ? `started ${identity.startedAt}` : null,
	]
		.filter(Boolean)
		.join(", ");
	console.log(chalk.dim(`    ${detail}`));
	if (identity.webUrl) console.log(chalk.dim(`    Web UI:      ${identity.webUrl}`));
	if (identity.gatewayUrl) console.log(chalk.dim(`    Web Gateway: ${identity.gatewayUrl}`));
	if (identity.statsUrl) console.log(chalk.dim(`    Stats:       ${identity.statsUrl}`));
}

export default class Serve extends Command {
	static description = "Start the Stats Dashboard and Web UI services (no browser)";

	static flags = {
		"stats-port": Flags.integer({
			char: "s",
			description: "Port for the Stats Dashboard",
			default: ZETA_STATS_PORT,
		}),
		"web-port": Flags.integer({
			char: "w",
			description: "Port for the Web UI",
			default: ZETA_WEB_PORT,
		}),
		host: Flags.string({
			description: "Public bind hostname (non-loopback requires remote.token + TLS or --allow-plain-http)",
		}),
		tls: Flags.boolean({
			description: "Force the built-in TLS listener (requires --tls-cert and --tls-key)",
			default: false,
		}),
		"tls-cert": Flags.string({
			description: "PEM certificate chain for the built-in TLS listener",
		}),
		"tls-key": Flags.string({
			description: "PEM private key for the built-in TLS listener",
		}),
		"allow-plain-http": Flags.boolean({
			description: "Allow a plaintext non-loopback bind (default: refused; use TLS or a TLS reverse proxy)",
			default: false,
		}),
		"gateway-port": Flags.integer({
			char: "g",
			description: "Port for the Web Gateway (127.0.0.1 only)",
			default: ZETA_GATEWAY_PORT,
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
		autostart: Flags.boolean({
			description:
				"Installed OS component entry point: exit quietly unless backend.autostart is enabled in the global user config",
			default: false,
		}),
	};

	async run(): Promise<void> {
		ensureAgentDirEnv();

		const { flags } = await this.parse(Serve);

		// The OS component (systemd timer / Task Scheduler) launches `serve`
		// with this flag. The global config is the single decision; the unit
		// never starts a backend the user turned off, and an OS-disabled unit
		// cannot be re-enabled by this process.
		if (flags.autostart && !(await readBackendAutostartSetting())) {
			console.log(
				chalk.dim(
					`  ${CLI_BIN_NAME}: backend.autostart is off in the global config; not starting the background backend.`,
				),
			);
			return;
		}

		const statsPort = flags["stats-port"];
		const webPort = flags["web-port"];
		const gatewayPort = flags["gateway-port"];
		const noBrowser = flags["no-browser"];
		const statsOnly = flags["stats-only"];
		const webOnly = flags["web-only"];

		console.log(chalk.bold(`\n  ${CLI_BIN_NAME} Serve\n`));

		// Exposure before discovery: host/TLS come from the flag > web.yml >
		// env chain, and a configuration that would expose the control plane
		// unsafely is refused here, before any child process or socket.
		const webConfig = await WebConfig.load();
		const access = resolveServeAccess({
			flags: {
				host: flags.host,
				tls: flags.tls,
				tlsCert: flags["tls-cert"],
				tlsKey: flags["tls-key"],
				allowPlainHttp: flags["allow-plain-http"],
			},
			config: webConfig.getData(),
			env: process.env,
		});
		if (!access.ok) {
			console.log(chalk.red(`  Refusing to start: ${access.error}\n`));
			process.exitCode = 1;
			return;
		}
		for (const warning of access.warnings) {
			console.log(chalk.yellow(`  Warning: ${warning}`));
		}

		// Discovery before binding: an instance already holding this port is
		// reused (same version) or refused (different version) — never fought
		// over with a raw EADDRINUSE.
		const targetUrl = formatAccessUrl(access.access, webPort);
		const discovery = await discoverServeInstance({ targetUrl });
		const plan = planServeStart({ discovery, targetUrl, currentVersion: VERSION });

		if (plan.stale) {
			console.log(chalk.dim(`  Removed a stale registration (pid ${plan.stale.pid} is no longer running).`));
		}

		if (plan.action === "reuse") {
			console.log(chalk.green(`  A running ${CLI_BIN_NAME} serve instance already holds ${targetUrl}.\n`));
			reportInstance(plan.identity);
			console.log(chalk.dim(`\n  Reusing it — this process exits without a second listener.`));
			console.log(
				chalk.dim(`  Force a separate instance:  ${CLI_BIN_NAME} serve --web-port 30241 --gateway-port 30242`),
			);
			console.log(chalk.dim(`  Restart it:                 stop pid ${plan.identity.pid}, then start serve again`));
			console.log(chalk.dim(`  Registry:                   ${serveRegistryPath()}\n`));
			return;
		}

		if (plan.action === "version-mismatch") {
			console.log(
				chalk.yellow(
					`  A different ${CLI_BIN_NAME} version already holds ${targetUrl} — refusing to take the port over.\n`,
				),
			);
			reportInstance(plan.identity);
			console.log(chalk.dim(`    This CLI:    version ${VERSION}`));
			console.log(chalk.dim(`\n  Options:`));
			console.log(chalk.dim(`    • stop the running instance (pid ${plan.identity.pid}), then start serve again`));
			console.log(
				chalk.dim(
					`    • start this one on other ports:  ${CLI_BIN_NAME} serve --web-port 30241 --gateway-port 30242`,
				),
			);
			if (plan.identity.webUrl) {
				console.log(chalk.dim(`    • keep using the running one:     open ${plan.identity.webUrl}`));
			}
			console.log(chalk.dim(`    Registry:                         ${serveRegistryPath()}\n`));
			process.exitCode = 1;
			return;
		}

		if (plan.action === "web-ui-unreachable") {
			console.log(
				chalk.yellow(
					`  The ${CLI_BIN_NAME} instance holding ${targetUrl} answers its gateway but not its Web UI — refusing to reuse it.\n`,
				),
			);
			reportInstance(plan.identity);
			const probe = plan.probe;
			const answer = probe.status === null ? (probe.error ?? "no answer") : `HTTP ${probe.status}`;
			console.log(chalk.dim(`    Web UI probe: ${probe.url} → ${answer}`));
			console.log(
				chalk.dim(
					`\n  That page is proxied to the serve process's Web UI child; a failure means the child is not running.`,
				),
			);
			console.log(chalk.dim(`  Options:`));
			console.log(chalk.dim(`    • stop that instance (pid ${plan.identity.pid}), then start serve again`));
			console.log(
				chalk.dim(
					`    • start this one on other ports:  ${CLI_BIN_NAME} serve --web-port 30241 --gateway-port 30242`,
				),
			);
			console.log(chalk.dim(`    Registry:                         ${serveRegistryPath()}\n`));
			process.exitCode = 1;
			return;
		}

		if (plan.other) {
			console.log(
				chalk.dim(
					`  Another ${CLI_BIN_NAME} serve (pid ${plan.other.pid}, version ${plan.other.version}) is running${
						plan.other.webUrl ? ` at ${plan.other.webUrl}` : ""
					}; starting a separate listener on ${targetUrl}.`,
				),
			);
		}

		let instance: ZetaServerInstance | null = null;
		try {
			instance = await startZetaServer({
				port: webPort,
				host: access.access.host,
				tls: access.access.tls,
				allowPlainHttp: access.access.allowPlainHttp,
				statsPort,
				gatewayPort,
				noBrowser,
				statsOnly,
				webOnly,
				channels: flags.channels,
			});

			// `/restart` from any attached client lands here. Shut the listeners
			// down first (withdrawing discovery) and replace the process with the
			// same argv, so the operator's launch flags and service manager
			// contract survive the restart.
			registerServeRestartHandler(async () => {
				console.log(chalk.dim("\n  Restarting serve..."));
				await instance?.shutdown().catch(() => {});
				registerServeRestartHandler(null);
				const child = Bun.spawn([process.execPath, ...process.argv.slice(1)], {
					cwd: process.cwd(),
					env: process.env,
					stdio: ["inherit", "inherit", "inherit"],
				});
				child.unref();
				process.exit(0);
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
			if (!access.access.loopback) {
				console.log(
					chalk.dim(
						`\n  Exposed on ${access.access.host} (${access.access.scheme.toUpperCase()}). Pair a phone from Settings → Remote Access (QR carries the URL and token).`,
					),
				);
			}

			console.log(chalk.dim(`\n  Press Ctrl+C to stop all services\n`));

			// Graceful shutdown. `shutdown()` withdraws the registration file and
			// the identity endpoint, so the next start sees a clean slate.
			const shutdown = async () => {
				console.log(chalk.dim("\n  Shutting down..."));
				registerServeRestartHandler(null);
				if (instance) {
					await instance.shutdown().catch(() => {});
				}
				process.exit(0);
			};

			process.on("SIGINT", () => void shutdown());
			process.on("SIGTERM", () => void shutdown());

			// Keep the process alive until a signal handler exits it.
			await Promise.withResolvers<void>().promise;
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
