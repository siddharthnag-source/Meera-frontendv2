import { randomUUID } from 'crypto';
import { createSupabaseAdminClient } from '@/lib/meeraServer';
import { marketingDestination } from '@/lib/marketingAttribution';
import { NextRequest, NextResponse } from 'next/server';

function deviceClass(userAgent: string): string {
  if (/tablet|ipad/i.test(userAgent)) return 'tablet';
  if (/mobile|iphone|android/i.test(userAgent)) return 'mobile';
  return 'desktop';
}

export async function GET(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const supabase = createSupabaseAdminClient();
  if (!supabase) return NextResponse.redirect(new URL('/', request.url));
  const { data: link } = await supabase
    .from('growth_links')
    .select('id, slug, destination_path, utm_source, utm_medium, utm_campaign, active, expires_at')
    .eq('slug', slug.toLowerCase())
    .maybeSingle();
  if (!link?.active || (link.expires_at && Date.parse(link.expires_at) <= Date.now())) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  const cookieVisitor = request.cookies.get('meera_growth_visitor')?.value ?? '';
  const visitorId = /^[a-f0-9-]{36}$/i.test(cookieVisitor) ? cookieVisitor : randomUUID();
  const referrer = request.headers.get('referer');
  let referrerHost: string | null = null;
  try {
    referrerHost = referrer ? new URL(referrer).hostname.slice(0, 160) : null;
  } catch {
    referrerHost = null;
  }
  await supabase.from('growth_link_clicks').insert({
    link_id: link.id,
    visitor_id: visitorId,
    referrer_host: referrerHost,
    device_class: deviceClass(request.headers.get('user-agent') ?? ''),
  });

  let destination: URL;
  try {
    destination = marketingDestination(request.nextUrl.origin, link.destination_path, link, link.slug, request.nextUrl.search);
  } catch {
    return NextResponse.redirect(new URL('/', request.url));
  }
  const response = NextResponse.redirect(destination);
  response.headers.set('Cache-Control', 'private, no-store');
  if (!request.cookies.get('meera_growth_link')?.value) response.cookies.set('meera_growth_link', link.slug, {
    httpOnly: true,
    sameSite: 'lax',
    secure: request.nextUrl.protocol === 'https:',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  response.cookies.set('meera_growth_visitor', visitorId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: request.nextUrl.protocol === 'https:',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}
