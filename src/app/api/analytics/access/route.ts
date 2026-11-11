import { NextRequest, NextResponse } from 'next/server';
import {
  permissionsForRole,
  requireAnalyticsPermission,
  type AnalyticsRole,
  writeAnalyticsAudit,
} from '@/lib/analyticsAccess';

const ASSIGNABLE_ROLES = new Set<AnalyticsRole>(['owner', 'product_growth', 'growth_aggregate', 'analyst', 'support']);

export async function GET(request: NextRequest) {
  const auth = await requireAnalyticsPermission(request, 'access.manage');
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  const { data, error } = await auth.supabase
    .from('analytics_access')
    .select('email, role, enabled, granted_by_email, created_at, updated_at')
    .order('email', { ascending: true });

  if (error) return NextResponse.json({ error: 'Unable to load team access.' }, { status: 500 });

  return NextResponse.json(
    {
      members: (data ?? []).map((row) => ({
        ...row,
        permissions: permissionsForRole(row.role as AnalyticsRole),
      })),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(request: NextRequest) {
  const auth = await requireAnalyticsPermission(request, 'access.manage');
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  const body = (await request.json().catch(() => null)) as
    | { email?: string; role?: AnalyticsRole; enabled?: boolean }
    | null;
  const email = String(body?.email ?? '').trim().toLowerCase();
  const role = body?.role;
  const enabled = body?.enabled !== false;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
  }
  if (!role || !ASSIGNABLE_ROLES.has(role)) {
    return NextResponse.json({ error: 'Select a valid analytics role.' }, { status: 400 });
  }
  if (email === auth.email && (!enabled || role !== 'owner')) {
    return NextResponse.json({ error: 'You cannot remove your own owner access.' }, { status: 400 });
  }

  const { error } = await auth.supabase.from('analytics_access').upsert(
    {
      email,
      role,
      enabled,
      granted_by_email: auth.email,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'email' },
  );

  if (error) return NextResponse.json({ error: 'Unable to update team access.' }, { status: 500 });

  const audited = await writeAnalyticsAudit(auth, {
    action: 'analytics.access.updated',
    reason: 'Team access administration',
    metadata: { subject_email: email, role, enabled },
  });
  if (!audited) return NextResponse.json({ error: 'Access changed, but the audit entry failed.' }, { status: 500 });

  return NextResponse.json({ email, role, enabled, permissions: permissionsForRole(role) });
}
