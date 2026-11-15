import { NextRequest, NextResponse } from 'next/server';
import { identity, OnboardingError } from '@/lib/onboarding-server';
export const EXPERIMENT = 'onboarding_input_mode_v1';
export const json = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  });
export async function experimentIdentity(
  request: NextRequest,
  mutation = true,
) {
  return identity(request, mutation);
}
export async function experimentRpc(
  db: Awaited<ReturnType<typeof identity>>['db'],
  name: string,
  args: Record<string, unknown> = {},
) {
  const { data, error } = await db.rpc(name, args);
  if (error) {
    const status = /FORBIDDEN/.test(error.message)
      ? 403
      : /AUTH_REQUIRED/.test(error.message)
        ? 401
        : /RATE_LIMITED/.test(error.message)
          ? 429
          : /STALE|ACCEPTANCE_REQUIRED|COHORT_REQUIRED|WINDOW_CLOSED/.test(
                error.message,
              )
            ? 409
            : /INVALID|EVIDENCE_REQUIRED|UNKNOWN_CHECK|WORKSPACE_REQUIRED/.test(
                  error.message,
                )
              ? 400
              : 503;
    throw new OnboardingError(
      status,
      status === 503 ? 'Experiment storage is unavailable.' : error.message,
    );
  }
  return data;
}
export function experimentFailure(error: unknown) {
  const status = error instanceof OnboardingError ? error.status : 503;
  return json(
    {
      error:
        error instanceof OnboardingError
          ? error.message
          : 'Experiment request unavailable.',
    },
    status,
  );
}
export function releaseReady() {
  return process.env.ONBOARDING_EXPERIMENT_READY === 'true';
}
export async function verifiedBudget() {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new OnboardingError(503, 'Provider budget is unverified.');
  const response = await fetch('https://openrouter.ai/api/v1/key', {
    headers: { Authorization: `Bearer ${key}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok)
    throw new OnboardingError(503, 'Provider budget is unverified.');
  const { data } = await response.json();
  const remaining = data?.limit_remaining;
  const limit = data?.limit;
  const expiry = Date.parse(data?.expires_at || '');
  if (
    typeof remaining !== 'number' ||
    !Number.isFinite(remaining) ||
    typeof limit !== 'number' ||
    !Number.isFinite(limit) ||
    limit <= 0 ||
    remaining > limit ||
    limit > 9.9 ||
    remaining < 2 ||
    data.limit_reset != null ||
    !Number.isFinite(expiry) ||
    expiry <= Date.now() ||
    expiry > Date.parse('2026-11-19T12:00:00Z')
  )
    throw new OnboardingError(
      409,
      'Provider cap, remaining budget, reset or expiry does not meet the pilot guardrail.',
    );
  return {
    limitUsd: limit,
    remainingUsd: remaining,
    reset: null,
    expiresAt: new Date(expiry).toISOString(),
  };
}
