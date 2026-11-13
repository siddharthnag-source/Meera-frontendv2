// Candidate integration only. All identities, provider failures and audio devices are fixtures.
const {chromium}=require('/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
const base=process.env.ONBOARDING_TEST_URL||'http://127.0.0.1:3231';
(async()=>{const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});const results=[];
try{for(const [variant,width] of [['typed_first',390],['voice_first',1280]]){
 const context=await browser.newContext({viewport:{width,height:1000}});const page=await context.newPage();const events=[];let exposed=false,enabled=true;const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const user={id:'12345678-1234-4123-8123-123456789abc',aud:'authenticated',role:'authenticated',email:'fixture@example.test',app_metadata:{provider:'google'},user_metadata:{full_name:'Fixture'},identities:[{provider:'google'}],created_at:new Date().toISOString()};
 await page.addInitScript(({user})=>{localStorage.setItem('sb-staging-auth-token',JSON.stringify({access_token:[btoa('{}'),btoa(JSON.stringify({sub:user.id,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})),'fixture-signature'].join('.'),refresh_token:'fixture-refresh',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user}));window.__mic=0;navigator.mediaDevices.getUserMedia=async()=>{window.__mic++;throw new DOMException('Fixture denied','NotAllowedError');};},{user});
 await page.route('https://staging.supabase.co/**',route=>route.fulfill({json:user}));
 await page.route('**/api/onboarding/session',route=>route.fulfill({json:{draft:{profile:{name:'Fixture'},revision:0,complete:false},googleName:'Fixture',profileReady:true,voiceConfigured:true,workspace:'/workspace-fixture'}}));
 await page.route('**/api/experiments/onboarding/assignment',async route=>{
  const body=route.request().postDataJSON();
  if(body?.expose){assert.equal(await page.locator('dialog[open]').count(),1);assert.equal(await page.locator('dialog[open]').getAttribute('data-experiment-mode'),variant);exposed=true;}
  await route.fulfill({json:{enabled,assigned:true,variant,version:1,exposed}});
 });
 await page.route('**/api/experiments/onboarding/event',async route=>{events.push(route.request().postDataJSON());await route.fulfill({json:{accepted:true}});});
 await page.goto(base+'/onboarding?setup=1');
 const heading=variant==='typed_first'?'A little about you':'Your voice, your way';await page.getByRole('heading',{name:heading,exact:true}).waitFor();await page.waitForFunction(()=>document.querySelector('dialog[open]')?.dataset.experimentMode!==undefined);await page.waitForTimeout(100);
 assert.equal(exposed,true);assert.equal(await page.evaluate(()=>window.__mic),0);
 if(variant==='voice_first')await page.getByRole('button',{name:'I’d rather type',exact:true}).click();
 await page.getByRole('textbox',{name:'What should I call you? (optional)',exact:true}).fill('Private fixture profile');
 assert.equal(await page.locator('input[required]').count(),0);
 await page.getByRole('button',{name:'Continue with Meera’s voice',exact:true}).click();
 await page.getByText('Microphone access is unavailable. You can type or edit your profile instead.',{exact:true}).first().waitFor({timeout:30000});
 assert.equal(await page.evaluate(()=>window.__mic),1);
 assert.ok(events.some(e=>e.event==='fallback'&&e.reason==='permission_denied'));
 assert.ok(events.some(e=>e.event==='start'));
 assert.ok(events.some(e=>e.event==='mode_switch'));
 assert.ok(!JSON.stringify(events).includes('Private fixture profile'));
 assert.ok(events.every(e=>Object.keys(e).every(k=>['event','eventId','durationMs','reason','mode'].includes(k))));
 // Poll the real client kill switch; preserve the edited draft while closing capture.
 enabled=false;await page.waitForTimeout(15500);assert.equal(await page.locator('dialog[open]').getAttribute('data-experiment-mode'),null);
 await page.getByRole('button',{name:'I’d rather type',exact:true}).click();assert.equal(await page.getByRole('textbox',{name:'What should I call you? (optional)',exact:true}).inputValue(),'Private fixture profile');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
 results.push({variant,width,exposureAfterVisible:true,permissionFallback:true,privacy:true,killSwitchPreservesDraft:true,realDevice:false});await context.close();
}console.log(JSON.stringify({groups:results,productionChanged:false},null,2));}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
