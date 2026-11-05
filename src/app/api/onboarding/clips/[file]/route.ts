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
    const root =
      path.basename(process.cwd()) === "onboarding-staging" ? ".." : ".";
    const audio = await readFile(
      path.join(process.cwd(), root, "tools/voice-onboarding/assets", file),
    );
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
