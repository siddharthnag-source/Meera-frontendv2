const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function fixture({ mode = 'sandbox', ref = 'wyitdnwftdxlibdnldfe', databaseReady = true, authenticated = true, paid = false, failed = false } = {}) {
  const exports = {}, filters = [];
  const query = { select() { return this; }, eq(key,value) { filters.push([key,value]); return this; }, in() { return this; }, async limit() { return { data: paid ? [{payment_id:'cs_test_fixture'}] : [], error: failed ? new Error('offline') : null }; } };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/app/api/growth-staging/user/balance/route.ts','utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, process: {env:{MEERA_PAYMENT_MODE:mode,MEERA_STRIPE_SANDBOX_SUPABASE_REF:ref}}, require(id) {
    if(id==='next/server') return {NextResponse:{json:(body,options={})=>({body,status:options.status||200,headers:options.headers})}};
    if(id==='@/lib/stripePayments') return {stripeSandboxDatabaseReady:()=>databaseReady,paymentIdentity:async()=>authenticated?{publicUserId:'verified-user-a',db:{from:()=>query}}:null};
    throw Error(id);
  }});
  return {get:()=>exports.GET({}),filters};
}
test('staging entitlement is disabled outside the exact approved sandbox',async()=>{
  for(const config of [{mode:'live'},{ref:'odeqnorudbdiuhweuoqv'},{databaseReady:false}]) assert.equal((await fixture(config).get()).status,404);
});
test('entitlements require identity, filter by verified ownership, and fail closed',async()=>{
  assert.equal((await fixture({authenticated:false}).get()).status,401);
  assert.equal((await fixture({failed:true}).get()).status,503);
  const f=fixture({paid:true}), r=await f.get();
  assert.equal(r.body.is_paid_active,true);
  assert.equal(r.body.access_type,'lifetime');
  assert.deepEqual(f.filters,[['user_id','verified-user-a'],['plan_type','lifetime']]);
  assert.equal(r.headers['Cache-Control'],'private, no-store');
  assert.equal((await fixture().get()).body.is_paid_active,false);
});
