import { createRequire } from 'node:module';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createExperiment } from './server.mjs';
const require=createRequire(process.env.PLAYWRIGHT_PACKAGE_JSON || import.meta.url);
const { chromium }=require('playwright');
const {server}=createExperiment();server.listen(0,'127.0.0.1');await once(server,'listening');
const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'msedge'});
const results=[];
try {
 for(const width of [390,1280]) {
  const page=await browser.newPage({viewport:{width,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.check('#consent');await page.click('#start');
  for(const answer of ['Test User','Software engineer','2000-04-03']){
   await page.locator('#submit').waitFor();await page.fill('#answer',answer);await page.click('#submit');await page.locator('#pending').waitFor({state:'visible'});await page.click('#confirm');await page.locator('#pending').waitFor({state:'hidden'});
  }
  await page.click('#skip');await page.click('#confirm');await page.locator('#review').waitFor({state:'visible'});
  await page.selectOption('#editfield','name');await page.click('#edit');await page.fill('#answer','Corrected Test User');await page.click('#submit');await page.click('#confirm');await page.click('#finish');
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('NOT been saved'));
  assert.match(await page.textContent('#profile'),/Corrected Test User/);assert.deepEqual(errors,[]);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await mkdir('verification/voice-onboarding',{recursive:true});await page.screenshot({path:`verification/voice-onboarding/mock-${width}.png`,fullPage:true});
  results.push({width,journey:'PASS',overflow:false,browserErrors:errors,realVoice:'NOT_TESTED',oauth:'NOT_IN_PROTOTYPE',database:'NOT_IN_PROTOTYPE'});await page.close();
 }
 await writeFile('verification/voice-onboarding/browser-results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
} finally {await browser.close();server.close();server.closeAllConnections()}
