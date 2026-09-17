import type { AwsBedrockProviderOptions } from "./aws";
import type { ProviderTransport } from "./build";

/** Amazon Bedrock request shaping; auth policy lives in `rules/auth/amazon-bedrock.kdl`. */
export const amazonBedrockTransport: ProviderTransport = {
	mapSimpleOptions: options => {
		const awsOptions = options.providerOptions as AwsBedrockProviderOptions | undefined;
		return {
			region: awsOptions?.region,
			profile: awsOptions?.profile,
			bearerToken: awsOptions?.bearerToken,
		};
	},
};
