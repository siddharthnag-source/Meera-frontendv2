import { NextRequest } from "next/server";
import {
  body,
  failure,
  identity,
  json,
  OnboardingError,
  revision,
  rpc,
} from "@/lib/onboarding-server";
import { validateProfile } from "@/lib/onboarding-profile";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  try {
    const { db } = await identity(request);
    const data = await body(request, 8192);
    let profile;
    try {
      profile = validateProfile(data.profile);
    } catch (error) {
      throw new OnboardingError(400, (error as Error).message);
    }
    if (data.complete !== false && data.complete !== true)
      throw new OnboardingError(400, "Choose whether to save or keep a draft.");
    if (
      data.complete &&
      (!profile.name ||
        profile.job_details === undefined ||
        profile.dob === undefined)
    )
      throw new OnboardingError(
        400,
        "Review or skip the missing details before saving.",
      );
    if (
      typeof data.saveKey !== "string" ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
        data.saveKey,
      )
    )
      throw new OnboardingError(400, "Invalid save request.");
    const draft = await rpc(db, "onboarding_write_draft", {
      p_revision: revision(data.revision),
      p_profile: profile,
      p_complete: data.complete,
      p_save_key: data.saveKey,
    });
    return json({ draft });
  } catch (error) {
    return failure(error);
  }
}
