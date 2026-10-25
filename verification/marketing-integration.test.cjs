const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const local = {
    './marketingAttribution': 'src/lib/marketingAttribution.ts',
    './metaPixel': 'src/lib/metaPixel.ts',
    '@/lib/marketingAttribution': 'src/lib/marketingAttribution.ts',
    '@/lib/marketingRegistration': 'src/lib/marketingRegistration.ts',
  };
  vm.runInNewContext(code, { exports, URL, URLSearchParams, Date, process, ...globals,
    require: (id) => local[id] ? load(local[id], globals) : globals.require ? globals.require(id) : require(id) });
  return exports;
}

test('redirect preserves click IDs and optional creative labels without allowing open redirects', () => {
  const { marketingDestination } = load('src/lib/marketingAttribution.ts');
  const touch = { utm_source: 'instagram', utm_medium: 'paid_social', utm_campaign: 'US Meera (October).v2' };
  const url = marketingDestination('https://www.himeera.com', '/sign-in', touch, 'meta-test', '?fbclid=click_ABC-123&utm_content=Creative+A&email=private%40example.com&utm_campaign=forged');
  assert.equal(url.searchParams.get('fbclid'), 'click_ABC-123');
  assert.equal(url.searchParams.get('utm_content'), 'Creative A');
  assert.equal(url.searchParams.get('utm_campaign'), touch.utm_campaign);
  assert.equal(url.searchParams.has('email'), false);
  assert.throws(() => marketingDestination('https://www.himeera.com', '//evil.example', touch, 'test', ''));
});

test('ordinary campaign labels work while private URLs, emails and OAuth fragments remain blocked', () => {
  const { isMarketingPage } = load('src/lib/metaPixel.ts');
  for (const path of ['/', '/sign-in', '/pricing', '/labs', '/payment']) {
    assert.equal(isMarketingPage(path, '?utm_campaign=US%20Meera%20(October).v2&fbclid=ABC_123', ''), true);
  }
  for (const [path, search, hash] of [
    ['/analytics', '', ''], ['/', '?conversation_id=secret', ''],
    ['/', '?utm_campaign=person%40example.com', ''], ['/', '', '#access_token=secret'],
    ['/auth/callback', '', ''], ['/payment', '?checkout_session_id=cs_secret', ''],
  ]) assert.equal(isMarketingPage(path, search, hash), false);
});

test('production growth-link rows yield a pixel-eligible destination without registry fields', () => {
  const { marketingDestination } = load('src/lib/marketingAttribution.ts');
  const { isMarketingPage } = load('src/lib/metaPixel.ts');
  const row = { id: 'registry-id', slug: 'meta-us-lifetime-99-oct2026', destination_path: '/sign-in',
    utm_source: 'meta', utm_medium: 'paid_social', utm_campaign: 'us_lifetime_99_oct2026', active: true, expires_at: null };
  const url = marketingDestination('https://www.himeera.com', row.destination_path, row, row.slug, '?fbclid=ad_click_123');
  assert.deepEqual([...url.searchParams.keys()].sort(), ['fbclid', 'gl', 'utm_campaign', 'utm_medium', 'utm_source']);
  assert.equal(isMarketingPage(url.pathname, url.search, ''), true);
});

test('fixed US offer and cancelled checkout allow measurement while arbitrary offers and session identifiers remain excluded', () => {
  const { isMarketingPage } = load('src/lib/metaPixel.ts');
  for (const path of ['/sign-in', '/payment']) assert.equal(isMarketingPage(path, '?offer=us-lifetime', ''), true);
  assert.equal(isMarketingPage('/payment', '?offer=us-lifetime&checkout=cancelled', ''), true);
  for (const [path, query] of [['/', '?offer=us-lifetime'], ['/payment', '?offer=private'],
    ['/sign-in', '?checkout=cancelled'], ['/payment', '?checkout_session_id=cs_private'],
    ['/payment', '?offer=us-lifetime&email=private%40example.com']]) {
    assert.equal(isMarketingPage(path, query, ''), false);
  }
});

test('home-to-sign-in navigation retains click attribution without propagating private query fields', () => {
  const { preserveMarketingParams } = load('src/lib/marketingAttribution.ts');
  const target = new URL(preserveMarketingParams('/sign-in', '?fbclid=ABC_123&utm_campaign=US+Meera&conversation_id=secret&email=private%40example.com'), 'https://www.himeera.com');
  assert.equal(target.searchParams.get('fbclid'), 'ABC_123');
  assert.equal(target.searchParams.get('utm_campaign'), 'US Meera');
  assert.equal(target.searchParams.has('conversation_id'), false);
  assert.equal(target.searchParams.has('email'), false);
});

