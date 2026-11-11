const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const localRequire = (id) => {
    if (id === './marketingAttribution') return load('src/lib/marketingAttribution.ts');
    if (globals.require) return globals.require(id);
    return require(id);
  };
  vm.runInNewContext(code, { exports, URLSearchParams, process: { env: {} }, ...globals, require: localRequire });
  return exports;
}

const { isNewRegistration } = load('src/lib/marketingRegistration.ts');
const now = Date.parse('2026-10-23T10:00:00Z');
const fresh = {
  created_at: new Date(now - 10000).toISOString(),
  last_sign_in_at: new Date(now - 9000).toISOString(),
  email_confirmed_at: new Date(now - 9000).toISOString(),
};

test('new confirmed accounts qualify; returning, anonymous and unverified accounts do not', () => {
  assert.equal(isNewRegistration(fresh, now), true);
  assert.equal(isNewRegistration({ ...fresh, created_at: '2025-01-01T00:00:00Z' }, now), false);
  assert.equal(isNewRegistration({ ...fresh, is_anonymous: true }, now), false);
  assert.equal(isNewRegistration({ ...fresh, email_confirmed_at: null }, now), false);
  assert.equal(isNewRegistration({ ...fresh, created_at: 'bad-date' }, now), false);
  assert.equal(isNewRegistration({ ...fresh, created_at: new Date(now + 1000).toISOString() }, now), false);
  assert.equal(isNewRegistration({ ...fresh, last_sign_in_at: undefined }, now), false);
  assert.equal(isNewRegistration({ ...fresh, created_at: new Date(now - 180000).toISOString() }, now), false);
});

test('public marketing URLs work; private routes and sensitive query values are excluded', () => {
  const { isMarketingPage } = load('src/lib/metaPixel.ts');
  assert.equal(isMarketingPage('/', '?utm_source=instagram&utm_campaign=us_meera_intro', ''), true);
  assert.equal(isMarketingPage('/sign-in', '', ''), true);
  for (const [path, search, hash] of [
    ['/auth/callback', '', '#access_token=secret'],
    ['/analytics/users', '', ''],
    ['/', '?conversation_id=private', ''],
    ['/', '?utm_campaign=user%40example.com', ''],
    ['/', '?email=user%40example.com', ''],
    ['/', '', '#access_token=secret'],
  ]) assert.equal(isMarketingPage(path, search, hash), false);
});

test('staging pixel switch excludes every marketing page and purchase event dispatch', () => {
  const { isMarketingPage } = load('src/lib/metaPixel.ts', { process: { env: { NEXT_PUBLIC_META_PIXEL_ENABLED: 'false' } } });
  assert.equal(isMarketingPage('/', '', ''), false);
  assert.equal(isMarketingPage('/payment', '?offer=us-lifetime', ''), false);
});

test('initializes only the company pixel, once, without advanced matching fields', () => {
  const scripts = [];
  const window = {};
  const { initializeMetaPixel, META_PIXEL_ID } = load('src/lib/metaPixel.ts', {
    window,
    document: { querySelector: () => scripts[0] ?? null, createElement: () => ({}), head: { appendChild: (script) => scripts.push(script) } },
  });
  initializeMetaPixel();
  initializeMetaPixel();
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].src, 'https://connect.facebook.net/en_US/fbevents.js');
  assert.deepEqual(JSON.parse(JSON.stringify(window.fbq.queue)), [
    ['set', 'autoConfig', false, META_PIXEL_ID], ['init', META_PIXEL_ID],
  ]);
  assert.equal(META_PIXEL_ID, '933654956266333');
});

test('protected page sends nothing; strict-mode effect replay does not duplicate page view', () => {
  const calls = [];
  const storage = new Map([['meera:meta-registration:v1', '11111111-1111-4111-8111-111111111111']]);
  const ref = { current: null };
  let effect;
  let path = '/auth/callback';
  const location = { search: '', hash: '#access_token=private' };
  const fakePixel = (...args) => calls.push(args);
  const meta = load('src/lib/metaPixel.ts');
  const registration = load('src/lib/marketingRegistration.ts');
  const component = load('src/components/MetaPixel.tsx', {
    window: { location, addEventListener: () => {}, removeEventListener: () => {} },
    sessionStorage: { getItem: (key) => storage.get(key), removeItem: (key) => storage.delete(key) },
    require: (id) => {
      if (id === 'react') return { useEffect: (fn) => { effect = fn; }, useRef: () => ref };
      if (id === 'next/navigation') return { usePathname: () => path, useSearchParams: () => new URLSearchParams() };
      if (id === '@/lib/metaPixel') return { ...meta, initializeMetaPixel: () => fakePixel };
      if (id === '@/lib/marketingRegistration') return registration;
      if (id === '@/lib/captureMarketingTouch') return { captureMarketingTouch: async () => {} };
      if (id === '@/lib/marketingEvents') return { dispatchPendingMarketingEvents: () => {}, queueMarketingEvent: () => {} };
      throw new Error(id);
    },
    setInterval: () => 1, clearInterval: () => {}, AbortController,
  }).default;
  location.pathname = path;
  component(); effect();
  assert.equal(calls.length, 0);
  path = '/'; location.hash = '';
  component(); effect(); effect();
  assert.equal(calls.filter((x) => x[2] === 'PageView').length, 1);
  assert.equal(calls.filter((x) => x[2] === 'CompleteRegistration').length, 0);
  assert.equal(storage.size, 1);
  assert.equal(JSON.stringify(calls).includes('private'), false);
});

test('signup endpoint authenticates, rejects returning users, and returns only an opaque event ID', async () => {
  let auth = { ok: false, status: 401 };
  let claimed = false;
  const writes = [];
  const database = {
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ single: async () => ({ data: { id: '11111111-1111-4111-8111-111111111111' }, error: null }) }) }) }), insert: (record) => {
      writes.push(record);
      return { select: () => ({ single: async () => {
        if (claimed) return { data: null, error: { code: '23505' } };
        claimed = true;
        return { data: { id: '11111111-1111-4111-8111-111111111111' }, error: null };
      } }) };
    } }),
  };
  const { POST } = load('src/app/api/analytics/meta-registration/route.ts', {
    require: (id) => {
      if (id === '@/lib/marketingRegistration') return { isNewRegistration: (user) => isNewRegistration(user, now) };
      if (id === '@/lib/meeraServer') return { requireAuthenticatedUser: async () => auth };
      if (id === 'next/server') return { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } };
      throw new Error(id);
    },
  });
  assert.equal((await POST({})).status, 401);
  auth = { ok: true, user: { ...fresh, id: 'real-auth-id', created_at: '2025-01-01T00:00:00Z' }, supabase: database };
  assert.equal((await POST({})).body.eligible, false);
  assert.equal(writes.length, 0);
  auth.user = { ...fresh, id: 'real-auth-id' };
  const first = await POST({ json: () => ({ user_id: 'forged-id' }) });
  assert.equal(first.body.eligible, true);
  assert.equal(JSON.stringify(first.body).includes('real-auth-id'), false);
  assert.equal(writes[0].user_id, 'real-auth-id');
  const retry = await POST({});
  assert.equal(retry.body.eligible, true);
  assert.equal(retry.body.eventId, first.body.eventId);
});
