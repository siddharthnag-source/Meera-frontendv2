import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { ageFromDob, newSession, propose, confirm, finish } from './core.mjs';
import { provider } from './openrouter.mjs';
import { createExperiment } from './server.mjs';
test('DOB validation, birthday boundary and leap day',()=>{
 assert.equal(ageFromDob('2000-11-05','2026-11-04'),25);
 assert.equal(ageFromDob('2000-11-04','2026-11-04'),26);
 assert.equal(ageFromDob('2000-02-29','2026-03-01'),26);
 for(const d of ['2026-02-29','2000-02-30','03/04/2000','2027-01-01'])assert.throws(()=>ageFromDob(d,'2026-11-04'));
});
test('unconfirmed answers cannot complete; corrections replace confirmed value',()=>{
 const s=newSession();propose(s,'name','Test');assert.deepEqual(s.profile,{});assert.throws(()=>finish(s));confirm(s);
 for(const f of ['job_details','dob','caste']){propose(s,f,null);confirm(s)}
 propose(s,'name','Corrected');confirm(s);assert.equal(finish(s).name,'Corrected');assert.throws(()=>propose(s,'name','Again'));
});
test('reject unknown fields, missing name, invalid types and oversized values',()=>{
 for(const [f,v] of [['role','admin'],['name',null],['name',{}],['name','x'.repeat(501)]])assert.throws(()=>propose(newSession(),f,v));
});
test('provider contract: extraction, audio bytes, malformed output, ambiguity and failure',async()=>{
 let payload;const config={key:'synthetic',stt:'test/stt',llm:'test/llm',tts:'test/tts',voice:'test'};
 const p=provider(config,async(url,options)=>{payload=JSON.parse(options.body);return url.endsWith('speech')?new Response(new Uint8Array([1,2,3])):Response.json(url.endsWith('transcriptions')?{text:'Test name'}:{choices:[{message:{content:JSON.stringify({value:'Test name',needs_clarification:false})}}]})});
 assert.equal(await p.transcribe('YWJj','webm'),'Test name');assert.equal(payload.input_audio.format,'webm');
 assert.equal(await p.extract('name','My name is Test name'),'Test name');assert.equal(payload.response_format.json_schema.strict,true);
 assert.deepEqual(await p.speak('Hello'),Buffer.from([1,2,3]));
 const bad=provider(config,async()=>Response.json({choices:[{message:{content:'{}'}}]}));await assert.rejects(()=>bad.extract('dob','April third'));
 const down=provider(config,async()=>new Response('',{status:429}));await assert.rejects(()=>down.speak('Hi'),/429/);
 assert.throws(()=>provider({...config,tts:'google/test'}));
});
test('HTTP journey: consent, CSRF, pending confirmation, skips, correction, finish and cancellation',async()=>{
 const {server,token}=createExperiment();server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}`;
 const post=async(path,body={},authorized=true)=>{const r=await fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,...(authorized?{'X-Experiment-Token':token}:{})},body:JSON.stringify(body)});return {status:r.status,...await r.json()}};
 try{
 assert.equal((await fetch(origin)).status,200);assert.equal((await post('/start',{consent:true},false)).status,403);assert.equal((await post('/start',{consent:false})).status,400);
 const {id}=await post('/start',{consent:true});assert.equal((await post('/finish',{id})).status,400);
 await post('/answer',{id,text:'Test User'});assert.equal((await post('/answer',{id,text:'overwrite'})).status,409);await post('/confirm',{id});
 await post('/answer',{id,text:'Engineer'});await post('/confirm',{id});
 assert.equal((await post('/answer',{id,text:'2000-02-30'})).status,400);await post('/answer',{id,text:'2000-04-03'});await post('/confirm',{id});
 await post('/answer',{id,skip:true});await post('/confirm',{id});
 await post('/answer',{id,field:'name',text:'Corrected User'});await post('/confirm',{id});
 const result=await post('/finish',{id});assert.equal(result.profile.name,'Corrected User');assert.equal(result.profile.caste,null);assert.equal(result.saved,false);
 assert.equal((await post('/finish',{id})).status,409);await post('/cancel',{id});assert.equal((await post('/confirm',{id})).status,401);
 }finally{server.close();server.closeAllConnections()}
});
