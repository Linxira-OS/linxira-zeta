import { NextResponse } from "next/server";
import { getInstalledWebPlugins } from "@/lib/plugin-pages";

// GET /api/plugin-pages
// Every installed web plugin with the pages it ships. A page's `url` is its
// asset URL; the page itself is mounted at `/plugins/view/<plugin>/<page>`
// (chrome-free), which is what a host panel points at.
export async function GET() {
  try {
    return NextResponse.json({ plugins: getInstalledWebPlugins() });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
