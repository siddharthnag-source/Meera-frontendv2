const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const EXP = 'growth_readiness_v1';
const compile = path => ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText;
function helper() {
  const exports = {};
  vm.runInNewContext(compile('src/lib/growthStaging.ts'), { exports, process: { env: {} }, require: id =>
    id === 'node:crypto' ? require(id) : { stripeSandboxDatabaseReady: () => false } });
  return exports;
}
function fixture({ ready = true, authenticated = true, operator = true, verified = true, failed = false } = {}) {
  const tables = {
    growth_staging_operators: operator ? [{ email: 'operator@example.invalid', enabled: true }] : [],
    growth_staging_experiments: [{ id: EXP, enabled: false, allocation: 0 }],
    growth_staging_assignments: [], users: [{ id: 'profile-a' }],
    payments: [{ payment_status: 'refunded', currency: 'USD', plan_type: 'lifetime' }],
  };
  const writes = [];
  const db = { from(table) {
    const filters = []; let operation = 'select', payload, options, head = false;
    const execute = () => {
      if (failed) return { error: new Error('offline'), data: null, count: null };
      let rows = tables[table].filter(r => filters.every(f => f(r)));
      if (operation === 'upsert') {
        if (!tables[table].some(r => r.experiment_id === payload.experiment_id && r.auth_user_id === payload.auth_user_id)) {
          tables[table].push({ ...payload, exposed_at: null }); writes.push(table);
        }
      } else if (operation === 'update') { rows.forEach(r => Object.assign(r, payload)); if (rows.length) writes.push(table); }
      return { data: head ? null : rows.map(r => ({ ...r })), count: rows.length, error: null };
    };
    const q = {
      select(_columns, opts) { head = opts?.head === true; return this; },
      eq(k, v) { filters.push(r => r[k] === v); return this; },
      is(k, v) { filters.push(r => r[k] === v); return this; },
      not(k, _op, v) { filters.push(r => r[k] !== v); return this; },
      update(value) { operation = 'update'; payload = value; return this; },
      upsert(value, opts) { operation = 'upsert'; payload = value; options = opts; assert.equal(options.ignoreDuplicates, true); return this; },
      async maybeSingle() { const r = execute(); return { ...r, data: r.data?.[0] ?? null }; },
      async single() { return this.maybeSingle(); },
      then(resolve, reject) { return Promise.resolve(execute()).then(resolve, reject); },
    }; return q;
  } };
  const exports = {}, helpers = helper();
  vm.runInNewContext(compile('src/app/api/growth-staging/workbench/route.ts'), { exports, Date,
    require: id => {
      if (id === 'next/server') return { NextResponse: { json: (body, options) => ({ body, status: options.status, headers: options.headers }) } };
      if (id === '@/lib/growthStaging') return { ...helpers, growthStagingReady: () => ready };
      if (id === '@/lib/stripePayments') return { paymentIdentity: async () => authenticated ? {
        user: { id: 'verified-user-a', email: 'operator@example.invalid', identities: verified ? [{ provider: 'google',
          identity_data: { email_verified: true, email: 'operator@example.invalid' } }] : [] }, publicUserId: 'profile-a', db,
      } : null };
      throw Error(id);
    },
  });
  const request = (body, origin = 'https://staging.invalid') => ({
    nextUrl: new URL('https://staging.invalid/api/growth-staging/workbench'),
    headers: new Headers({ origin, 'content-type': 'application/json' }), json: async () => body,
  });
  return { tables, writes, get: () => exports.GET(request()), post: (body, origin) => exports.POST(request(body, origin)) };
}

test('enrollment and variant are stable, allocation boundaries hold and buckets are balanced', () => {
  const h = helper(); let control = 0, enrolled = 0;
  for (let i = 0; i < 1000; i++) {
    const id = `synthetic-${i}`, a = h.stagingAssignment(id, 50);
    assert.equal(JSON.stringify(a), JSON.stringify(h.stagingAssignment(id, 50)));
    assert.equal(h.stagingAssignment(id, 0).enrolled, false);
    assert.equal(h.stagingAssignment(id, 100).enrolled, true);
    if (a.variant === 'control') control++; if (a.enrolled) enrolled++;
  }
  assert.ok(control > 400 && control < 600); assert.ok(enrolled > 400 && enrolled < 600);
  for (const n of [-1, 101, NaN, 0.5]) assert.throws(() => h.stagingAssignment('a', n));
});

test('workbench fails closed outside staging, without auth, across origins or for nonoperators', async () => {
  assert.equal((await fixture({ ready: false }).get()).status, 404);
  assert.equal((await fixture({ authenticated: false }).get()).status, 401);
  assert.equal((await fixture({ verified: false }).get()).status, 403);
  const f = fixture({ operator: false });
  assert.equal((await f.get()).status, 403);
  assert.equal((await f.post({ operation: 'configure', enabled: true, allocation: 100, email: 'operator@example.invalid' })).status, 403);
  assert.equal((await fixture().post({ operation: 'assign' }, 'https://other.invalid')).status, 403);
  assert.equal((await fixture({ failed: true }).get()).status, 503);
  assert.equal(f.writes.length, 0);
});

test('assignment is persisted before exposure, deduplicated and cannot be changed by the client', async () => {
  const f = fixture();
  await f.post({ operation: 'configure', enabled: true, allocation: 100 });
  assert.equal((await f.post({ operation: 'expose' })).status, 409);
  const a = await f.post({ operation: 'assign', user_id: 'victim', variant: 'forged' });
  assert.equal(a.status, 200); assert.equal(f.tables.growth_staging_assignments.length, 1);
  assert.equal(f.tables.growth_staging_assignments[0].auth_user_id, 'verified-user-a');
  assert.equal(f.tables.growth_staging_assignments[0].exposed_at, null);
  await f.post({ operation: 'expose' }); const exposure = f.tables.growth_staging_assignments[0].exposed_at;
  await f.post({ operation: 'assign' }); await f.post({ operation: 'expose' });
  assert.equal(f.tables.growth_staging_assignments.length, 1);
  assert.equal(f.tables.growth_staging_assignments[0].exposed_at, exposure);
  assert.equal((await f.post({ operation: 'assign' })).body.variant, a.body.variant);
});

test('kill switch stops assignment and exposure while preserving the historical cohort', async () => {
  const f = fixture();
  await f.post({ operation: 'configure', enabled: true, allocation: 100 }); await f.post({ operation: 'assign' });
  await f.post({ operation: 'configure', enabled: false, allocation: 0 });
  const writes = f.writes.length;
  assert.equal((await f.post({ operation: 'expose' })).body.enabled, false);
  assert.equal((await f.post({ operation: 'assign' })).body.enrolled, false);
  assert.equal(f.writes.length, writes); assert.equal(f.tables.growth_staging_assignments.length, 1);
  assert.equal(f.tables.growth_staging_assignments[0].exposed_at, null);
});

test('aggregate report excludes identities and distinguishes refunded from active paid access', async () => {
  const r = await fixture().get(); assert.equal(r.status, 200);
  assert.equal(r.body.totals.paid, 0); assert.equal(r.body.totals.refunded, 1); assert.equal(r.body.test_only, true);
  assert.equal(r.headers['Cache-Control'], 'private, no-store');
  assert.doesNotMatch(JSON.stringify(r.body), /verified-user-a|profile-a|operator@example|auth_user_id/);
});
