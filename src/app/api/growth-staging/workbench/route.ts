import { NextRequest, NextResponse } from 'next/server';
import { paymentIdentity } from '@/lib/stripePayments';
import { growthStagingReady, stagingAssignment, STAGING_EXPERIMENT } from '@/lib/growthStaging';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store' };
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });

async function identity(request: NextRequest) {
  if (!growthStagingReady()) return null;
  return paymentIdentity(request);
}
async function isOperator(auth: NonNullable<Awaited<ReturnType<typeof identity>>>) {
  const email = auth.user.email?.trim().toLowerCase();
  if (!email) return false;
  const verifiedGoogle = auth.user.identities?.some(identity => identity.provider === 'google' &&
    identity.identity_data?.email_verified === true && identity.identity_data?.email?.toLowerCase() === email);
  if (!verifiedGoogle) return false;
  const { data, error } = await auth.db.from('growth_staging_operators').select('enabled').eq('email', email).maybeSingle();
  if (error) throw error;
  return data?.enabled === true;
}

export async function GET(request: NextRequest) {
  if (!growthStagingReady()) return reply({ error: 'Staging workbench disabled' }, 404);
  try {
    const auth = await identity(request);
    if (!auth) return reply({ error: 'Authentication required' }, 401);
    if (!await isOperator(auth)) return reply({ error: 'Staging operator access required' }, 403);
    const count = async (table: string, filters: Record<string, string> = {}, exposed = false) => {
      let query = auth.db.from(table).select('*', { count: 'exact', head: true });
      for (const [key, value] of Object.entries(filters)) query = query.eq(key, value);
      if (exposed) query = query.not('exposed_at', 'is', null);
      const result = await query;
      if (result.error || result.count === null) throw new Error('Aggregate query unavailable');
      return result.count;
    };
    const config = await auth.db.from('growth_staging_experiments').select('enabled,allocation').eq('id', STAGING_EXPERIMENT).single();
    if (config.error) throw config.error;
    const [profiles, paid, refunded, control, treatment, controlExposed, treatmentExposed] = await Promise.all([
      count('users'), count('payments', { payment_status: 'paid', currency: 'USD', plan_type: 'lifetime' }),
      count('payments', { payment_status: 'refunded', currency: 'USD', plan_type: 'lifetime' }),
      count('growth_staging_assignments', { experiment_id: STAGING_EXPERIMENT, variant: 'control' }),
      count('growth_staging_assignments', { experiment_id: STAGING_EXPERIMENT, variant: 'treatment' }),
      count('growth_staging_assignments', { experiment_id: STAGING_EXPERIMENT, variant: 'control' }, true),
      count('growth_staging_assignments', { experiment_id: STAGING_EXPERIMENT, variant: 'treatment' }, true),
    ]);
    return reply({ test_only: true, generated_at: new Date().toISOString(), config: config.data,
      totals: { profiles, paid, refunded }, assignment: { control, treatment, controlExposed, treatmentExposed },
      notes: ['Synthetic staging only. Exclude every record here from production acquisition and revenue reports.',
        'Assignment preview verifies experiment mechanics; it is not a live product experiment or an AI activation test.'] });
  } catch { return reply({ error: 'Staging report unavailable' }, 503); }
}

export async function POST(request: NextRequest) {
  if (!growthStagingReady()) return reply({ error: 'Staging workbench disabled' }, 404);
  // Browser operations require same-origin, JSON and a verified bearer identity.
  if (request.headers.get('origin') !== request.nextUrl.origin || !request.headers.get('content-type')?.startsWith('application/json')) {
    return reply({ error: 'Same-origin JSON required' }, 403);
  }
  try {
    const auth = await identity(request);
    if (!auth) return reply({ error: 'Authentication required' }, 401);
    let input;
    try { input = await request.json(); } catch { return reply({ error: 'Invalid JSON' }, 400); }
    if (!input || typeof input !== 'object') return reply({ error: 'Invalid operation' }, 400);
    if (input.operation === 'configure') {
      if (!await isOperator(auth)) return reply({ error: 'Staging operator access required' }, 403);
      if (typeof input.enabled !== 'boolean' || !Number.isInteger(input.allocation) || input.allocation < 0 || input.allocation > 100) {
        return reply({ error: 'Invalid experiment configuration' }, 400);
      }
      const { error } = await auth.db.from('growth_staging_experiments').update({ enabled: input.enabled, allocation: input.allocation,
        updated_at: new Date().toISOString() }).eq('id', STAGING_EXPERIMENT);
      if (error) throw error;
      return reply({ configured: true });
    }
    if (!['assign', 'expose'].includes(input.operation)) return reply({ error: 'Unknown operation' }, 400);
    const config = await auth.db.from('growth_staging_experiments').select('enabled,allocation').eq('id', STAGING_EXPERIMENT).single();
    if (config.error) throw config.error;
    if (!config.data.enabled) return reply({ enabled: false, enrolled: false, variant: 'control' });
    const assigned = () => auth.db.from('growth_staging_assignments').select('variant,exposed_at')
      .eq('experiment_id', STAGING_EXPERIMENT).eq('auth_user_id', auth.user.id).maybeSingle();
    let current = await assigned();
    if (current.error) throw current.error;
    if (input.operation === 'assign' && !current.data) {
      const selection = stagingAssignment(auth.user.id, config.data.allocation);
      if (!selection.enrolled) return reply({ enabled: true, enrolled: false, variant: 'control' });
      const saved = await auth.db.from('growth_staging_assignments').upsert({ experiment_id: STAGING_EXPERIMENT,
        auth_user_id: auth.user.id, variant: selection.variant }, { onConflict: 'experiment_id,auth_user_id', ignoreDuplicates: true });
      if (saved.error) throw saved.error;
      current = await assigned();
      if (current.error || !current.data) throw new Error('Assignment unavailable');
    }
    if (!current.data) return reply({ error: 'Assignment required before exposure' }, 409);
    if (input.operation === 'expose') {
      const result = await auth.db.from('growth_staging_assignments').update({ exposed_at: new Date().toISOString() })
        .eq('experiment_id', STAGING_EXPERIMENT).eq('auth_user_id', auth.user.id).is('exposed_at', null);
      if (result.error) throw result.error;
    }
    return reply({ enabled: true, enrolled: true, variant: current.data.variant, exposed: input.operation === 'expose' || Boolean(current.data.exposed_at) });
  } catch { return reply({ error: 'Staging experiment unavailable' }, 503); }
}
