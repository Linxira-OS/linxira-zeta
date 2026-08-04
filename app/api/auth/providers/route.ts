import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { getOmpAuthCredentials } from "@/lib/omp-auth";
import { buildOAuthProviderList } from "@/lib/provider-listing";
import { collectProviderListingInputs } from "@/lib/provider-listing-runtime";

export const dynamic = "force-dynamic";

// Providers that declare an OAuth login method, including anthropic
// (Claude Pro/Max) — see lib/provider-listing.ts (#309).
export async function GET() {
  const modelRuntime = await ModelRuntime.create();
  const providers = buildOAuthProviderList(await collectProviderListingInputs(modelRuntime));

  // Also surface custom OAuth providers recorded in omp-web's CLI-synced
  // credential store that do not appear as first-class runtime providers.
  const listed = new Set(providers.map((p) => p.id));
  const ompCredentials = getOmpAuthCredentials();
  const extra: typeof providers = [];
  for (const c of ompCredentials) {
    if (listed.has(c.provider)) continue;
    listed.add(c.provider);
    extra.push({
      id: c.provider,
      name: c.provider,
      usesCallbackServer: false,
      loggedIn: true,
      supportsApiKey: false,
    });
  }

  return Response.json({ providers: [...providers, ...extra] });
}
