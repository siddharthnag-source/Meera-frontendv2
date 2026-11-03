import { GoogleGenAI } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";
import { onboardingConfig } from "@/lib/onboarding-agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (body: object, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: NextRequest) {
  const origin =
    process.env.ONBOARDING_ALLOWED_ORIGIN || request.nextUrl.origin;
  if (request.headers.get("origin") !== origin)
    return reply({ error: "Request origin is not allowed." }, 403);
  const apiKey = process.env.GEMINI_API_KEY;
  const secret = process.env.TURNSTILE_SECRET_KEY;
  const model = process.env.GEMINI_ONBOARDING_MODEL;
  if (!apiKey || !secret || !model)
    return reply(
      {
        error:
          "Voice onboarding is not configured yet. You can still continue with Google.",
      },
      503,
    );
  if (Number(request.headers.get("content-length") || 0) > 4096)
    return reply({ error: "Request too large." }, 413);
  let challenge: unknown;
  try {
    challenge = (await request.json()).challenge;
  } catch {
    return reply({ error: "Invalid request." }, 400);
  }
  if (typeof challenge !== "string" || !challenge || challenge.length > 2048)
    return reply({ error: "Complete the verification first." }, 400);
  try {
    const verification = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        body: new URLSearchParams({ secret, response: challenge }),
        signal: AbortSignal.timeout(10000),
      },
    );
    const result = (await verification.json()) as {
      success?: boolean;
      hostname?: string;
      action?: string;
    };
    if (
      !verification.ok ||
      !result.success ||
      result.hostname !== new URL(origin).hostname ||
      result.action !== "onboarding"
    ) {
      return reply({ error: "Verification expired. Please try again." }, 403);
    }
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { apiVersion: "v1alpha", timeout: 15000 },
    });
    const token = await ai.authTokens.create({
      config: {
        uses: 1,
        expireTime: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        newSessionExpireTime: new Date(Date.now() + 60 * 1000).toISOString(),
        liveConnectConstraints: { model, config: onboardingConfig() },
      },
    });
    if (!token.name) throw new Error("Missing token");
    return reply({ token: token.name, model });
  } catch {
    return reply(
      {
        error:
          "Voice is temporarily unavailable. Please try again or continue with Google.",
      },
      502,
    );
  }
}
