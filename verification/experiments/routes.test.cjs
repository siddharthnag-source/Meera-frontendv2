const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { NextRequest } = require('next/server');
function harness(options = {}) {
  const calls = [],
    cache = new Map();
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fixture-public',
    ONBOARDING_EXPERIMENT_READY: 'true',
    OPENROUTER_API_KEY: 'fixture-provider',
    ...options.env,
  };
  const db = {
    auth: {
      getUser: async () => ({
        data: {
          user: {
            id: 'fixture-user',
            email_confirmed_at: '2026-11-13',
            identities: [{ provider: 'google' }],
            is_anonymous: false,
            ...options.user,
          },
        },
        error: null,
      }),
    },
    rpc: async (name, args) => {
      calls.push(['rpc', name, args]);
      if (options.rpcError)
        return { data: null, error: { message: options.rpcError } };
      return {
        error: null,
        data:
          name === 'onboarding_experiment_operator'
            ? options.operator !== false
            : name === 'onboarding_experiment_report'
              ? { arms: [], config: { enabled: false, version: 1 } }
              : name === 'onboarding_experiment_control'
                ? { enabled: args.p_enabled, version: 2 }
                : name === 'onboarding_experiment_assignment'
                  ? {
                      enabled: true,
                      assigned: true,
                      variant: 'typed_first',
                      version: 1,
                      exposed: args.p_expose,
                    }
                  : true,
      };
    },
  };
  function load(file) {
    file = path.resolve(file);
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file, exports);
    const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    vm.runInNewContext(compiled, {
      exports,
      process: { env },
      Buffer,
      TextDecoder,
      URL,
      Headers,
      AbortSignal,
      Date,
      console,
      fetch: async (url) => {
        calls.push(['fetch', url]);
        return {
          ok: !options.providerDown,
          json: async () => ({
            data: {
              limit: 9.9,
              limit_remaining: 5,
              limit_reset: null,
              expires_at: '2026-11-19T11:43:00Z',
              ...options.budget,
            },
          }),
        };
      },
      require: (id) =>
        id === '@supabase/supabase-js'
          ? { createClient: () => db }
          : id.startsWith('@/')
            ? load('src/' + id.slice(2) + '.ts')
            : require(id),
    });
    return exports;
  }
  async function request(route, body, method = 'POST', headers = {}) {
    const r = new NextRequest(
      'https://meera.test/api/experiments/onboarding/' + route,
      {
        method,
        headers: {
          origin: 'https://meera.test',
          referer: 'https://meera.test/onboarding',
          authorization: 'Bearer fixture-user-token',
          'content-type': 'application/json',
          ...headers,
        },
        ...(method === 'POST' ? { body: JSON.stringify(body || {}) } : {}),
      },
    );
    return load('src/app/api/experiments/onboarding/' + route + '/route.ts')[
      method
    ](r);
  }
  return { calls, request };
}
const id = '00000000-0000-4000-8000-000000000001';
test('foreign origins, missing tokens and non-Google identities fail before experiment writes', async () => {
  for (const [options, headers, status] of [
    [{}, { origin: 'https://other.test' }, 403],
    [{}, { authorization: '' }, 401],
    [{ user: { identities: [{ provider: 'email' }] } }, {}, 401],
  ]) {
    const h = harness(options);
    assert.equal(
      (
        await h.request(
          'event',
          { event: 'start', eventId: id },
          'POST',
          headers,
        )
      ).status,
      status,
    );
    assert.equal(h.calls.length, 0);
  }
});
test('dark release returns no assignment and does not write state', async () => {
  const h = harness({ env: { ONBOARDING_EXPERIMENT_READY: 'false' } });
  const r = await h.request('assignment', { expose: false });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).assigned, false);
  assert.equal(h.calls.length, 0);
});
test('assignment rejects non-onboarding enrollment and body-supplied identities', async () => {
  for (const [body, headers, status] of [
    [{ expose: false }, { referer: 'https://meera.test/' }, 403],
    [{ expose: false, user_id: 'victim' }, {}, 400],
  ]) {
    const h = harness();
    assert.equal(
      (await h.request('assignment', body, 'POST', headers)).status,
      status,
    );
    assert.equal(h.calls.length, 0);
  }
});
test('exposure carries a server-issued version and no user identity parameter', async () => {
  const h = harness();
  assert.equal(
    (await h.request('assignment', { expose: true, version: 2 })).status,
    200,
  );
  const args = h.calls[0][2];
  assert.equal(args.p_version, 2);
  assert.equal(args.p_expose, true);
  assert.equal(args.user_id, undefined);
});
test('PII and forged save events are rejected before telemetry writes', async () => {
  for (const body of [
    { event: 'start', eventId: id, transcript: 'private' },
    { event: 'profile_saved', eventId: id },
  ]) {
    const h = harness();
    assert.equal((await h.request('event', body)).status, 400);
    assert.equal(h.calls.length, 0);
  }
});
test('telemetry accepts only the authenticated actor through owner-scoped RPC', async () => {
  const h = harness();
  assert.equal(
    (
      await h.request('event', {
        event: 'fallback',
        eventId: id,
        reason: 'permission_denied',
      })
    ).status,
    200,
  );
  assert.equal(h.calls[0][1], 'onboarding_experiment_event');
  assert.equal(h.calls[0][2].p_reason, 'permission_denied');
  assert.equal(h.calls[0][2].p_user_id, undefined);
});
test('non-operators cannot read reports or change allocation and do not call the provider', async () => {
  const h = harness({ operator: false });
  assert.equal(
    (await h.request('admin', { action: 'enable', version: 1 })).status,
    403,
  );
  assert.equal(
    h.calls.some((c) => c[0] === 'fetch'),
    false,
  );
  const read = harness({ rpcError: 'FORBIDDEN' });
  assert.equal((await read.request('admin', null, 'GET')).status, 403);
});
test('disable works while provider is unavailable and release readiness is false', async () => {
  const h = harness({
    providerDown: true,
    env: { ONBOARDING_EXPERIMENT_READY: 'false', OPENROUTER_API_KEY: '' },
  });
  assert.equal(
    (await h.request('admin', { action: 'disable', version: 1 })).status,
    200,
  );
  assert.equal(
    h.calls.some((c) => c[0] === 'fetch'),
    false,
  );
});
test('activation rejects unbounded/reset/expired/low budget and never changes spend settings', async () => {
  for (const budget of [
    { limit: 10 },
    { limit_reset: 'daily' },
    { expires_at: null },
    { limit_remaining: 1 },
    { expires_at: '2026-11-11T00:00:00Z' },
  ]) {
    const h = harness({ budget });
    assert.equal(
      (await h.request('admin', { action: 'enable', version: 1 })).status,
      409,
    );
    assert.equal(
      h.calls.some((c) => c[1] === 'onboarding_experiment_control'),
      false,
    );
    assert.ok(
      h.calls
        .filter((c) => c[0] === 'fetch')
        .every((c) => c[1] === 'https://openrouter.ai/api/v1/key'),
    );
  }
});
test('control uses optimistic version and database acceptance gates after budget verification', async () => {
  const h = harness();
  assert.equal(
    (await h.request('admin', { action: 'enable', version: 4 })).status,
    200,
  );
  assert.equal(h.calls.at(-1)[1], 'onboarding_experiment_control');
  assert.equal(h.calls.at(-1)[2].p_expected_version, 4);
  assert.equal(h.calls.at(-1)[2].p_enabled, true);
});
