import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed, isWindowsAbsolutePath } from "@/lib/file-access";

interface TrackingStatus {
  phase: string;
  progress: string;
  blockers: string[];
  decisions: string[];
  lastUpdated: string;
}

interface TrackingAction {
  timestamp: string;
  action: string;
  detail?: string;
}

interface TrackingData {
  index: string | null;
  status: TrackingStatus | null;
  actions: TrackingAction[];
  sessions: { name: string; content: string }[];
}

function getTrackingDir(cwd: string): string {
  const zetaDir = path.join(cwd, ".zeta");
  if (fs.existsSync(zetaDir)) return path.join(zetaDir, "tracking");
  const ompDir = path.join(cwd, ".omp");
  if (fs.existsSync(ompDir)) return path.join(ompDir, "tracking");
  return path.join(zetaDir, "tracking");
}

function readIndex(trackingDir: string): string | null {
  try {
    return fs.readFileSync(path.join(trackingDir, "INDEX.md"), "utf8");
  } catch {
    return null;
  }
}

function readStatus(trackingDir: string): TrackingStatus | null {
  try {
    const raw = fs.readFileSync(path.join(trackingDir, "status.json"), "utf8");
    return JSON.parse(raw) as TrackingStatus;
  } catch {
    return null;
  }
}

function readActions(trackingDir: string): TrackingAction[] {
  try {
    const raw = fs.readFileSync(path.join(trackingDir, "actions.jsonl"), "utf8");
    const actions: TrackingAction[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        actions.push(JSON.parse(line.trim()) as TrackingAction);
      } catch {
        // skip invalid lines
      }
    }
    return actions;
  } catch {
    return [];
  }
}

function readSessions(trackingDir: string): { name: string; content: string }[] {
  const sessionsDir = path.join(trackingDir, "sessions");
  try {
    const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith(".md"));
    return files.map((f) => ({
      name: f,
      content: fs.readFileSync(path.join(sessionsDir, f), "utf8"),
    }));
  } catch {
    return [];
  }
}

export async function GET(request: NextRequest) {
  try {
    const cwd = request.nextUrl.searchParams.get("cwd")?.trim() ?? "";
    if (!cwd || (!cwd.startsWith("/") && !isWindowsAbsolutePath(cwd))) {
      return NextResponse.json({ error: "cwd must be an absolute path" }, { status: 400 });
    }

    const allowedRoots = await getAllowedFileRoots();
    if (!isFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(cwd);
    } catch {
      return NextResponse.json({ error: "Directory not found" }, { status: 404 });
    }
    if (!stat.isDirectory()) {
      return NextResponse.json({ error: "Not a directory" }, { status: 400 });
    }
    if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const trackingDir = getTrackingDir(cwd);
    const data: TrackingData = {
      index: readIndex(trackingDir),
      status: readStatus(trackingDir),
      actions: readActions(trackingDir),
      sessions: readSessions(trackingDir),
    };

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}