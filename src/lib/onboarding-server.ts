import { createClient, SupabaseClient, User } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export class OnboardingError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
export function failure(error: unknown) {
  const status = error instanceof OnboardingError ? error.status : 502;
  const response = json(
    {
      error:
        error instanceof OnboardingError
          ? error.message
          : "This step is temporarily unavailable. Your draft is safe; please retry or type instead.",
    },
    status,
  );
  if (status === 429) response.headers.set("Retry-After", "60");
  return response;
}
export async function identity(
  request: NextRequest,
  mutation = true,
): Promise<{ db: SupabaseClient; user: User }> {
  if (
    mutation &&
    ![request.nextUrl.origin, process.env.ONBOARDING_ALLOWED_ORIGIN]
      .filter(Boolean).includes(request.headers.get("origin") || "")
  )
    throw new OnboardingError(403, "Request origin is not allowed.");
  const authorization = request.headers.get("authorization");
  const token = authorization?.match(/^Bearer ([^\s]+)$/)?.[1];
  if (!token)
    throw new OnboardingError(401, "Please continue with Google first.");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key)
    throw new OnboardingError(503, "Staging sign-in is not configured.");
  const db = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const { data, error } = await db.auth.getUser(token);
  const user = data.user;
  if (
    error ||
    !user ||
    user.is_anonymous ||
    !user.email_confirmed_at ||
    !user.identities?.some((item) => item.provider === "google")
  )
    throw new OnboardingError(
      401,
      "Please sign in with your verified Google account.",
    );
  return { db, user };
}
export async function body(
  request: NextRequest,
  limit = 3_000_000,
): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw new OnboardingError(400, "Invalid request.");
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new OnboardingError(413, "Recording or request is too large.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw Error();
    return value;
  } catch {
    throw new OnboardingError(400, "Invalid request.");
  }
}
export async function rpc(
  db: SupabaseClient,
  name: string,
  args: Record<string, unknown> = {},
) {
  const { data, error } = await db.rpc(name, args);
  if (error) {
    if (error.message.includes("STALE_DRAFT"))
      throw new OnboardingError(
        409,
        "Your profile changed in another tab. Reload the saved draft before editing.",
      );
    if (error.message.includes("INVALID_PROFILE"))
      throw new OnboardingError(400, "Please check the profile fields.");
    throw new OnboardingError(
      503,
      "Profile storage or shared quotas are not ready. No provider call was made.",
    );
  }
  return data;
}
export async function quota(db: SupabaseClient) {
  if ((await rpc(db, "onboarding_claim_quota")) !== true)
    throw new OnboardingError(
      429,
      "Voice allowance reached. Please use the editable profile, or try again later.",
    );
}
export function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0)
    throw new OnboardingError(400, "Invalid draft revision.");
  return Number(value);
}
export function language(value: unknown): "en" | "hi" {
  if (value !== "en" && value !== "hi")
    throw new OnboardingError(400, "Choose English or Hindi.");
  return value;
}
export function voice(value: unknown): "sarah" | "brian" {
  const allowed = (process.env.ONBOARDING_ALLOWED_VOICES || "sarah,brian")
    .split(",")
    .map((v) => v.trim());
  if ((value !== "sarah" && value !== "brian") || !allowed.includes(value))
    throw new OnboardingError(400, "Choose Sarah or Brian.");
  return value;
}
