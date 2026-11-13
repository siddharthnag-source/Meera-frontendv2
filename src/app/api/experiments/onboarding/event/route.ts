import { NextRequest } from 'next/server';
import { body, OnboardingError } from '@/lib/onboarding-server';
import { validateEvent } from '@/lib/experiments/onboarding-contract';
import {
  experimentFailure,
  experimentIdentity,
  experimentRpc,
  json,
} from '@/lib/experiments/onboarding-server';
export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  try {
    const { db } = await experimentIdentity(request);
    let event;
    try {
      event = validateEvent(await body(request, 2048));
    } catch {
      throw new OnboardingError(400, 'Invalid telemetry payload.');
    }
    // Existing exposed cohorts may finish their 24-hour outcomes after the switch is off.
    const accepted = await experimentRpc(db, 'onboarding_experiment_event', {
      p_event_id: event.eventId,
      p_event: event.event,
      p_duration_ms: event.durationMs ?? null,
      p_reason: event.reason ?? null,
      p_mode: event.mode ?? null,
    });
    return json({ accepted: accepted === true });
  } catch (e) {
    return experimentFailure(e);
  }
}
