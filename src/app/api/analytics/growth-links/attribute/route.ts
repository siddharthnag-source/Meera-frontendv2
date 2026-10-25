import { requireAuthenticatedUser } from '@/lib/meeraServer';
import { isNewRegistration } from '@/lib/marketingRegistration';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const auth = await requireAuthenticatedUser(request);
  if (!auth.ok) return NextResponse.json({ attributed: false }, { status: auth.status });
  if (!isNewRegistration(auth.user)) return NextResponse.json({ attributed: false, reason: 'not_new_registration' });
  const slug = request.cookies.get('meera_growth_link')?.value?.trim().toLowerCase() ?? '';
  if (!slug) return NextResponse.json({ attributed: false, reason: 'no_growth_link' });

  const { data: link } = await auth.supabase
    .from('growth_links')
    .select('id, active, expires_at')
    .eq('slug', slug)
    .maybeSingle();
  if (!link?.active || (link.expires_at && Date.parse(link.expires_at) <= Date.now())) {
    return NextResponse.json({ attributed: false, reason: 'inactive_link' });
  }

  const { error } = await auth.supabase.from('growth_link_attributions').upsert(
    {
      link_id: link.id,
      auth_user_id: auth.user.id,
      user_email:
        String(auth.user.email ?? '')
          .trim()
          .toLowerCase() || null,
    },
    { onConflict: 'auth_user_id', ignoreDuplicates: true },
  );
  if (error) return NextResponse.json({ attributed: false, reason: 'insert_failed' }, { status: 500 });
  return NextResponse.json({ attributed: true });
}
