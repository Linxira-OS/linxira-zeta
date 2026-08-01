import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { getOmpAuthCredentials } from "@/lib/omp-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const modelRuntime = await ModelRuntime.create();
  const credentials = await modelRuntime.listCredentials();
  const ompCredentials = getOmpAuthCredentials();
  const loggedInProviders = new Set([
    ...credentials.filter((credential) => credential.type === "oauth").map((credential) => credential.providerId),
    ...ompCredentials.map((c) => c.provider),
  ]);
  const providers = modelRuntime.getProviders().filter((provider) => provider.auth.oauth);

  const EXCLUDED = new Set(["anthropic"]);
  const DISPLAY_NAMES: Record<string, string> = {
    "openai-codex": "ChatGPT Plus/Pro",
    "github-copilot": "GitHub Copilot",
    "google-antigravity": "Google AntiGravity-login",
  };

  const providerList = [...providers];
  for (const c of ompCredentials) {
    if (!providerList.some((p) => p.id === c.provider)) {
      providerList.push({
        id: c.provider,
        name: DISPLAY_NAMES[c.provider] ?? c.provider,
        auth: { oauth: true },
      } as unknown as typeof providers[0]);
    }
  }

  const result = await Promise.all(
    providerList
      .filter((p) => !EXCLUDED.has(p.id))
      .map(async (p) => {
        return {
          id: p.id,
          name: DISPLAY_NAMES[p.id] ?? p.name,
          usesCallbackServer: false,
          loggedIn: loggedInProviders.has(p.id),
        };
      })
  );

  return Response.json({ providers: result });
}
