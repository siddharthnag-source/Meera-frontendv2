import test from 'node:test';
import assert from 'node:assert/strict';
import { createConversation, applyAnswer, nextPrompt, review, complete, startResponse, interrupt, acceptResponse } from './conversation.mjs';
test('one answer can provide multiple facts without repeating answered questions',()=>{
 const s=createConversation(); applyAnswer(s,{name:'Synthetic Asha',job_details:'Designer'});assert.match(nextPrompt(s),/birthday/);assert.equal(s.finished,false);
});
test('correction invalidates the reviewed draft',()=>{
 const s=createConversation();applyAnswer(s,{name:'Synthetic Asha',job_details:null,dob:'1996-05-12',caste:null});review(s);applyAnswer(s,{name:'Synthetic Ashna'});assert.throws(()=>complete(s,true));review(s);assert.equal(complete(s,true).profile.name,'Synthetic Ashna');
});
test('optional refusal is remembered and never inferred',()=>{
 const s=createConversation();applyAnswer(s,{name:'Synthetic Rao',job_details:null,dob:null,caste:null});assert.equal(review(s).caste,null);assert.deepEqual(s.skipped,['job_details','dob','caste']);
});
test('final confirmation required even after all fields are present',()=>{
 const s=createConversation();applyAnswer(s,{name:'Synthetic',job_details:null,dob:null,caste:null});review(s);assert.throws(()=>complete(s,false));assert.equal(complete(s,true).persisted,false);assert.throws(()=>complete(s,true));
});
test('interruption rejects stale speech responses',()=>{
 const s=createConversation(),old=startResponse(s);interrupt(s);assert.equal(acceptResponse(s,old,'old question'),false);const current=startResponse(s);assert.equal(acceptResponse(s,current,'corrected question'),true);
});
test('invalid multi-field answer cannot partially mutate profile',()=>{
 const s=createConversation();assert.throws(()=>applyAnswer(s,{name:'Synthetic',dob:'1999-02-30'}));assert.deepEqual(s.draft,{});
});
