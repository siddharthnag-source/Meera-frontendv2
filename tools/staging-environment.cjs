'use strict';

const STAGING_REF = 'wyitdnwftdxlibdnldfe';
const STAGING_URL = `https://${STAGING_REF}.supabase.co`;
const CONFIG_KEYS = new Set([
  'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET',
  'NEXT_PUBLIC_BACKEND_URL', 'NEXT_PUBLIC_APP_NAME', 'MEERA_PAYMENT_MODE',
  'MEERA_STRIPE_SANDBOX_SUPABASE_REF', 'META_COMMERCE_ENABLED',
  'META_COMMERCE_VALUE_ENABLED', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
  'STRIPE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
]);

function jwtClaims(key, name) {
  try {
    return JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
  } catch {
    throw new Error(`${name}: use the approved staging project's legacy JWT key; no value was logged.`);
  }
}

function validateConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Staging config must be a JSON object.');
  for (const [name, value] of Object.entries(config)) {
    if (!CONFIG_KEYS.has(name)) throw new Error(`Unsupported staging setting: ${name}`);
    if (typeof value !== 'string') throw new Error(`${name} must be a string.`);
  }
  for (const name of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL']) {
    if ((name === 'NEXT_PUBLIC_SUPABASE_URL' || config[name]) && config[name] !== STAGING_URL) {
      throw new Error(`${name} must be the approved clean staging URL.`);
    }
  }
  for (const [name, role, required] of [
    ['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon', true],
    ['SUPABASE_SERVICE_ROLE_KEY', 'service_role', false],
  ]) {
    const key = config[name];
    if (!key && !required) continue;
    if (!key) throw new Error(`${name} is missing. Obtain it from clean Meera Growth Staging only.`);
    const claims = jwtClaims(key, name);
    if (claims.ref !== STAGING_REF || claims.role !== role) throw new Error(`${name} belongs to the wrong project or role.`);
  }
  if (config.MEERA_PAYMENT_MODE && config.MEERA_PAYMENT_MODE !== 'sandbox') throw new Error('Only sandbox payments are allowed.');
  if (config.MEERA_STRIPE_SANDBOX_SUPABASE_REF && config.MEERA_STRIPE_SANDBOX_SUPABASE_REF !== STAGING_REF) {
    throw new Error('The sandbox database reference must match clean staging.');
  }
  for (const name of ['META_COMMERCE_ENABLED', 'META_COMMERCE_VALUE_ENABLED']) {
    if (config[name] && config[name] !== 'false') throw new Error('Staging must not send production commerce events.');
  }
  if (config.STRIPE_SECRET_KEY && !/^(sk|rk)_test_/.test(config.STRIPE_SECRET_KEY)) throw new Error('Stripe must use a test secret key.');
  for (const name of ['STRIPE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY']) {
    if (config[name] && !/^pk_test_/.test(config[name])) throw new Error(`${name} must be a Stripe test publishable key.`);
  }
  if (config.STRIPE_WEBHOOK_SECRET && !config.STRIPE_WEBHOOK_SECRET.startsWith('whsec_')) throw new Error('Invalid sandbox webhook secret format.');
  if (config.STRIPE_SECRET_KEY || config.STRIPE_WEBHOOK_SECRET) {
    if (!config.STRIPE_SECRET_KEY || !config.STRIPE_WEBHOOK_SECRET || !config.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Sandbox payments require a test key, webhook secret and clean staging service-role key together.');
    }
  }
  if (config.NEXT_PUBLIC_BACKEND_URL) {
    let url;
    try { url = new URL(config.NEXT_PUBLIC_BACKEND_URL); } catch { throw new Error('The optional backend must use a local loopback URL.'); }
    if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
        url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      throw new Error('The optional backend must use a local loopback URL without credentials or a path.');
    }
  }
  return {
    database: STAGING_REF,
    frontend: 'READY',
    privilegedStagingBackend: config.SUPABASE_SERVICE_ROLE_KEY ? 'CONFIGURED' : 'BLOCKED: staging service-role key needed',
    sandboxPayments: config.STRIPE_SECRET_KEY && config.STRIPE_WEBHOOK_SECRET ? 'CONFIGURED: provider acceptance still required' : 'BLOCKED: own sandbox credentials needed',
    ai: 'OFF',
    productionCredentials: 'EXCLUDED',
  };
}

function buildChildEnvironment(config, inherited = process.env, dotenvNames = [], port = 3218) {
  validateConfig(config);
  const env = {};
  // Preserve OS/runtime plumbing only. Never inherit service credentials or Vercel tokens.
  const osNames = /^(path|pathext|systemroot|windir|comspec|temp|tmp|home|userprofile|appdata|localappdata|programfiles(?:\(x86\))?|programdata|number_of_processors|processor_architecture|lang|lc_.*|tz|term|colorterm|no_color|ci)$/i;
  for (const [name, value] of Object.entries(inherited)) if (osNames.test(name) && value !== undefined) env[name] = value;
  // Next loads .env files itself. Explicit empty bindings stop production .env.local fallback.
  for (const name of dotenvNames) if (!osNames.test(name)) env[name] = '';
  for (const name of [
    'SUPABASE_SERVICE_ROLE_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_MCP_KEY',
    'STRIPE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_CASHFREE_APP_ID',
    'NEXT_PUBLIC_GEMINI_API_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'NEXTAUTH_SECRET',
    'SLACK_SUCCESS_LOG_WEBHOOK_URL', 'SLACK_ERROR_LOG_WEBHOOK_URL', 'VERCEL_OIDC_TOKEN', 'VERCEL_TOKEN',
    'DATABASE_URL', 'SUPABASE_DB_PASSWORD',
  ]) env[name] = '';
  Object.assign(env, config, {
    SUPABASE_URL: STAGING_URL, SUPABASE_ANON_KEY: config.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SUPABASE_CHAT_URL: STAGING_URL,
    NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET: config.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET || 'arya-staging',
    NEXT_PUBLIC_APP_NAME: config.NEXT_PUBLIC_APP_NAME || 'Meera Staging',
    NEXT_PUBLIC_BACKEND_URL: config.NEXT_PUBLIC_BACKEND_URL || '',
    MEERA_DEPLOYMENT_SCOPE: 'staging', MEERA_PAYMENT_MODE: 'sandbox',
    MEERA_STRIPE_SANDBOX_SUPABASE_REF: STAGING_REF,
    META_COMMERCE_ENABLED: 'false', META_COMMERCE_VALUE_ENABLED: 'false',
    NEXT_PUBLIC_META_PIXEL_ENABLED: 'false', NEXT_PUBLIC_AGENTIC_TEXT_ENABLED: 'false',
    NEXT_PUBLIC_CASHFREE_MODE: 'sandbox', NEXTAUTH_URL: `http://localhost:${port}`,
    NEXTAUTH_CALLBACK_URL: `http://localhost:${port}/api/auth/callback/google`,
    MEERA_BUILD_DIR: '.next-growth-arya', MEERA_BUILD_CPUS: '2', NEXT_TELEMETRY_DISABLED: '1',
    VERCEL_ENV: 'development',
  });
  return env;
}

module.exports = { STAGING_REF, STAGING_URL, validateConfig, buildChildEnvironment };
