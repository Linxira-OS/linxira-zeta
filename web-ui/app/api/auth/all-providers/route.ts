import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { getUsableOmpRuntimeCredentials } from "@/lib/omp-auth";
import { readOmpModelsFromDb } from "@/lib/omp-models";

export const dynamic = "force-dynamic";

// Providers that use OAuth — handled separately via /api/auth/providers
const OAUTH_PROVIDER_IDS = new Set(["anthropic", "github-copilot", "openai-codex"]);

export async function GET() {
  const modelRuntime = await ModelRuntime.create();
  const all = modelRuntime.getModels();
  const ompCredentials = getUsableOmpRuntimeCredentials();
  const ompConfiguredProviders = new Set(ompCredentials.map((c) => c.provider));
  const dbModels = readOmpModelsFromDb();

  // Deduplicate by provider, skip OAuth-only providers and custom providers (source=models_json_key)
  const seen = new Set<string>();
  const result: {
    id: string;
    displayName: string;
    configured: boolean;
    source?: string;
    modelCount: number;
  }[] = [];

  for (const provider of modelRuntime.getProviders()) {
    if (seen.has(provider.id)) continue;
    seen.add(provider.id);
    if (OAUTH_PROVIDER_IDS.has(provider.id) || !provider.auth.apiKey?.login) continue;
    const status = modelRuntime.getProviderAuthStatus(provider.id);
    const isConfigured = status.configured || ompConfiguredProviders.has(provider.id);
    const modelCount = all.filter((model) => model.provider === provider.id).length || dbModels.filter((m) => m.provider === provider.id).length;
    result.push({
      id: provider.id,
      displayName: provider.name,
      configured: isConfigured,
      source: isConfigured ? "omp_agent_db" : status.source,
      modelCount,
    });
  }

  // Also include custom providers / endpoints found in models.db
  for (const m of dbModels) {
    if (!seen.has(m.provider) && !OAUTH_PROVIDER_IDS.has(m.provider)) {
      seen.add(m.provider);
      const isConfigured = ompConfiguredProviders.has(m.provider);
      result.push({
        id: m.provider,
        displayName: m.provider,
        configured: isConfigured,
        source: isConfigured ? "omp_agent_db" : "models_db",
        modelCount: dbModels.filter((x) => x.provider === m.provider).length,
      });
    }
  }

  return Response.json({ providers: result });
}
