// Reflective onboarding integration fixtures. No real device or customer data.
const {chromium}=require('/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
const base=process.env.ONBOARDING_TEST_URL||'http://127.0.0.1:3232';
(async()=>{const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});const results=[];
try{for(const mode of ['voice','denied','blocked','save-failure']){
 const context=await browser.newContext({viewport:{width:mode==='voice'?1280:390,height:950}});const page=await context.newPage();const errors=[];const saves=[];let complete=false;let revision=0;let sessionReads=0;
 page.on('pageerror',e=>errors.push(e.message));
 const user={id:'12345678-1234-4123-8123-123456789abc',aud:'authenticated',role:'authenticated',email:'fixture@example.test',app_metadata:{provider:'google'},user_metadata:{full_name:'Fixture'},identities:[{provider:'google'}],created_at:new Date().toISOString()};
 await page.addInitScript(({user,mode})=>{
 localStorage.setItem('sb-staging-auth-token',JSON.stringify({access_token:[btoa('{}'),btoa(JSON.stringify({sub:user.id,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})),'fixture-signature'].join('.'),refresh_token:'fixture-refresh',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user}));
 window.__prompts=[];window.__active=0;window.__aborts=0;
 window.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};
 Object.defineProperty(window,'speechSynthesis',{value:{getVoices:()=>[],cancel:()=>{},speak:u=>{window.__prompts.push(u.text);if(mode==='blocked')return;setTimeout(()=>{u.onstart?.();setTimeout(()=>u.onend?.(),20);},10);}}});
 window.SpeechRecognition=class{constructor(){window.__capture=this;}start(){window.__active++;if(mode==='denied')setTimeout(()=>this.onerror?.({error:'not-allowed'}),20);}abort(){window.__active=Math.max(0,window.__active-1);window.__aborts++;}};
 },{user,mode});
 await page.route('https://staging.supabase.co/**',route=>route.fulfill({json:user}));
 await page.route('**/api/onboarding/session',route=>{sessionReads++;return route.fulfill({json:{draft:{profile:{name:'Fixture'},revision,complete},workspace:'/workspace-fixture',profileReady:true}});});
 await page.route('**/api/onboarding/profile',route=>{saves.push(route.request().postDataJSON());if(mode==='save-failure')return route.fulfill({status:503,json:{error:'Fixture storage unavailable'}});complete=true;revision++;return route.fulfill({json:{draft:{profile:{name:'Fixture'},revision,complete}}});});
 await page.route('**/workspace-fixture?welcome=onboarding',route=>route.fulfill({contentType:'text/html',body:'<h1>Meera workspace fixture</h1>'}));
 await page.goto(base+'/onboarding?setup=1');
 await page.getByRole('heading',{name:'What has been weighing on you lately, if anything?'}).waitFor();
 assert.equal(await page.locator('input[type=date]').count(),0);
 if(mode==='voice'){
  for(let i=0;i<3;i++){
   await page.waitForFunction(()=>window.__active===1);
   await page.evaluate(()=>window.__capture.onresult({results:[{isFinal:true,0:{transcript:'Private emotional fixture answer'}}]}));
   if(i<2)await page.waitForTimeout(2000);
  }
  await page.waitForURL('**/workspace-fixture?welcome=onboarding');
  assert.equal(saves.length,1);assert.deepEqual(saves[0].profile,{name:'Fixture'});assert.equal(saves[0].complete,true);assert.ok(sessionReads>=2);
 }else if(mode==='denied'){
  await page.getByRole('textbox',{name:'Your answer'}).waitFor();
  await page.getByRole('textbox',{name:'Your answer'}).fill('Private typed emotional answer');
  await page.getByRole('button',{name:'Continue ↗',exact:true}).click();
  await page.getByRole('heading',{name:/When did you last/}).waitFor();
  await page.getByRole('button',{name:'Skip this question →',exact:true}).click();
  await page.getByRole('heading',{name:/When things feel difficult/}).waitFor();
  await page.getByRole('button',{name:'Skip this question →',exact:true}).click();
  await page.waitForURL('**/workspace-fixture?welcome=onboarding');
  assert.equal(JSON.stringify(saves).includes('Private typed'),false);
 }else if(mode==='blocked'){
  await page.getByText('Tap the circle to begin. Your browser needs permission for sound.').waitFor();
  assert.equal(await page.evaluate(()=>window.__active),0);
  await page.getByRole('button',{name:'Use keyboard',exact:true}).click();
  await page.getByRole('textbox',{name:'Your answer'}).waitFor();
  await page.screenshot({path:'/workspace/work/production-experiment/reflection-mobile.png',fullPage:true});
 }else{
  await page.getByRole('button',{name:'Skip to Meera ↗',exact:true}).click();
  await page.getByText('Fixture storage unavailable',{exact:true}).waitFor();assert.equal(page.url().includes('/onboarding'),true);
  await page.getByRole('button',{name:'Continue without saving ↗',exact:true}).click();
  await page.waitForURL('**/workspace-fixture?welcome=onboarding');
 }
 if(page.url().includes('/onboarding')){
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
 }
 assert.deepEqual(errors,[]);results.push({mode,passed:true,realDevice:false});await context.close();
}console.log(JSON.stringify({groups:results,productionChanged:false},null,2));}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
