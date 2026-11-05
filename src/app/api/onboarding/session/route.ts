import { NextRequest } from "next/server";
import { failure, identity, json, rpc } from "@/lib/onboarding-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function session(request: NextRequest, mutation: boolean) {
  try {
    const { db, user } = await identity(request, mutation);
    const draft = await rpc(db, "onboarding_read_draft");
    return json({
      draft,
      googleName: user.user_metadata.full_name || user.user_metadata.name || "",
      workspace:
        process.env.ONBOARDING_WORKSPACE_URL ||
        (process.env.ONBOARDING_SIGN_IN_URL
          ? new URL(process.env.ONBOARDING_SIGN_IN_URL).origin + "/"
          : "/"),
      voiceConfigured: Boolean(
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
