const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const compile = (file) =>
  ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
test("onboarding intent is local, bounded, and never an external redirect", () => {
  const values = new Map();
  const exports = {};
  let now = 1000;
  vm.runInNewContext(compile("src/lib/onboarding-redirect.ts"), {
    exports,
    URLSearchParams,
    Date: { now: () => now },
    sessionStorage: {
      setItem: (k, v) => values.set(k, v),
      getItem: (k) => values.get(k) ?? null,
      removeItem: (k) => values.delete(k),
    },
  });
  assert.equal(exports.ONBOARDING_RETURN_PATH, "/onboarding?setup=1");
  assert.equal(exports.isOnboardingSignIn("?next=https://example.com"), false);
  exports.rememberOnboardingSignIn();
  assert.equal(exports.isOnboardingSignIn(""), true);
  now += 16 * 60_000;
  assert.equal(exports.isOnboardingSignIn(""), false);
  assert.equal(exports.isOnboardingSignIn("?onboarding=1"), true);
  exports.clearOnboardingSignIn();
  assert.equal(exports.isOnboardingSignIn(""), false);
});
test("dedicated callback returns to menu only after a session and ignores stale completions", async () => {
  const pending = [],
    cleanups = [],
    targets = [],
    errors = [];
  const exports = {};
  vm.runInNewContext(compile("onboarding-staging/app/auth/callback/page.tsx"), {
    exports, AbortSignal,
    fetch: async () => ({ ok: true, json: async () => ({ draft: { complete: false } }) }),
    window: { location: { replace: (t) => targets.push(t) } },
    require: (id) =>
      ({
        react: {
          useEffect: (fn) => cleanups.push(fn()),
          useState: () => ["", (v) => errors.push(v)],
        },
        "react/jsx-runtime": { jsx: () => null, jsxs: () => null },
        "@/lib/onboarding-redirect": {
          ONBOARDING_RETURN_PATH: "/onboarding?setup=1",
        },
        "@/lib/onboarding-auth-client": {
          onboardingAuth: () => ({
            auth: {
              getSession: () => new Promise((resolve) => pending.push(resolve)),
            },
          }),
        },
      })[id],
  });
  exports.default();
  cleanups[0]();
  exports.default();
  pending[0]({ data: { session: {} }, error: null });
  await new Promise(setImmediate);
  assert.deepEqual(targets, []);
  pending[1]({ data: { session: {} }, error: null });
  await new Promise(setImmediate);
  assert.deepEqual(targets, ["/onboarding?setup=1"]);
  exports.default();
  pending[2]({ data: { session: null }, error: null });
  await new Promise(setImmediate);
  assert.equal(targets.length, 1);
  assert.equal(errors.length, 1);
});
