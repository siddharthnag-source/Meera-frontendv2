import { randomUUID } from 'crypto';
import { campaignTouch } from '@/lib/marketingAttribution';
import { createSupabaseAdminClient } from '@/lib/meeraServer';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const reply = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, {
    status, headers: { 'Cache-Control': 'private, no-store' },
  });
  if (request.headers.get('origin') !== request.nextUrl.origin) return reply({ captured: false }, 403);
  if (Number(request.headers.get('content-length') ?? 0) > 2048) return reply({ captured: false }, 413);
  // Retain the original first touch. A return visit must not replace acquisition.
  if (request.cookies.get('meera_growth_link')?.value) return reply({ captured: true });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return reply({ captured: false }, 400);
  const params = new URLSearchParams();
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign']) {
    if (typeof body[key] !== 'string' || body[key].length > 160) return reply({ captured: false }, 400);
    params.set(key, body[key]);
  }
  const touch = campaignTouch(params.toString());
  if (!touch) return reply({ captured: false }, 400);
  const db = createSupabaseAdminClient();
  if (!db) return reply({ captured: false }, 503);
  // Only campaigns registered by analytics managers may acquire attribution.
  // Visitors cannot create campaigns or supply an authenticated identity here.
  const { data, error } = await db.from('growth_links').select('id, slug, expires_at')
    .eq('active', true).eq('utm_source', touch.utm_source).eq('utm_medium', touch.utm_medium)
    .eq('utm_campaign', touch.utm_campaign).order('created_at', { ascending: true }).limit(20);
  if (error) return reply({ captured: false }, 503);
  const link = data?.find((row) => !row.expires_at || Date.parse(row.expires_at) > Date.now());
  if (!link) return reply({ captured: false, reason: 'unregistered_campaign' });
  const cookieVisitor = request.cookies.get('meera_growth_visitor')?.value ?? '';
  const visitorId = /^[a-f0-9-]{36}$/i.test(cookieVisitor) ? cookieVisitor : randomUUID();
  const userAgent = request.headers.get('user-agent') ?? '';
  const device = /tablet|ipad/i.test(userAgent) ? 'tablet' : /mobile|iphone|android/i.test(userAgent) ? 'mobile' : 'desktop';
  const { error: clickError } = await db.from('growth_link_clicks').insert({
    link_id: link.id, visitor_id: visitorId, device_class: device, referrer_host: null,
  });
  if (clickError) return reply({ captured: false }, 503);
  const response = reply({ captured: true });
  const options = { httpOnly: true, sameSite: 'lax' as const, secure: request.nextUrl.protocol === 'https:', path: '/' };
  response.cookies.set('meera_growth_link', link.slug, { ...options, maxAge: 30 * 24 * 60 * 60 });
  response.cookies.set('meera_growth_visitor', visitorId, { ...options, maxAge: 365 * 24 * 60 * 60 });
  return response;
}
