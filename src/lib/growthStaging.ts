import { createHash } from 'node:crypto';
import { stripeSandboxDatabaseReady } from '@/lib/stripePayments';

export const STAGING_EXPERIMENT = 'growth_readiness_v1';
export function growthStagingReady() {
  return process.env.MEERA_PAYMENT_MODE === 'sandbox' &&
    process.env.MEERA_STRIPE_SANDBOX_SUPABASE_REF === 'wyitdnwftdxlibdnldfe' && stripeSandboxDatabaseReady();
}

// Separate salts keep enrollment and variant selection independent.
export function stagingAssignment(userId: string, allocation: number) {
  if (!userId || !Number.isInteger(allocation) || allocation < 0 || allocation > 100) throw new Error('Invalid assignment');
  const bucket = (salt: string) => createHash('sha256').update(`${STAGING_EXPERIMENT}:${salt}:${userId}`).digest().readUInt32BE(0);
  return {
    enrolled: bucket('enroll') % 100 < allocation,
    variant: bucket('variant') % 2 === 0 ? 'control' as const : 'treatment' as const,
  };
}
