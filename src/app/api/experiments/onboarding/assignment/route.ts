import { NextRequest } from 'next/server';
import { body, OnboardingError, revision } from '@/lib/onboarding-server';
import {
  experimentFailure,
  experimentIdentity,
  experimentRpc,
  json,
  releaseReady,
} from '@/lib/experiments/onboarding-server';
export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  try {
    const { db } = await experimentIdentity(request);
    if (!releaseReady()) return json({ enabled: false, assigned: false });
    const origin = new URL(request.url).origin;
    const referrer = request.headers.get('referer');
    if (
      !referrer ||
      new URL(referrer).origin !== origin ||
      new URL(referrer).pathname !== '/onboarding'
    )
      throw new OnboardingError(
        403,
        'Use the explicit onboarding entry point.',
      );
    const data = await body(request, 2048);
    if (
      Object.keys(data).some((k) => !['expose', 'version', 'qa'].includes(k)) ||
      typeof data.expose !== 'boolean' ||
      (data.qa !== undefined && typeof data.qa !== 'boolean')
    )
      throw new OnboardingError(400, 'Invalid assignment request.');
    const assignment = await experimentRpc(
      db,
      'onboarding_experiment_assignment',
      {
        p_expose: data.expose,
        p_version: data.expose ? revision(data.version) : null,
        p_qa: data.qa === true,
      },
    );
    return json(assignment);
  } catch (e) {
    return experimentFailure(e);
  }
}

export async function GET(request: NextRequest) {
  try {
    const { db } = await experimentIdentity(request, false);
    return json(await experimentRpc(db, 'onboarding_experiment_status'));
  } catch (e) {
    return experimentFailure(e);
  }
}
