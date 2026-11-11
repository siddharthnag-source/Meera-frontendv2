// Compile with real public keys from the approved empty synthetic project.
// This is not a server-authentication or payment acceptance check.
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const config = JSON.parse(fs.readFileSync('.env.growth-staging.local', 'utf8'));
const projectRef = 'wyitdnwftdxlibdnldfe';
const claims = JSON.parse(Buffer.from(config.NEXT_PUBLIC_SUPABASE_ANON_KEY.split('.')[1], 'base64url'));
if (config.NEXT_PUBLIC_SUPABASE_URL !== `https://${projectRef}.supabase.co` || claims.ref !== projectRef || claims.role !== 'anon') {
  throw new Error('Only the approved clean staging public configuration is allowed');
}
const env = { ...process.env, ...config,
  SUPABASE_URL: config.NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_ANON_KEY: config.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: '', STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '',
  GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', NEXTAUTH_SECRET: '',
  NEXTAUTH_URL: 'http://127.0.0.1:3000',
  NEXT_PUBLIC_CASHFREE_MODE: 'sandbox', NEXT_PUBLIC_GEMINI_API_KEY: '',
  SLACK_SUCCESS_LOG_WEBHOOK_URL: '', SLACK_ERROR_LOG_WEBHOOK_URL: '',
  MEERA_BUILD_DIR: '.next-growth-synthetic', MEERA_BUILD_CPUS: '2',
  NEXT_TELEMETRY_DISABLED: '1',
};
console.log('Building with clean synthetic public configuration; privileged bindings excluded.');
const args = process.argv.includes('--serve')
  ? ['start', '--hostname', '127.0.0.1', '--port', '3218']
  : ['build'];
const result = spawnSync(process.execPath, ['node_modules/next/dist/bin/next', ...args], { cwd: process.cwd(), env, stdio: 'inherit' });
process.exit(result.status ?? 1);
