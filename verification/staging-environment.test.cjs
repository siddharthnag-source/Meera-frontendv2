const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { STAGING_REF, STAGING_URL, validateConfig, buildChildEnvironment } = require('../tools/staging-environment.cjs');
const jwt = (ref, role) => `fixture.${Buffer.from(JSON.stringify({ ref, role })).toString('base64url')}.fixture`;
const config = patch => ({ NEXT_PUBLIC_SUPABASE_URL: STAGING_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt(STAGING_REF, 'anon'), ...patch });

test('public-only staging config is usable without pretending payment or admin access is ready', () => {
  const result = validateConfig(config());
  assert.equal(result.frontend, 'READY');
  assert.match(result.sandboxPayments, /^BLOCKED/);
  assert.match(result.privilegedStagingBackend, /^BLOCKED/);
});
test('rejects production and deceptive database URLs and cross-project keys', () => {
  for (const url of ['https://production-ref.supabase.co', `${STAGING_URL}.evil.invalid`, `${STAGING_URL}/path`, `${STAGING_URL}?other=1`]) {
    assert.throws(() => validateConfig(config({ NEXT_PUBLIC_SUPABASE_URL: url })), /clean staging/);
  }
  assert.throws(() => validateConfig(config({ SUPABASE_URL: 'https://other.invalid' })), /clean staging/);
  assert.throws(() => validateConfig(config({ NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt('production-ref', 'anon') })), /wrong project/);
  assert.throws(() => validateConfig(config({ SUPABASE_SERVICE_ROLE_KEY: jwt('production-ref', 'service_role') })), /wrong project/);
  assert.throws(() => validateConfig(config({ NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt(STAGING_REF, 'service_role') })), /wrong project or role/);
});
test('rejects live payment bindings, partial checkout setup and production analytics', () => {
  for (const patch of [
    { STRIPE_SECRET_KEY: 'sk_live_fixture' }, { STRIPE_PUBLISHABLE_KEY: 'pk_live_fixture' },
    { MEERA_PAYMENT_MODE: 'live' }, { META_COMMERCE_ENABLED: 'true' },
    { META_COMMERCE_VALUE_ENABLED: 'true' }, { STRIPE_SECRET_KEY: 'sk_test_fixture' },
  ]) assert.throws(() => validateConfig(config(patch)));
  assert.doesNotThrow(() => validateConfig(config({ SUPABASE_SERVICE_ROLE_KEY: jwt(STAGING_REF, 'service_role'), STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture' })));
});
test('rejects hosted backend targets and unsupported credential injection', () => {
  for (const url of ['https://api.himeera.com', 'http://localhost.evil.invalid', 'http://user@localhost:8000', 'http://localhost:8000/path']) {
    assert.throws(() => validateConfig(config({ NEXT_PUBLIC_BACKEND_URL: url })), /local loopback/);
  }
  assert.doesNotThrow(() => validateConfig(config({ NEXT_PUBLIC_BACKEND_URL: 'http://127.0.0.1:8000' })));
  for (const name of ['VERCEL_TOKEN', 'DATABASE_URL', 'NEXT_PUBLIC_GEMINI_API_KEY', 'GOOGLE_CLIENT_SECRET']) {
    assert.throws(() => validateConfig(config({ [name]: 'private-fixture' })), /Unsupported staging setting/);
  }
});
test('scrubs inherited and dotenv production credentials before Next loads local env files', () => {
  const env = buildChildEnvironment(config(), {
    PATH: '/node', SystemRoot: 'C:/Windows', SUPABASE_SERVICE_ROLE_KEY: 'production-fixture',
    STRIPE_SECRET_KEY: 'sk_live_fixture', VERCEL_OIDC_TOKEN: 'owner-fixture', VERCEL_TOKEN: 'owner-fixture',
    ARBITRARY_SECRET: 'private-fixture', DATABASE_URL: 'postgres://production-fixture',
  }, ['UNKNOWN_DOTENV_SECRET', 'NEXT_PUBLIC_SUPABASE_CHAT_URL', 'NEXT_PUBLIC_GEMINI_API_KEY'], 3220);
  assert.equal(env.PATH, '/node');
  assert.equal(env.SystemRoot, 'C:/Windows');
  for (const name of ['SUPABASE_SERVICE_ROLE_KEY', 'STRIPE_SECRET_KEY', 'VERCEL_OIDC_TOKEN', 'VERCEL_TOKEN', 'DATABASE_URL', 'UNKNOWN_DOTENV_SECRET', 'NEXT_PUBLIC_GEMINI_API_KEY']) assert.equal(env[name], '');
  assert.equal(env.ARBITRARY_SECRET, undefined);
  assert.equal(env.NEXT_PUBLIC_SUPABASE_CHAT_URL, STAGING_URL);
  assert.equal(env.NEXTAUTH_URL, 'http://localhost:3220');
  assert.equal(env.NEXT_PUBLIC_META_PIXEL_ENABLED, 'false');
  assert.equal(env.NEXT_PUBLIC_AGENTIC_TEXT_ENABLED, 'false');
});

test('launcher validates public setup but refuses full builds without clean privileged credentials', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arya-staging-'));
  const file = path.join(dir, 'config.json');
  try {
    const fixture = config();
    fs.writeFileSync(file, JSON.stringify(fixture));
    const runner = path.resolve(__dirname, '../tools/run-arya-staging.cjs');
    const checked = spawnSync(process.execPath, [runner, 'check', '--config', file], { encoding: 'utf8' });
    assert.equal(checked.status, 0, checked.stderr);
    assert.ok(!checked.stdout.includes(fixture.NEXT_PUBLIC_SUPABASE_ANON_KEY));
    const built = spawnSync(process.execPath, [runner, 'build', '--config', file], { encoding: 'utf8' });
    assert.equal(built.status, 1);
    assert.match(built.stderr, /requires the clean staging service-role key/);
    assert.ok(!built.stdout.includes('Isolated build:'));
  } finally {
    fs.unlinkSync(file);
    fs.rmdirSync(dir);
  }
});
