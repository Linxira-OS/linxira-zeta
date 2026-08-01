import { NextResponse } from "next/server";
import { getOmpAgentDir } from "@/lib/file-paths";
import { invalidateModelsCache } from "@/lib/models-cache";
import { readOmpModelsConfig, writeOmpModelsConfig } from "@/lib/omp-model-config";

export const dynamic = "force-dynamic";

function readModelsConfig(): Record<string, unknown> {
  return readOmpModelsConfig(getOmpAgentDir());
}

export async function GET() {
  return NextResponse.json(readModelsConfig());
}

export async function PUT(req: Request) {
  try {
    const body = await req.json() as Record<string, unknown>;
    writeOmpModelsConfig(body, getOmpAgentDir());
    invalidateModelsCache();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
