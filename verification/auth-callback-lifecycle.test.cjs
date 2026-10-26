const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function fixture() {
  const pending = [], cleanups = [], navigations = [];
  const location = { pathname: '/auth/callback', search: '', hash: '' };
  let consumes = 0;
  const exports = {};
  const imports = {
    react: { useEffect: (effect) => cleanups.push(effect()) },
    'react/jsx-runtime': { jsx: () => null, jsxs: () => null },
    'next/navigation': { useRouter: () => ({ replace: (target) => navigations.push(target) }) },
    '@/lib/supabaseClient': { supabase: { auth: { getSession: () => new Promise(resolve => pending.push(resolve)) } } },
    '@/lib/auth/startGoogleAgentConnection': { finishGoogleAgentConnection: async () => null },
    '@/lib/authRedirect': { clearAuthRedirectTrace() {}, clearGuestTokenState() {}, logAuthRedirectEvent() {} },
    '@/lib/marketingEvents': { queueMarketingEvent() {} },
    '@/lib/captureMarketingTouch': { captureMarketingTouch: async () => {} },
    '@/lib/purchaseIntent': { consumePurchaseIntent: () => ++consumes === 1 ? '/payment?offer=us-lifetime' : null, US_SIGN_IN_PATH: '/sign-in?offer=us-lifetime' },
  };
  const source = ts.transpileModule(fs.readFileSync('src/app/auth/callback/page.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, {
    exports, require: id => { if (!(id in imports)) throw Error(id); return imports[id]; },
    window: { location }, URLSearchParams, AbortSignal, console,
    fetch: async () => ({ ok: false }),
  });
  const session = { data: { session: { access_token: 'synthetic' } }, error: null };
  return { mount: () => exports.default(), pending, cleanups, navigations, location, session, consumes: () => consumes };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('an obsolete OAuth mount cannot consume intent or redirect after the current mount', async () => {
  const f = fixture();
  f.mount(); f.cleanups[0](); f.mount();
  f.pending[1](f.session); await settle();
  f.pending[0](f.session); await settle();
  assert.deepEqual(f.navigations, ['/payment?offer=us-lifetime']);
  assert.equal(f.consumes(), 1);
});

test('a late OAuth result cannot redirect a page already showing the payment offer', async () => {
  const f = fixture(); f.mount();
  f.location.pathname = '/payment';
  f.pending[0](f.session); await settle();
  assert.deepEqual(f.navigations, []);
  assert.equal(f.consumes(), 0);
});

test('the active callback still preserves the explicit US offer on success and auth failure', async () => {
  for (const authenticated of [true, false]) {
    const f = fixture(); f.mount();
    f.pending[0](authenticated ? f.session : { data: { session: null }, error: null });
    await settle();
    assert.deepEqual(f.navigations, [authenticated ? '/payment?offer=us-lifetime' : '/sign-in?offer=us-lifetime&auth_error=google']);
  }
});
