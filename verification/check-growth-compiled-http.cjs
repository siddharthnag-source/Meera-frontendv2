const fs = require('node:fs');
const assert = require('node:assert/strict');
const origin = 'http://127.0.0.1:3218';
// This local instance deliberately has no privileged bindings. Authentication
// rejects checkout first; webhook configuration fails closed before processing.
const cases = [
  ['/sign-in?offer=us-lifetime', 'GET', 200],
  ['/payment?offer=us-lifetime', 'GET', 200],
  ['/api/payment/stripe/checkout', 'POST', 401],
  ['/api/payment/stripe/webhook', 'POST', 503],
  ['/api/payment/offer?offer=us-lifetime', 'GET', 200],
];
(async () => {
  const results = [];
  for (const [route, method, expected] of cases) {
    const response = await fetch(origin + route, {
      method, signal: AbortSignal.timeout(30000),
      ...(method === 'POST' ? { headers: { 'content-type': 'application/json' }, body: '{}' } : {}),
    });
    const body = await response.text();
    assert.equal(response.status, expected, route);
    if (route.startsWith('/sign-in')) {
      // This route hydrates its offer in the browser. HTTP verifies only the
      // compiled shell; do not mislabel it as visual checkout acceptance.
      assert.ok(body.includes('Meera'), 'Compiled sign-in metadata must exist');
      assert.ok(body.includes('/_next/static/'), 'Compiled client assets must be referenced');
    }
    results.push({ route, method, expected, actual: response.status, pass: true });
  }
  fs.mkdirSync('verification/growth-staging-evidence', { recursive: true });
  fs.writeFileSync('verification/growth-staging-evidence/compiled-http.json', JSON.stringify({
    timestamp: new Date().toISOString(), origin,
    bindings: 'clean synthetic public configuration only; privileged bindings intentionally absent',
    results, scope: 'Compiled HTTP behavior only; not OAuth, sandbox provider or entitlement acceptance',
  }, null, 2));
  console.log('PASS 5 compiled HTTP cases: offer pages, offer API, checkout authentication and unconfigured webhook rejection.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
