import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
export const runtime = "nodejs";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;
  if (
    !/^(sarah|brian)(-hi)?-(preview|welcome|work|birthday|review|finish)\.mp3$/.test(
      file,
    )
  )
    return new NextResponse(null, { status: 404 });
  try {
    // Standalone deployment assets live under the app root. In the repository's
    // nested staging app, the shared assets live one directory above it.
    const local = path.join(process.cwd(), "tools/voice-onboarding/assets", file);
    const shared = path.join(process.cwd(), "..", "tools/voice-onboarding/assets", file);
    const audio = await readFile(local).catch(() => readFile(shared));
    return new NextResponse(new Uint8Array(audio), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
