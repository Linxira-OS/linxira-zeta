import {
	AnthropicOAuthFlow as RootAnthropicOAuthFlow,
	loginAnthropic as rootLoginAnthropic,
	refreshAnthropicToken as rootRefreshAnthropicToken,
} from "@zeta/pi-ai";
import {
	AnthropicOAuthFlow as OAuthAnthropicOAuthFlow,
	loginAnthropic as oauthLoginAnthropic,
	refreshAnthropicToken as oauthRefreshAnthropicToken,
} from "@zeta/pi-ai/registry/oauth";
import "@zeta/pi-ai/providers/anthropic";
import "@zeta/pi-ai/auth-storage";

const publicExports = [
	RootAnthropicOAuthFlow,
	rootLoginAnthropic,
	rootRefreshAnthropicToken,
	OAuthAnthropicOAuthFlow,
	oauthLoginAnthropic,
	oauthRefreshAnthropicToken,
];

if (publicExports.some(value => !value)) {
	throw new Error("Anthropic OAuth exports are unavailable");
}
