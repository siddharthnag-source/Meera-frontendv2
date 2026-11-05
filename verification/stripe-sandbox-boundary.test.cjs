const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const ref = 'wyitdnwftdxlibdnldfe';
function fixture(patch = {}) {
  const exports = {};
  const env = {
    VERCEL_ENV: 'production', MEERA_PAYMENT_MODE: 'sandbox',
    MEERA_STRIPE_SANDBOX_SUPABASE_REF: ref,
    SUPABASE_URL: `https://${ref}.supabase.co`, SUPABASE_SERVICE_ROLE_KEY: 'mock',
    STRIPE_SECRET_KEY: 'sk_test_mock', STRIPE_WEBHOOK_SECRET: 'whsec_mock', ...patch,
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/stripePayments.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, process: { env }, URL, Date, require: (id) => {
    if (id === '@supabase/supabase-js') return { createClient: () => { throw new Error('Unexpected database write'); } };
    return { default: class {} };
  } });
  return exports;
}
test('sandbox checkout accepts only test keys on the exact approved clean database', () => {
  assert.equal(fixture().stripeCheckoutReady(), true);
  assert.equal(fixture({ STRIPE_SECRET_KEY: 'sk_live_mock' }).stripeCheckoutReady(), false);
  assert.equal(fixture({ STRIPE_WEBHOOK_SECRET: '' }).stripeCheckoutReady(), false);
  for (const url of [
    `https://${ref}.supabase.co.evil.invalid`, `https://${ref}.supabase.co@evil.invalid`,
    `https://${ref}.supabase.co/path`, `https://${ref}.supabase.co?db=other`,
    `https://${ref}.supabase.co#other`, `http://${ref}.supabase.co`,
    'https://odeqnorudbdiuhweuoqv.supabase.co',
  ]) assert.equal(fixture({ SUPABASE_URL: url }).stripeCheckoutReady(), false, url);
  assert.equal(fixture({ MEERA_STRIPE_SANDBOX_SUPABASE_REF: 'xilapyewazpzlvqbbtgl', SUPABASE_URL: 'https://xilapyewazpzlvqbbtgl.supabase.co' }).stripeCheckoutReady(), false);
});
test('sandbox deployments reject real paid sessions before any database access', async () => {
  await assert.rejects(() => fixture().fulfillStripeSession({ payment_status: 'paid', livemode: true }), /cannot fulfill live/);
});
