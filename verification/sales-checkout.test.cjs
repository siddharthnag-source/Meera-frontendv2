const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function checkoutRoute({ authenticated = true, alreadyPaid = false } = {}) {
  const calls = [];
  const query = { select() { return this; }, eq() { return this; }, in() { return this; },
    async limit() { return { data: alreadyPaid ? [{ payment_id: 'existing' }] : [], error: null }; } };
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync('src/app/api/payment/stripe/checkout/route.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { exports, console, process: { env: { VERCEL_ENV: 'production' } }, require(id) {
    if (id === 'next/server') return { NextResponse: { json(body, options = {}) { return { body, status: options.status || 200 }; } } };
    if (id === '@/lib/metaCommerce') return { verifiedCommerceEvent: () => null };
    if (id === '@/lib/stripePayments') return {
      STRIPE_LIFETIME_AMOUNT: 9900, stripeCheckoutReady: () => true,
      paymentIdentity: async () => authenticated ? {
        user: { id: 'verified-auth-user', email: 'qa@example.invalid' }, publicUserId: 'verified-profile', db: { from: () => query },
      } : null,
      getStripe: () => ({ checkout: { sessions: { create: async (params, options) => {
        // Mirror the live Managed Payments rejection that blocked every USD checkout.
        assert.equal('custom_text' in params, false, 'Managed Payments rejects custom_text');
        calls.push({ params, options });
        return { id: 'cs_qa', url: 'https://checkout.stripe.com/qa' };
      } } } }),
    };
    throw new Error(`Unexpected dependency: ${id}`);
  } });
  return { POST: exports.POST, calls };
}

const request = (key = 'qa-request-20261025') => ({
  headers: { get: (name) => name === 'idempotency-key' ? key : null },
  nextUrl: new URL('https://untrusted-preview.invalid/api/payment/stripe/checkout'),
});

test('USD checkout works with Managed Payments, fixed price and verified ownership', async () => {
  const route = checkoutRoute();
  const result = await route.POST(request());
  assert.equal(result.status, 200);
  assert.equal(result.body.url, 'https://checkout.stripe.com/qa');
  const { params, options } = route.calls[0];
  assert.equal(params.mode, 'payment');
  assert.equal(params.line_items[0].price_data.unit_amount, 9900);
  assert.equal(params.line_items[0].price_data.currency, 'usd');
  assert.equal(params.line_items[0].price_data.tax_behavior, 'inclusive');
  assert.equal(params.client_reference_id, 'verified-auth-user');
  assert.equal(params.metadata.public_user_id, 'verified-profile');
  assert.equal(params.integration_identifier, 'meera_lifetime_kqpmzvra');
  assert.equal(params.success_url, 'https://www.himeera.com/payment?checkout_session_id={CHECKOUT_SESSION_ID}');
  assert.equal(options.idempotencyKey, 'meera-lifetime-verified-auth-user-qa-request-20261025');
});

test('unauthenticated, already-paid and invalid-key requests never create checkout sessions', async () => {
  for (const [settings, key, expected] of [
    [{ authenticated: false }, 'qa-request-20261025', 401],
    [{ alreadyPaid: true }, 'qa-request-20261025', 409],
    [{}, 'bad', 400],
  ]) {
    const route = checkoutRoute(settings);
    assert.equal((await route.POST(request(key))).status, expected);
    assert.equal(route.calls.length, 0);
  }
});
