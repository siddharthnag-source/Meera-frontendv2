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
    if (
      data.question !== undefined &&
      (typeof data.question !== "string" || data.question.length > 300)
    )
      throw new OnboardingError(400, "Invalid question context.");
    const client = provider(db);
    const transcript =
      data.audio !== undefined
        ? await client.transcribe(data.audio, data.format)
        : data.text;
    const result = await client.extract(
      transcript,
      validateProfile(current.profile),
      lang,
      typeof data.question === "string"
        ? data.question
        : nextPrompt(current.profile, lang).text,
    );
    const profile = { ...current.profile, ...result.updates };
    const next = nextPrompt(profile, lang);
    const updatedFields = Object.keys(result.updates);
    let prompt: { text: string; clip: string | null; review: boolean };
    if (result.clarification)
      prompt = { text: result.clarification, clip: null, review: false };
    else if (result.reply && !updatedFields.length)
      prompt = { text: result.reply, clip: null, review: false };
    else if (result.reply && !/[?？]/.test(result.reply))
      prompt = {
        text: `${result.reply} ${next.text}`,
        clip: null,
        review: next.clip === "review",
      };
    else prompt = { ...next, review: next.clip === "review" };
    return json({
      proposal: { profile, revision: current.revision },
      transcript,
      updatedFields,
      prompt,
    });
  } catch (error) {
    return failure(error);
  }
}
