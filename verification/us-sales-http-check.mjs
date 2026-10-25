import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const project = JSON.parse(fs.readFileSync('.vercel/project.json', 'utf8'));
assert.equal(project.projectId, 'prj_vcwkcVasl0IHsZaNuCqNF362AN5Y');
assert.equal(project.orgId, 'team_GElsejSOv3JCiuXlZNgvnGT5');
assert.equal(project.projectName, 'meera-frontendv2');
assert.ok(process.cwd().endsWith('_deploy_meera_frontend'));
const origin = process.argv[2];
assert.ok(origin?.startsWith('https://'));
const cases = [
  ['/api/payment/stripe/checkout', { method: 'POST' }, 401],
  ['/api/payment/stripe/webhook', { method: 'POST', body: '{}' }, 400],
  ['/payment?offer=us-lifetime', {}, 200],
  ['/sign-in?offer=us-lifetime', {}, 200],
];
for (const [path, options, status] of cases) {
  if (process.argv[3] && path !== process.argv[3]) continue;
  const cli = 'C:/Users/siddh/AppData/Local/npm-cache/_npx/ce54f19f4dbd7608/node_modules/vercel/dist/index.js';
  const flags = options.method ? ['--request', options.method] : [];
  if (options.body) flags.push('--data-raw', options.body);
  const raw = execFileSync(process.execPath, [cli, 'curl', path, '--deployment', origin, '--', '--silent', '--show-error', '--include', '--max-time', '45', ...flags], { encoding: 'utf8', timeout: 90000, maxBuffer: 2000000 });
  const blocks = raw.split(/\r?\n\r?\n/);
  const headers = blocks.findLast(block => /^HTTP\/\S+ \d+/.test(block));
  assert.ok(headers, 'HTTP headers required');
  assert.equal(Number(headers.match(/^HTTP\/\S+ (\d+)/)[1]), status, path);
  const body = blocks.slice(blocks.lastIndexOf(headers) + 1).join('\n\n');
  // Query-specific offer copy is rendered after hydration; verify it in the browser.
  if (path.startsWith('/sign-in')) assert.match(body, /https:\/\/www\.himeera\.com\/sign-in/);
  console.log(`PASS ${status} ${path}`);
}
