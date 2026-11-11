import { requireAuthenticatedUser } from '@/lib/meeraServer';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';

export type AnalyticsRole = 'owner' | 'product_growth' | 'growth_aggregate' | 'analyst' | 'support' | 'internal_viewer';
export type AnalyticsPermission =
  | 'analytics.view'
  | 'users.list'
  | 'users.view_pii'
  | 'conversations.view_metadata'
  | 'conversations.view_redacted'
  | 'conversations.view_full'
  | 'growth_links.view'
  | 'growth_links.manage'
  | 'access.manage';

const ROLE_PERMISSIONS: Record<AnalyticsRole, AnalyticsPermission[]> = {
  // Funnel/cohort totals only. User drilldowns, PII, conversations and access
  // administration remain unavailable to this role.
  growth_aggregate: ['analytics.view'],
  owner: [
    'analytics.view',
    'users.list',
    'users.view_pii',
    'conversations.view_metadata',
    'conversations.view_redacted',
    'conversations.view_full',
    'growth_links.view',
    'growth_links.manage',
    'access.manage',
  ],
  product_growth: [
    'analytics.view',
    'users.list',
    'users.view_pii',
    'conversations.view_metadata',
    'conversations.view_redacted',
    'conversations.view_full',
    'growth_links.view',
    'growth_links.manage',
  ],
  analyst: [
    'analytics.view',
    'users.list',
    'users.view_pii',
    'growth_links.view',
  ],
  support: [
    'analytics.view',
    'users.list',
    'users.view_pii',
    'conversations.view_metadata',
    'conversations.view_redacted',
  ],
  internal_viewer: [
    'analytics.view',
    'users.list',
    'users.view_pii',
  ],
};

type AuthorizedAnalyticsUser = {
  ok: true;
  supabase: SupabaseClient;
  user: User;
  email: string;
  role: AnalyticsRole;
  permissions: AnalyticsPermission[];
};

type UnauthorizedAnalyticsUser = {
  ok: false;
  status: number;
  message: string;
};

function isInternalEmail(email: string): boolean {
  const allowedDomain = (
    process.env.MEERA_ADMIN_EMAIL_DOMAIN ??
    process.env.ANALYTICS_ALLOWED_EMAIL_DOMAIN ??
    'himeera.com'
  )
    .trim()
    .toLowerCase()
    .replace(/^@/, '');
  return Boolean(allowedDomain) && email.endsWith(`@${allowedDomain}`);
}

export async function requireAnalyticsPermission(
  request: NextRequest,
  permission: AnalyticsPermission,
): Promise<AuthorizedAnalyticsUser | UnauthorizedAnalyticsUser> {
  const auth = await requireAuthenticatedUser(request);
  if (!auth.ok) return auth;

  const email = String(auth.user.email ?? '')
    .trim()
    .toLowerCase();
  if (!email) return { ok: false, status: 403, message: 'Analytics access requires an email address.' };

  const { data: accessRow, error } = await auth.supabase
    .from('analytics_access')
    .select('role, enabled')
    .eq('email', email)
    .maybeSingle();

  if (error && error.code !== 'PGRST205' && error.code !== '42P01') {
    console.error('Analytics access lookup failed:', { code: error.code, message: error.message });
    return { ok: false, status: 500, message: 'Unable to verify analytics access.' };
  }

  let role: AnalyticsRole | null = null;
  if (accessRow?.enabled && accessRow.role in ROLE_PERMISSIONS) {
    role = accessRow.role as AnalyticsRole;
  } else if (!accessRow && isInternalEmail(email)) {
    // Preserve the existing internal dashboard while keeping sensitive chat access opt-in.
    role = 'internal_viewer';
  }

  if (!role) return { ok: false, status: 403, message: 'Analytics access is not enabled for this account.' };

  const permissions = ROLE_PERMISSIONS[role];
  if (!permissions.includes(permission)) {
    return { ok: false, status: 403, message: `Missing permission: ${permission}` };
  }

  return {
    ok: true,
    supabase: auth.supabase,
    user: auth.user,
    email,
    role,
    permissions,
  };
}

export function permissionsForRole(role: AnalyticsRole): AnalyticsPermission[] {
  return [...ROLE_PERMISSIONS[role]];
}

export async function writeAnalyticsAudit(
  auth: AuthorizedAnalyticsUser,
  entry: {
    action: string;
    targetUserId?: string | null;
    targetMessageId?: string | null;
    reason?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<boolean> {
  const { error } = await auth.supabase.from('analytics_audit_log').insert({
    actor_user_id: auth.user.id,
    actor_email: auth.email,
    action: entry.action,
    target_user_id: entry.targetUserId ?? null,
    target_message_id: entry.targetMessageId ?? null,
    reason: entry.reason ?? null,
    metadata: entry.metadata ?? {},
  });

  if (error) {
    console.error('Analytics audit write failed:', { code: error.code, message: error.message, action: entry.action });
    return false;
  }

  return true;
}
