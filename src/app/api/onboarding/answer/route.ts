import { NextRequest } from "next/server";
import {
  body,
  failure,
  identity,
  json,
  language,
  OnboardingError,
  revision,
  rpc,
} from "@/lib/onboarding-server";
import { provider } from "@/lib/onboarding-openrouter";
import { nextPrompt, validateProfile } from "@/lib/onboarding-profile";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  try {
    const { db } = await identity(request);
    const data = await body(request);
    const lang = language(data.language);
    const current = await rpc(db, "onboarding_read_draft");
    if (current.complete || current.revision !== revision(data.revision))
      throw new OnboardingError(
        409,
        "Reload your current draft before continuing.",
      );
    const client = provider(db);
    const transcript =
      data.audio !== undefined
        ? await client.transcribe(data.audio, data.format)
        : data.text;
    const result = await client.extract(
      transcript,
      validateProfile(current.profile),
      lang,
    );
    const profile = { ...current.profile, ...result.updates };
    return json({
      proposal: { profile, revision: current.revision },
      transcript,
      prompt: result.clarification
        ? { text: result.clarification, clip: null }
        : nextPrompt(profile, lang),
    });
  } catch (error) {
    return failure(error);
  }
}
