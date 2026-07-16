import { promises as fs } from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  try {
    const source = await fs.readFile(
      path.join(process.cwd(), "node_modules", "gsap", "dist", "gsap.min.js"),
      "utf8",
    );
    return new NextResponse(source, {
      headers: {
        "Content-Type": "text/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new NextResponse("Render runtime unavailable", { status: 503 });
  }
}
