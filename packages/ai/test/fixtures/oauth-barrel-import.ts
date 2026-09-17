import {
	getOAuthProviders as rootGetOAuthProviders,
	refreshOAuthToken as rootRefreshOAuthToken,
} from "@linxiraos/pi-ai";
import {
	getOAuthProviders as oauthGetOAuthProviders,
	refreshOAuthToken as oauthRefreshOAuthToken,
} from "@linxiraos/pi-ai/registry/oauth";
import "@linxiraos/pi-ai/providers/anthropic";
import "@linxiraos/pi-ai/auth-storage";

const publicExports = [rootGetOAuthProviders, rootRefreshOAuthToken, oauthGetOAuthProviders, oauthRefreshOAuthToken];

if (publicExports.some(value => !value)) {
	throw new Error("OAuth registry exports are unavailable");
}
