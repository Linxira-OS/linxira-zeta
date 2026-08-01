import { NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { getOmpAgentDir } from "@/lib/file-paths";
import { invalidateModelsCache } from "@/lib/models-cache";
import { readOmpModelsFromDb } from "@/lib/omp-models";

export const dynamic = "force-dynamic";

function getModelsPath(): string {
  return join(getOmpAgentDir(), "models.json");
}

function readModelsJson(): Record<string, unknown> {
  const path = getModelsPath();
  if (existsSync(path)) {
    try {
      return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    } catch {
      // ignore error and fallback
    }
  }
  const dbModels = readOmpModelsFromDb();
  const providers: Record<string, { models: { id: string; name: string }[] }> = {};
  for (const m of dbModels) {
    if (!providers[m.provider]) {
      providers[m.provider] = { models: [] };
    }
    providers[m.provider].models.push({ id: m.id, name: m.name });
  }
  return { providers };
}

function writeModelsJson(data: Record<string, unknown>): void {
  const path = getModelsPath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
}

export async function GET() {
  return NextResponse.json(readModelsJson());
}

export async function PUT(req: Request) {
  try {
    const body = await req.json() as Record<string, unknown>;
    writeModelsJson(body);
    invalidateModelsCache();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
