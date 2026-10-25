import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const base = process.env.MARKETING_TEST_URL;
if (!base || !/^https:\/\/[a-z0-9.-]+$/.test(base)) throw Error('Set MARKETING_TEST_URL to the exact deployment origin');
const cli = process.env.VERCEL_CLI_PATH;
if (!cli) throw Error('Set VERCEL_CLI_PATH to the installed Vercel CLI JavaScript entrypoint');
const jar = '.vercel/marketing-qa-cookies.txt';
const results = [];
function request(path, flags = []) {
  const raw = execFileSync(process.execPath, [cli, 'curl', path, '--deployment', base, '--',
    '--silent', '--show-error', '--include', '--max-time', '45', ...flags], { encoding: 'utf8', maxBuffer: 2_000_000 });
  const blocks = raw.split(/\r?\n\r?\n/);
  const headers = blocks.findLast((block) => /^HTTP\/\S+ \d+/.test(block));
  if (!headers) throw Error('No HTTP response');
  const status = Number(headers.match(/^HTTP\/\S+ (\d+)/)[1]);
  return { status, headers, body: blocks.slice(blocks.lastIndexOf(headers) + 1).join('\n\n') };
}
function check(label, path, status, flags = [], inspect = () => {}) {
  const result = request(path, flags);
  assert.equal(result.status, status, `${label}: HTTP status`);
  inspect(result);
  results.push({ check: label, status: 'passed', http: result.status });
  console.log('PASS', label);
  return result;
}
const json = (value) => ['--request', 'POST', '--header', 'Content-Type: application/json', '--data-raw', JSON.stringify(value)];
check('homepage serves', '/', 200);
check('sign-in serves with canonical URL and accessible viewport', '/sign-in', 200, [], (result) => {
  assert.match(result.body, /rel="canonical"[^>]+href="https:\/\/www\.himeera\.com\/sign-in"/);
  assert.match(result.body, /maximum-scale=5/);
  assert.match(result.body, /user-scalable=yes/);
});
check('pricing serves', '/pricing', 200);
check('regional payment offer serves', '/api/payment/offer', 200);
check('registration requires authentication', '/api/analytics/meta-registration', 401, ['--request', 'POST']);
check('commerce requires authentication', '/api/analytics/meta-commerce', 401, json({ order_id: 'qa-forged', event_name: 'Purchase', amount: 99 }));
check('forged paywall identity rejected', '/api/analytics/track', 401, json({ event_name: 'payment_page_opened', user_id: 'forged' }));
check('growth attribution requires authentication', '/api/analytics/growth-links/attribute', 401, ['--request', 'POST']);
check('Stripe checkout requires authentication', '/api/payment/stripe/checkout', 401, ['--request', 'POST']);
check('unsigned Stripe webhook rejected', '/api/payment/stripe/webhook', 400, json({}));
const touch = { utm_source: 'internal_qa', utm_medium: 'qa', utm_campaign: 'ads_integration_20261025' };
check('cross-origin capture rejected', '/api/analytics/growth-links/capture', 403, [...json(touch), '--header', 'Origin: https://example.invalid']);
check('direct UTM capture stores first-party cookies', '/api/analytics/growth-links/capture', 200,
  [...json(touch), '--header', `Origin: ${base}`, '--cookie-jar', jar], (result) => {
    assert.equal(JSON.parse(result.body).captured, true);
    assert.match(result.headers, /set-cookie: meera_growth_link=/i);
    assert.match(result.headers, /httponly/i);
    assert.match(result.headers, /cache-control: private, no-store/i);
  });
check('returning capture retains first touch', '/api/analytics/growth-links/capture', 200,
  [...json({ utm_source: 'meta', utm_medium: 'paid_social', utm_campaign: 'us_lifetime_99_oct2026' }),
    '--header', `Origin: ${base}`, '--cookie', jar], (result) => {
    assert.equal(JSON.parse(result.body).captured, true);
    assert.doesNotMatch(result.headers, /set-cookie: meera_growth_link=/i);
  });
check('growth redirect retains Meta click ID and creative', '/r/internal-qa-ads-integration-20261025?fbclid=QA_HTTP_ONLY_123&utm_content=Creative+A', 307,
  ['--cookie', jar], (result) => {
    const location = result.headers.match(/^location: (.+)$/im)?.[1]?.trim();
    assert.ok(location);
    const url = new URL(location);
    assert.equal(url.searchParams.get('fbclid'), 'QA_HTTP_ONLY_123');
    assert.equal(url.searchParams.get('utm_content'), 'Creative A');
    assert.equal(url.searchParams.get('utm_source'), 'internal_qa');
    assert.equal(url.pathname, '/sign-in');
  });
fs.writeFileSync('verification/marketing-release-check-results.json', JSON.stringify({
  deployment: base, checkedAt: new Date().toISOString(), checks: results,
  note: 'HTTP-only QA traffic used the internal_qa campaign. No signup, Meta event or payment was fabricated.',
}, null, 2));
