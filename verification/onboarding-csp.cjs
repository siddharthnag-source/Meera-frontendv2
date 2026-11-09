const { chromium } = require(process.env.MEERA_PLAYWRIGHT_MODULE || '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
(async () => {
 const url=(process.env.ONBOARDING_TEST_URL || 'http://127.0.0.1:3225') + '/onboarding';
 const first=await fetch(url), second=await fetch(url);
 const csp=first.headers.get('content-security-policy');
 assert.ok(csp.includes("'nonce-")); assert.ok(!csp.includes('unsafe-inline')); assert.ok(!csp.includes('unsafe-eval'));
 assert.notEqual(csp,second.headers.get('content-security-policy'));
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try {
  const page=await browser.newPage(); const violations=[];
  page.on('console',m=>{if(/Content Security Policy|violates.*directive/i.test(m.text()))violations.push(m.text())});
  await page.goto(url);
  await page.getByRole('button',{name:'Choose a voice',exact:true}).click();
  await page.getByLabel('Brian',{exact:true}).check();
  await page.getByLabel('Language').selectOption('hi');
  await page.getByRole('button',{name:'Close panel'}).click();
  assert.deepEqual(violations,[]);
  console.log('PASS: fresh CSP nonce per response, no broad script/style allowances, hydrated interactive voice settings, no CSP violations.');
 } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1});
