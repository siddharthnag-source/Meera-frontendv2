const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(path) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(path, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    { exports, require },
  );
  return exports;
}
const c = load('src/lib/experiments/onboarding-contract.ts'),
  a = load('src/lib/experiments/onboarding-analysis.ts');
const id = '00000000-0000-4000-8000-000000000001';
test('telemetry rejects profile, transcript, identity and arbitrary metadata fields', () => {
  for (const key of [
    'name',
    'email',
    'user_id',
    'dob',
    'phone',
    'transcript',
    'audio',
    'metadata',
  ])
    assert.throws(() =>
      c.validateEvent({ event: 'start', eventId: id, [key]: 'sensitive' }),
    );
});
test('only bounded durations, known modes/reasons and event types are accepted', () => {
  assert.equal(
    c.validateEvent({ event: 'response_ready', eventId: id, durationMs: 1500 })
      .durationMs,
    1500,
  );
  for (const body of [
    { event: 'profile_saved' },
    { event: 'response_ready' },
    { event: 'response_ready', durationMs: Infinity },
    { event: 'response_ready', durationMs: -1 },
    { event: 'fallback', reason: 'raw provider transcript' },
    { event: 'mode_switch', mode: 'arbitrary' },
  ])
    assert.throws(() => c.validateEvent({ eventId: id, ...body }));
});
test('acceptance matrix covers real device/voice/language combinations and release gates', () => {
  assert.equal(c.ACCEPTANCE_CHECKS.length, 40);
  for (const device of ['desktop_chrome', 'android_chrome', 'iphone_safari'])
    for (const voice of ['sarah', 'brian'])
      for (const lang of ['en', 'hi', 'hinglish'])
        assert.ok(
          c.ACCEPTANCE_CHECKS.includes(
            `${device}:${voice}:${lang}:speech_correction_skip_save_reload`,
          ),
        );
  assert.ok(c.ACCEPTANCE_CHECKS.includes('measurement_integration_verified'));
});
const arm = (variant, matured, useful, saved = 18) => ({
  variant,
  assigned: 20,
  exposed: 19,
  matured,
  matured_useful: useful,
  matured_saved: saved,
  saved,
  responses: 25,
  fallbacks: 0,
});
test('decision does not treat small or immature cohorts as evidence', () => {
  assert.equal(a.recommendation([]).decision, 'hold');
  assert.equal(
    a.recommendation([arm('typed_first', 14, 10), arm('voice_first', 20, 18)])
      .decision,
    'hold',
  );
});
test('directional learning rules distinguish limited retention, iteration and rollback', () => {
  const base = arm('typed_first', 20, 10);
  assert.equal(
    a.recommendation([base, arm('voice_first', 20, 14)]).decision,
    'keep_limited_pilot',
  );
  assert.equal(
    a.recommendation([base, arm('voice_first', 20, 11)]).decision,
    'iterate',
  );
  assert.equal(
    a.recommendation([base, arm('voice_first', 20, 8)]).decision,
    'iterate_or_rollback',
  );
  assert.equal(
    a.recommendation([base, arm('voice_first', 20, 18)], true).decision,
    'rollback',
  );
  assert.equal(
    a.recommendation([base, arm('voice_first', 20, 18, 10)]).decision,
    'iterate_or_rollback',
  );
});
test('aggregate tracker export has fixed fields and no identity/profile values', () => {
  const csv = a.aggregateCsv([
    {
      ...arm('voice_first', 20, 14),
      email: 'private@example.test',
      user_id: id,
      transcript: 'private',
    },
  ]);
  assert.ok(csv.includes('matured_useful'));
  assert.ok(!csv.includes('private'));
  assert.ok(!csv.includes(id));
  const interval = a.wilson(10, 20);
  assert.ok(interval[0] < 0.5 && interval[1] > 0.5);
  assert.equal(a.wilson(0, 0), null);
});

test('release source gate fails on missing/changed files and extra runtime paths', () => {
  const path = require('node:path'),
    crypto = require('node:crypto');
  const { verify } = require('../../tools/verify-production-baseline.cjs');
  const dir = fs.mkdtempSync('/tmp/meera-release-fixture-');
  try {
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src/app.ts'), 'known-good');
    const manifest = {
      deploymentId: 'fixture',
      projectId: 'fixture',
      teamId: 'fixture',
      files: [
        {
          path: 'src/app.ts',
          uid: crypto.createHash('sha1').update('known-good').digest('hex'),
        },
      ],
    };
    assert.equal(verify(dir, manifest).verified, true);
    fs.writeFileSync(path.join(dir, 'src/app.ts'), 'different');
    assert.equal(verify(dir, manifest).verified, false);
    fs.writeFileSync(path.join(dir, 'src/app.ts'), 'known-good');
    fs.writeFileSync(path.join(dir, 'src/extra.ts'), 'runtime drift');
    assert.equal(verify(dir, manifest).verified, false);
    fs.unlinkSync(path.join(dir, 'src/app.ts'));
    assert.equal(verify(dir, manifest).missing.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('reported quota, latency, failure-rate and budget guards prevent a keep recommendation', () => {
  assert.equal(
    a.guardrailFailures({
      event_counts: [{ event_name: 'fallback', reason: 'quota', total: 2 }],
    }).length,
    1,
  );
  assert.equal(
    a.guardrailFailures({ response_latency: [{ measured: 10, p95_ms: 9000 }] })
      .length,
    1,
  );
  assert.equal(
    a.guardrailFailures({
      event_counts: [
        { event_name: 'response_ready', reason: null, total: 18 },
        { event_name: 'fallback', reason: 'provider_error', total: 2 },
      ],
    }).length,
    1,
  );
  assert.equal(
    a.guardrailFailures({ config: { enabled: true }, budgetVerified: false })
      .length,
    1,
  );
  assert.equal(
    a.guardrailFailures({ response_latency: [{ measured: 2, p95_ms: 9000 }] })
      .length,
    0,
  );
});
