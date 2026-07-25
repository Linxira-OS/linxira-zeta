import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { invalidateModelsCache } from "@/lib/models-cache";
import { deleteOmpCredential } from "@/lib/omp-auth";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  deleteOmpCredential(provider);
  try {
    const modelRuntime = await ModelRuntime.create();
    if (modelRuntime.getProvider(provider)?.auth.oauth) {
      await modelRuntime.logout(provider);
    }
  } catch {
    // ignore logout error
  }
  invalidateModelsCache();
  return Response.json({ ok: true });
}
