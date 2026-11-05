const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function fixture({ role = 'growth_aggregate', enabled = true, email = 'marketing@getmeera.space', authenticated = true } = {}) {
  const exports = {};
  const db = { from() { return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: { role, enabled }, error: null }; } }; } };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/analyticsAccess.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, process: { env: {} }, console,
    require(id) {
      assert.equal(id, '@/lib/meeraServer');
      return { requireAuthenticatedUser: async () => authenticated
        ? { ok: true, supabase: db, user: { id: 'qa-actor', email } }
        : { ok: false, status: 401, message: 'Unauthorized' } };
    },
  });
  return exports;
}

test('aggregate growth role can read totals but cannot access user records, chats or grants', async () => {
  const api = fixture();
  assert.equal((await api.requireAnalyticsPermission({}, 'analytics.view')).ok, true);
  for (const permission of ['users.list', 'users.view_pii', 'conversations.view_metadata', 'conversations.view_redacted', 'conversations.view_full', 'growth_links.manage', 'access.manage']) {
    const response = await api.requireAnalyticsPermission({}, permission);
    assert.equal(response.ok, false, permission);
    assert.equal(response.status, 403, permission);
  }
});

test('disabled or unknown named role and unauthenticated sessions fail closed', async () => {
  for (const options of [{ enabled: false }, { role: 'invented' }, { authenticated: false }]) {
    const response = await fixture(options).requireAnalyticsPermission({}, 'analytics.view');
    assert.equal(response.ok, false);
    assert.ok([401, 403].includes(response.status));
  }
});

test('aggregate role does not change existing owner permissions or allow caller mutation', () => {
  const api = fixture();
  assert.ok(api.permissionsForRole('owner').includes('access.manage'));
  const copy = api.permissionsForRole('growth_aggregate');
  copy.push('users.view_pii');
  assert.equal(api.permissionsForRole('growth_aggregate').includes('users.view_pii'), false);
});
