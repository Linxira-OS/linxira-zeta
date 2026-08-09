import { NextResponse } from "next/server";
import { mkdirSync } from "fs";
import { homedir } from "os";
import { allowFileRoot } from "@/lib/file-access";
import { defaultWorkspacePath } from "@/lib/default-workspace";

// POST /api/default-cwd
// Creates the stable ~/.zeta/workspace default workspace and returns its path.
export async function POST() {
  try {
    const dir = defaultWorkspacePath(homedir());
    mkdirSync(dir, { recursive: true });
    allowFileRoot(dir);
    return NextResponse.json({ cwd: dir });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
