'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { validateConfig, buildChildEnvironment } = require('./staging-environment.cjs');
const root = path.resolve(__dirname, '..');

function main(args) {
  const command = args.shift() || 'check';
  if (!['check', 'dev', 'build', 'start'].includes(command)) throw new Error('Use check, dev, build or start.');
  let configPath = path.join(root, '.env.arya-staging.local');
  let port = 3218;
  while (args.length) {
    const flag = args.shift();
    if (flag === '--config' && args.length) configPath = path.resolve(root, args.shift());
    else if (flag === '--port' && args.length) port = Number(args.shift());
    else throw new Error('Unknown argument. Supported: --config <JSON file> --port <local port>.');
  }
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Choose a port between 1024 and 65535.');
  if (!fs.existsSync(configPath)) throw new Error('Missing local staging config. Copy docs/ARYA_STAGING_CONFIG.example.json to .env.arya-staging.local and add clean staging credentials.');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const report = validateConfig(config);
  console.log(JSON.stringify(report, null, 2));
  if (command === 'check') return 0;
  if (['build', 'start'].includes(command) && !config.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Full build/start requires the clean staging service-role key because server routes initialize database clients. Use dev for public frontend work; never substitute a production key.');
  }
  const dotenvNames = new Set();
  for (const name of fs.readdirSync(root).filter(name => name === '.env' || name.startsWith('.env.'))) {
    const file = path.join(root, name);
    if (!fs.statSync(file).isFile()) continue;
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)) dotenvNames.add(match[1]);
  }
  const env = buildChildEnvironment(config, process.env, [...dotenvNames], port);
  const nextArgs = [path.join(root, 'node_modules/next/dist/bin/next'), command];
  if (command !== 'build') nextArgs.push('--hostname', '127.0.0.1', '--port', String(port));
  console.log(`Isolated ${command}: clean staging only. No Vercel login, deployment or billable AI is started.`);
  const result = spawnSync(process.execPath, nextArgs, { cwd: root, env, stdio: 'inherit', shell: false });
  if (result.error) throw new Error('Could not start Next.js. Install existing package-lock dependencies with npm ci.');
  return result.status ?? 1;
}

try { process.exitCode = main(process.argv.slice(2)); }
catch (error) { console.error(error.message); process.exitCode = 1; }