test('blocked SDK retains pending conversion and later submits one stable ID without private fields', () => {
  const storage = new Map();
  const calls = [];
  const window = { location: { pathname: '/', search: '', hash: '' } };
  const events = load('src/lib/marketingEvents.ts', {
    window,
    sessionStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
  });
  const event = { name: 'CompleteRegistration', eventId: '11111111-1111-4111-8111-111111111111' };
  events.queueMarketingEvent(event);
  assert.equal(calls.length, 0);
  assert.match(storage.get('meera:marketing-events:v2'), /11111111/);
  window.meeraMetaPixelInitialized = true;
  window.fbq = (...args) => calls.push(args);
  window.fbq.callMethod = () => {};
  events.dispatchPendingMarketingEvents();
  events.dispatchPendingMarketingEvents();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][4].eventID, event.eventId);
  assert.equal(Object.keys(calls[0][3]).length, 0);
  assert.equal(JSON.parse(storage.get('meera:marketing-events:v2')).length, 1);
  window.location.search = '?conversation_id=private';
  events.queueMarketingEvent({ ...event, eventId: '22222222-2222-4222-8222-222222222222' });
  assert.equal(calls.length, 1);
  window.location.search = '';
  events.queueMarketingEvent({ name: 'Purchase', eventId: 'a'.repeat(64), countsOnly: true, value: 499, currency: 'INR' });
  const purchase = calls.find((call) => call[2] === 'Purchase');
  assert.ok(purchase);
  assert.equal(Object.keys(purchase[3]).length, 0, 'Core Setup must receive no commerce parameters');
});

test('direct campaign capture accepts registered campaigns, preserves first touch and rejects cross-origin requests', async () => {
  let writes = 0;
  const db = { from: (table) => table === 'growth_link_clicks' ? { insert: async () => { writes++; return { error: null }; } } : {
    select: () => { const q = { eq: () => q, order: () => q, limit: async () => ({ data: [{ id: 'link-id', slug: 'meta-test', expires_at: null }], error: null }) }; return q; },
  } };
  const { POST } = load('src/app/api/analytics/growth-links/capture/route.ts', {
    require: (id) => {
      if (id === 'crypto') return require('node:crypto');
      if (id === '@/lib/meeraServer') return { createSupabaseAdminClient: () => db };
      if (id === 'next/server') return { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200, cookies: { values: [], set(...args) { this.values.push(args); } } }) } };
      throw Error(id);
    },
  });
  const request = {
    headers: { get: (key) => key === 'origin' ? 'https://www.himeera.com' : null },
    nextUrl: new URL('https://www.himeera.com/api/analytics/growth-links/capture'),
    cookies: { get: () => undefined },
    json: async () => ({ utm_source: 'instagram', utm_medium: 'paid_social', utm_campaign: 'US Meera Test' }),
  };
  const result = await POST(request);
  assert.equal(result.body.captured, true);
  assert.equal(writes, 1);
  assert.equal(result.cookies.values.find((c) => c[0] === 'meera_growth_link')[2].httpOnly, true);
  request.cookies.get = (key) => key === 'meera_growth_link' ? { value: 'original' } : undefined;
  assert.equal((await POST(request)).body.captured, true);
  assert.equal(writes, 1);
  request.headers.get = () => 'https://evil.example';
  assert.equal((await POST(request)).status, 403);
});

test('Meta commerce gate defaults off and produces deterministic, currency-specific events only for positive amounts', () => {
  const env = {};
  const { verifiedCommerceEvent } = load('src/lib/metaCommerce.ts', { process: { env } });
  assert.equal(verifiedCommerceEvent('Purchase', 'order-1', 99, 'USD'), null);
  env.META_COMMERCE_ENABLED = 'true';
  const first = verifiedCommerceEvent('Purchase', 'order-1', 99, 'USD');
  assert.equal(first.eventId, verifiedCommerceEvent('Purchase', 'order-1', 99, 'USD').eventId);
  assert.notEqual(first.eventId, verifiedCommerceEvent('InitiateCheckout', 'order-1', 99, 'USD').eventId);
  assert.equal(verifiedCommerceEvent('Purchase', 'order-1', 0, 'USD'), null);
  assert.equal(verifiedCommerceEvent('Purchase', 'order-1', 99, 'EUR'), null);
  assert.equal(JSON.stringify(first).includes('order-1'), false);
  assert.equal(first.countsOnly, true);
  assert.equal(first.value, undefined);
  env.META_COMMERCE_VALUE_ENABLED = 'true';
  assert.equal(verifiedCommerceEvent('Purchase', 'order-1', 99, 'USD').value, 99);
});

