import { NextRequest } from "next/server";
import {
  failure,
  identity,
  json,
  OnboardingError,
  rpc,
} from "@/lib/onboarding-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function session(request: NextRequest, mutation: boolean) {
  try {
    const { db, user } = await identity(request, mutation);
    let draft = null;
    let profileReady = true;
    try {
      draft = await rpc(db, "onboarding_read_draft");
    } catch (error) {
      if (!(error instanceof OnboardingError) || error.status !== 503)
        throw error;
      // Optional personalization must never block an authenticated user from Meera.
      // Paid calls still require working shared quotas and fail closed independently.
      profileReady = false;
    }
    return json({
      draft,
      profileReady,
      googleName: user.user_metadata.full_name || user.user_metadata.name || "",
      workspace:
        process.env.ONBOARDING_WORKSPACE_URL ||
        (process.env.ONBOARDING_SIGN_IN_URL
          ? new URL(process.env.ONBOARDING_SIGN_IN_URL).origin + "/"
          : "/"),
      voiceConfigured:
        profileReady &&
        Boolean(
          process.env.OPENROUTER_API_KEY &&
          process.env.ONBOARDING_STT_MODEL &&
          process.env.ONBOARDING_LLM_MODEL &&
          process.env.ONBOARDING_TTS_MODEL,
        ),
    });
  } catch (error) {
    return failure(error);
  }
}
export const GET = (request: NextRequest) => session(request, false);
export const POST = (request: NextRequest) => session(request, true);
