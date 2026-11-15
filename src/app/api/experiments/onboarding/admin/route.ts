import { NextRequest } from 'next/server';
import { body, OnboardingError, revision } from '@/lib/onboarding-server';
import {
  experimentFailure,
  experimentIdentity,
  experimentRpc,
  json,
  releaseReady,
  verifiedBudget,
} from '@/lib/experiments/onboarding-server';
import { ACCEPTANCE_CHECKS } from '@/lib/experiments/onboarding-contract';
export const runtime = 'nodejs';
export async function GET(request: NextRequest) {
  try {
    const { db } = await experimentIdentity(request, false);
    const report = await experimentRpc(db, 'onboarding_experiment_report');
    let budget = null;
    try {
      budget = await verifiedBudget();
    } catch {
      /* Read access and the off switch remain available. */
    }
    return json({
      ...report,
      releaseReady: releaseReady(),
      budgetVerified: budget !== null,
      budget,
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    return experimentFailure(e);
  }
}
export async function POST(request: NextRequest) {
  try {
    const { db } = await experimentIdentity(request);
    if ((await experimentRpc(db, 'onboarding_experiment_operator')) !== true)
      throw new OnboardingError(
        403,
        'Named experiment operator access is required.',
      );
    const data = await body(request, 4096);
    if (data.action === 'evidence') {
      if (
        Object.keys(data).some(
          (k) => !['action', 'check', 'passed', 'evidence'].includes(k),
        ) ||
        !ACCEPTANCE_CHECKS.includes(String(data.check)) ||
        typeof data.passed !== 'boolean' ||
        typeof data.evidence !== 'string'
      )
        throw new OnboardingError(400, 'Invalid evidence reference.');
      await experimentRpc(db, 'onboarding_experiment_accept', {
        p_check: data.check,
        p_passed: data.passed,
        p_evidence: data.evidence,
      });
      return json({ recorded: true });
    }
    if (data.action !== 'enable' && data.action !== 'disable')
      throw new OnboardingError(400, 'Invalid control action.');
    if (Object.keys(data).some((k) => !['action', 'version'].includes(k)))
      throw new OnboardingError(400, 'Invalid control payload.');
    // Disabling never depends on provider availability, evidence, or release readiness.
    const budget = data.action === 'enable' ? await verifiedBudget() : null;
    if (data.action === 'enable' && !releaseReady())
      throw new OnboardingError(
        409,
        'Reconciled production release is not marked ready.',
      );
    const config = await experimentRpc(db, 'onboarding_experiment_control', {
      p_enabled: data.action === 'enable',
      p_expected_version: revision(data.version),
    });
    return json({ config, budget });
  } catch (e) {
    return experimentFailure(e);
  }
}
