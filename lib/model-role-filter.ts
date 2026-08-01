export interface RoleModelCandidate {
  id: string;
  provider: string;
  contextWindow?: number;
}

const THINKING_SUFFIXES: Record<string, true> = { off: true, minimal: true, low: true, medium: true, high: true, xhigh: true, max: true };

function stripThinkingSuffix(modelRef: string): string {
  const trimmed = modelRef.trim();
  const colonIndex = trimmed.lastIndexOf(":");
  if (colonIndex === -1) return trimmed;
  const suffix = trimmed.substring(colonIndex + 1);
  return THINKING_SUFFIXES[suffix] ? trimmed.substring(0, colonIndex) : trimmed;
}

export function buildVisibleRoleModels(
  roles: Record<string, unknown>,
  available: readonly RoleModelCandidate[],
  configuredProviders: ReadonlySet<string>,
): Array<RoleModelCandidate & { name: string }> {
  const entries: Array<RoleModelCandidate & { name: string }> = [];
  for (const [role, ref] of Object.entries(roles)) {
    if (typeof ref !== "string" || !ref.trim()) continue;
    const cleanRef = ref.trim();
    let provider = "google-antigravity";
    let modelId = cleanRef;
    const slashIndex = cleanRef.indexOf("/");
    if (slashIndex > 0) {
      provider = cleanRef.slice(0, slashIndex);
      modelId = cleanRef.slice(slashIndex + 1);
    }

    const pureModelId = stripThinkingSuffix(modelId);
    if (!configuredProviders.has(provider)) continue;
    const model = available.find((candidate) => (
      candidate.provider === provider && (candidate.id === pureModelId || pureModelId.includes(candidate.id))
    ));
    if (!model) continue;

    entries.push({
      id: pureModelId,
      name: `${pureModelId} (${role})`,
      provider,
      contextWindow: model.contextWindow,
    });
  }
  return entries;
}