test('commerce endpoint never accepts another user, unpaid order, bypass coupon or client amount as a purchase', async () => {
  let auth = { ok: false, status: 401 };
  let payment = { order_id: 'order-1', payment_id: 'pay-1', amount: 499, currency: 'INR', payment_status: 'pending', coupon_code: null };
  let owned = true;
  const db = { from: (table) => ({ select: () => { const q = { eq: () => q, maybeSingle: async () => ({ data: table === 'users' ? { id: 'internal-user' } : owned ? payment : null, error: null }) }; return q; } }) };
  const { POST } = load('src/app/api/analytics/meta-commerce/route.ts', {
    process: { env: { META_COMMERCE_ENABLED: 'true', META_COMMERCE_VALUE_ENABLED: 'true' } },
    require: (id) => {
      if (id === '@/lib/meeraServer') return { requireAuthenticatedUser: async () => auth };
      if (id === '@/lib/metaCommerce') return load('src/lib/metaCommerce.ts', { process: { env: { META_COMMERCE_ENABLED: 'true', META_COMMERCE_VALUE_ENABLED: 'true' } } });
      if (id === 'next/server') return { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } };
      throw Error(id);
    },
  });
  const request = { json: async () => ({ order_id: 'order-1', event_name: 'Purchase', amount: 1, currency: 'USD', user_id: 'forged' }) };
  assert.equal((await POST(request)).status, 401);
  auth = { ok: true, user: { id: 'real-user' }, supabase: db };
  assert.equal((await POST(request)).body.event, null);
  payment.payment_status = 'paid';
  const result = await POST(request);
  assert.equal(result.body.event.value, 499);
  assert.equal(result.body.event.currency, 'INR');
  owned = false;
  assert.equal((await POST(request)).status, 404);
  owned = true; payment.coupon_code = 'BYPASS';
  assert.equal((await POST(request)).body.event, null);
  payment.coupon_code = null; payment.payment_status = 'refunded';
  assert.equal((await POST(request)).body.event, null);
});

test('returning sign-ins do not create campaign signup attributions', async () => {
  let writes = 0;
  const { POST } = load('src/app/api/analytics/growth-links/attribute/route.ts', {
    require: (id) => {
      if (id === '@/lib/meeraServer') return { requireAuthenticatedUser: async () => ({
        ok: true, user: { id: 'returning', created_at: '2025-01-01', last_sign_in_at: new Date().toISOString(), email_confirmed_at: '2025-01-01' },
        supabase: { from: () => { writes++; throw Error('Must not write'); } },
      }) };
      if (id === 'next/server') return { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } };
      throw Error(id);
    },
  });
  const result = await POST({});
  assert.equal(result.body.reason, 'not_new_registration');
  assert.equal(writes, 0);
});

test('public sign-in content renders while session restoration is pending', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const component = load('src/app/sign-in/page.tsx', {
    process: { env: { NEXT_PUBLIC_APP_NAME: 'Meera' } },
    require: (id) => {
      if (id === 'react') return { ...React, useState: (value) => [value, () => {}], useEffect: () => {}, useRef: () => ({ current: null }) };
      if (id === 'react/jsx-runtime') return require(id);
      if (id === 'next/navigation') return { useSearchParams: () => new URLSearchParams(), useRouter: () => ({ replace: () => {} }) };
      if (id === 'next/image') return { default: (props) => React.createElement('img', { src: props.src, alt: props.alt }) };
      if (id === 'next/link') return { default: ({ href, children, ...props }) => React.createElement('a', { href, ...props }, children) };
      if (id === '@/lib/utils') return { cn: (...args) => args.filter(Boolean).join(' ') };
      if (id === '@/lib/purchaseIntent') return load('src/lib/purchaseIntent.ts');
      if (id === 'react-icons/fc') return { FcGoogle: () => React.createElement('span') };
      if (id.startsWith('@/components/')) return new Proxy({}, { get: () => () => null });
      if (id.startsWith('@/lib/')) return {};
      throw Error(id);
    },
  }).default;
  const html = renderToStaticMarkup(React.createElement(component));
  assert.match(html, /Your personal/);
  assert.match(html, /companion\./);
  assert.match(html, /Talk to Meera/);
  assert.doesNotMatch(html, /animate-spin/);
});
