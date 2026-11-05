import { NextRequest, NextResponse } from "next/server";
import {
  body,
  failure,
  identity,
  voice,
  OnboardingError,
} from "@/lib/onboarding-server";
import { provider } from "@/lib/onboarding-openrouter";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  try {
    const { db } = await identity(request);
    const data = await body(request, 2048);
    const selectedVoice = voice(data.voice);
    if (typeof data.text !== "string")
      throw new OnboardingError(400, "Invalid speech request.");
    const audio = await provider(db).speak(data.text, selectedVoice);
    return new NextResponse(audio, {
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
    });
  } catch (error) {
    return failure(error);
  }
}
