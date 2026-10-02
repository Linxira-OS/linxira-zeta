/**
 * `zeta-c auth-gateway` — run a forward proxy that injects auth from the broker.
 */

import { Args, Command, Flags, renderCommandHelp } from "@linxiraos/pi-utils/cli";
import {
	AUTH_GATEWAY_ACTIONS,
	type AuthGatewayAction,
	type AuthGatewayCommandArgs,
	runAuthGatewayCommand,
} from "../cli/auth-gateway-cli";
import { authGatewayHelp as commandHelp } from "../cli/command-help";
import { initTheme } from "@linxiraos/pi-tui/theme";

export default class AuthGateway extends Command {
	static description = commandHelp.description;
	static args = {
		action: Args.string({
			description: "Sub-command",
			required: false,
			options: [...AUTH_GATEWAY_ACTIONS],
		}),
	};

	static flags = {
		json: Flags.boolean({ description: "Output JSON (token/status/check)" }),
		bind: Flags.string({ description: "Bind address for `serve` (host:port)", char: "b" }),
		regenerate: Flags.boolean({ description: "Regenerate the gateway bearer token (token)" }),
		"no-auth": Flags.boolean({
			description:
				"Disable inbound bearer-token auth (serve). Useful when bound to loopback — any caller is allowed.",
		}),
		"trust-proxy-headers": Flags.boolean({
			description: "Trust forwarded peer IP headers from a reverse proxy (serve); off by default.",
		}),
		strict: Flags.boolean({
			description:
				"For `check`: additionally probe each credential against its provider's chat-completion endpoint. Slower; consumes a tiny amount of quota per credential.",
		}),
	};

	static examples = [
1494	];

	async run(): Promise<void> {
		const { args, flags } = await this.parse(AuthGateway);
		if (!args.action) {
			renderCommandHelp("zeta", "auth-gateway", AuthGateway);
			return;
		}
		const cmd: AuthGatewayCommandArgs = {
			action: args.action as AuthGatewayAction,
			flags: {
				json: flags.json,
				bind: flags.bind,
				regenerate: flags.regenerate,
				noAuth: flags["no-auth"],
				trustProxyHeaders: flags["trust-proxy-headers"],
				strict: flags.strict,
			},
		};
		await initTheme();
		await runAuthGatewayCommand(cmd);
	}
}
